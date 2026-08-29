// 应付宝桌面端主进程（Electron）
// 职责：
//   1. 注册 app:// 安全协议（crypto.subtle / PBKDF2 需要 Secure Context，file:// 不行）
//   2. 加载 Vite 构建产物 dist/，使 BrowserRouter 与网站端共用同一份产物
//   3. 本地数据主存储：纯 JS 文件（%APPDATA%/YingFuBao/data/<userId>.json）
//      —— 不依赖任何原生模块（better-sqlite3 等），免去 VS / node-gyp 编译，
//         分发到任意 Windows 机器都不需要用户装 C++ 生成工具。
//      发票图片以磁盘文件存于 %APPDATA%/YingFuBao/images/<id>.jpg，JSON 仅存元数据。
//   4. 百度 OCR 代理（用户自填 Key 时主进程直连，规避 CORS）
//   5. electron-updater 自动更新（GitHub Releases）
//
// 注：早期版本内置过本机离线 RapidOCR（PP-OCRv4）引擎，现已移除，
//     发票识别统一使用用户自有的百度 OCR Key。

const { app, BrowserWindow, protocol, shell, ipcMain, dialog, Menu, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

// 应付宝共享百度 OCR 中转地址（Supabase Edge Function）。
// 百度 Key 仅保存在服务端 Secrets，前端 / 主进程都不持有。
const SUPABASE_FN_URL =
  'https://dpbtqwfbprartiogydqg.supabase.co/functions/v1/baidu-ocr';
// 公开 publishable key，可安全内嵌，仅用于调用 baidu-ocr 这一个无需鉴权的函数。
const SUPABASE_ANON_KEY = 'sb_publishable_m6iKgdv8VRGdx1KXAzWpSQ_BCDocpl_';

// 单实例：避免重复打开多个窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const isDev = !app.isPackaged && process.argv.includes('--dev');

// 注册 app:// 为特权安全协议（必须在 app ready 之前调用）
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true } },
]);

let mainWindow = null;
let tray = null;
let isQuitting = false; // 用于区分「关闭到托盘」和「真正退出」

// ===== 数据目录：%APPDATA%/YingFuBao =====
function dataDir() {
  return path.join(app.getPath('appData'), 'YingFuBao');
}
function dataStoreDir() {
  const d = path.join(dataDir(), 'data');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function imagesDir() {
  const d = path.join(dataDir(), 'images');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function metaPath() {
  return path.join(dataDir(), 'meta.json');
}
function userFilePath(userId) {
  return path.join(dataStoreDir(), userId + '.json');
}

function ensureDataDir() {
  dataStoreDir();
  imagesDir();
}

// 读取某用户的本地数据文件（不存在返回空结构）
function readUserFile(userId) {
  try {
    const raw = fs.readFileSync(userFilePath(userId), 'utf8');
    const obj = JSON.parse(raw);
    return {
      users: Array.isArray(obj.users) ? obj.users : [],
      suppliers: Array.isArray(obj.suppliers) ? obj.suppliers : [],
      invoices: Array.isArray(obj.invoices) ? obj.invoices : [],
    };
  } catch {
    return { users: [], suppliers: [], invoices: [] };
  }
}

// 全量写入某用户数据文件（仅存元数据，image_data 不进 JSON）
function writeUserFile(userId, data) {
  const file = userFilePath(userId);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, file); // 原子替换，避免写一半崩溃损坏
}

function stripImageData(inv) {
  // 返回剔除 image_data 的副本（图片已落盘为文件）
  const { image_data, ...rest } = inv;
  return rest;
}

// ===== 图片文件读写 =====
function writeImageFile(id, dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return;
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  try {
    fs.writeFileSync(path.join(imagesDir(), id + '.jpg'), Buffer.from(base64, 'base64'));
  } catch (e) {
    console.warn('[img] 写入失败', id, e);
  }
}
function deleteImageFile(id) {
  try {
    fs.rmSync(path.join(imagesDir(), id + '.jpg'), { force: true });
  } catch { /* ignore */ }
}
function readImageFile(id) {
  const file = path.join(imagesDir(), id + '.jpg');
  if (!fs.existsSync(file)) return '';
  try {
    return 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
  } catch {
    return '';
  }
}

// 清理已删除发票对应的图片文件
function cleanupImages(oldIds, newIds) {
  const keep = new Set(newIds);
  for (const id of oldIds) {
    if (!keep.has(id)) deleteImageFile(id);
  }
}

// ===== 自动更新 =====
function setupAutoUpdater() {
  if (isDev) return; // 开发态不检查更新
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: '发现新版本', message: '应付宝桌面端有新版本，正在后台下载…',
    });
  });
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新就绪',
      message: '新版本已下载完成。点击「立即安装」后，将弹出安装向导，请按提示逐步点击「下一步」完成安装（不会自动静默安装）。',
      buttons: ['立即安装', '稍后'],
    }).then(({ response }) => {
      if (response === 0) {
        // electron-updater 的 update-downloaded 事件不回传安装包路径，
        // 正确方式是用 installerPath 取值（即已下载的 setup.exe）。
        const file = autoUpdater.installerPath;
        if (!file) return;
        isQuitting = true;
        // 先关闭主程序释放文件锁，再由系统打开安装向导（不带 --updated，确保显示完整向导页）
        setTimeout(() => {
          shell.openPath(file);
          app.quit();
        }, 400);
      }
    });
  });
  autoUpdater.on('error', (e) => console.warn('[updater]', e));
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

// ===== 静态文件服务（app://）=====
function contentTypeOf(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (p.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.json')) return 'application/json; charset=utf-8';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.gif')) return 'image/gif';
  if (p.endsWith('.ico')) return 'image/x-icon';
  if (p.endsWith('.woff2')) return 'font/woff2';
  if (p.endsWith('.woff')) return 'font/woff';
  if (p.endsWith('.ttf')) return 'font/ttf';
  return 'application/octet-stream';
}

function registerAppProtocol() {
  const dist = path.join(__dirname, '..', 'dist');
  protocol.handle('app', (request) => {
    let urlPath = request.url
      .replace('app://./', '')
      .replace('app://', '');
    // 去掉 hash / query，避免 app://./index.html#/ 把 #/ 当成路径的一部分导致 404
    urlPath = urlPath.split('#')[0].split('?')[0];
    if (urlPath === '' || urlPath.endsWith('/')) urlPath += 'index.html';
    urlPath = decodeURIComponent(urlPath);
    const filePath = path.normalize(path.join(dist, urlPath));
    const safeRoot = path.normalize(dist);
    if (!filePath.startsWith(safeRoot)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(filePath)) {
      return new Response('Not Found', { status: 404 });
    }
    const body = fs.readFileSync(filePath);
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': contentTypeOf(filePath) },
    });
  });
}

// ===== 窗口 =====
function createWindow() {
  mainWindow = new BrowserWindow({
    title: '应付宝',
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // 用户要求：点关闭按钮时最小化到托盘，而不是退出应用
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // HashRouter 需要以 #/ 结尾，确保 React Router 能正确匹配根路径
    mainWindow.loadURL('app://./index.html#/');
  }
}

// ===== 系统托盘 =====
function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  tray = new Tray(iconPath);
  tray.setToolTip('应付宝');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示应付宝',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 单击托盘图标也显示窗口
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
      }
    }
  });
}

// ===== 应用菜单（Windows 下隐藏默认菜单栏）=====
function setAppMenu() {
  // 用户要求不显示顶部菜单栏，全部走应用内 UI
  Menu.setApplicationMenu(null);
}

// ===== IPC 处理 =====
function registerIpc() {
  // 加载某用户全部数据（图片 image_data 不返回，以磁盘文件为准）
  ipcMain.handle('db:load', (e, userId) => {
    const data = readUserFile(userId);
    return {
      users: data.users,
      suppliers: data.suppliers,
      invoices: data.invoices.map(stripImageData),
      seq: { users: 1, suppliers: 1, invoices: 1 },
    };
  });

  // 全量保存（覆盖）供应商与发票；发票图片 base64 落盘
  function persist(userId, suppliers, invoices) {
    const old = readUserFile(userId);
    // 旧图片文件清单（用于清理已删除发票）
    const oldIds = old.invoices.map((i) => i.id);
    const newIds = invoices.map((i) => i.id);

    const writtenInvoices = invoices.map((inv) => {
      if (inv && inv.image_data) writeImageFile(inv.id, inv.image_data);
      return stripImageData(inv);
    });

    writeUserFile(userId, {
      users: old.users || [],
      suppliers,
      invoices: writtenInvoices,
    });
    cleanupImages(oldIds, newIds);
  }

  ipcMain.handle('db:save', (e, payload) => {
    const suppliers = payload?.suppliers || [];
    const invoices = payload?.invoices || [];
    const userId = invoices[0]?.user_id || suppliers[0]?.user_id || null;
    if (!userId) return;
    persist(userId, suppliers, invoices);
  });

  // 替换某用户全部供应商与发票（导入备份）
  ipcMain.handle('db:replace', (e, payload) => {
    const suppliers = payload?.suppliers || [];
    const invoices = payload?.invoices || [];
    const userId = invoices[0]?.user_id || suppliers[0]?.user_id || null;
    if (!userId) return;
    persist(userId, suppliers, invoices);
  });

  // ===== 桌面端本地用户管理 =====
  // 用户索引存于 meta.json：{ users: [{id, username, password_hash, company_name, account_period, created_at}] }
  // 每个用户业务数据存于 <id>.json

  const { pbkdf2Sync } = require('crypto');

  function verifyPassword(password, stored) {
    if (!stored || !stored.startsWith('pbkdf2:')) return false;
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const [, saltHex, hash] = parts;
    let salt;
    try { salt = Buffer.from(saltHex, 'hex'); } catch { return false; }
    try {
      const derived = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
      return derived === hash;
    } catch {
      return false;
    }
  }

  function readMeta() {
    try {
      return JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
    } catch {
      return { users: [] };
    }
  }

  function writeMeta(meta) {
    fs.writeFileSync(metaPath(), JSON.stringify(meta), 'utf8');
  }

  function migrateLegacyDesktopUser() {
    // 旧版默认用户：meta.json 里的 currentUserId 指向一个数据文件，里面 users 数组有"本地用户"
    const meta = readMeta();
    if (meta.users && meta.users.length) return;
    const legacyId = meta.currentUserId;
    if (!legacyId) return;
    const data = readUserFile(legacyId);
    if (!data.users || !data.users.length) return;
    const old = data.users[0];
    meta.users = [{
      id: legacyId,
      username: old.username === '本地用户' ? 'admin' : old.username,
      password_hash: '', // 旧版无密码，留空表示无密码可直接登录
      company_name: old.company_name || '',
      email: old.email || '',
      avatar: old.avatar || '',
      account_period: old.account_period ?? 90,
      created_at: old.created_at || new Date().toISOString(),
    }];
    delete meta.currentUserId;
    writeMeta(meta);
  }

  ipcMain.handle('user:list', () => {
    migrateLegacyDesktopUser();
    const meta = readMeta();
    return (meta.users || []).map((u) => ({
      id: u.id,
      username: u.username,
      company_name: u.company_name || '',
      avatar: u.avatar || '',
      account_period: u.account_period ?? 90,
      created_at: u.created_at,
    }));
  });

  ipcMain.handle('user:create', (e, { username, password_hash, company_name = '', account_period = 90, avatar = '' }) => {
    migrateLegacyDesktopUser();
    const meta = readMeta();
    if ((meta.users || []).some((u) => u.username === username)) {
      throw new Error('用户名已存在');
    }
    const id = crypto.randomUUID();
    const user = {
      id,
      username,
      password_hash: password_hash || '',
      company_name,
      email: '',
      avatar,
      account_period,
      created_at: new Date().toISOString(),
    };
    meta.users = [...(meta.users || []), user];
    writeMeta(meta);
    // 初始化空业务数据文件
    writeUserFile(id, { users: [], suppliers: [], invoices: [] });
    return { id, username, company_name, avatar, account_period };
  });

  ipcMain.handle('user:verify', (e, { username, password }) => {
    migrateLegacyDesktopUser();
    const meta = readMeta();
    const u = (meta.users || []).find((x) => x.username === username);
    if (!u) throw new Error('用户名或密码错误');
    // 旧版迁移用户可能未设置密码，允许空密码直接登录
    if (u.password_hash && !verifyPassword(password || '', u.password_hash)) throw new Error('用户名或密码错误');
    return { id: u.id, username: u.username, company_name: u.company_name || '', avatar: u.avatar || '', account_period: u.account_period ?? 90, hasPassword: !!u.password_hash };
  });

  ipcMain.handle('user:update', (e, { id, username, company_name }) => {
    migrateLegacyDesktopUser();
    const meta = readMeta();
    const idx = (meta.users || []).findIndex((u) => u.id === id);
    if (idx < 0) throw new Error('用户不存在');
    if (username && username !== meta.users[idx].username) {
      if ((meta.users || []).some((u) => u.id !== id && u.username === username)) {
        throw new Error('用户名已存在');
      }
      meta.users[idx].username = username;
    }
    if (company_name !== undefined) meta.users[idx].company_name = company_name;
    writeMeta(meta);
    // 同步更新数据文件里的 users[0].username/company_name（若存在）
    const data = readUserFile(id);
    if (data.users && data.users.length) {
      if (username) data.users[0].username = username;
      if (company_name !== undefined) data.users[0].company_name = company_name;
      writeUserFile(id, data);
    }
    return { id, username: meta.users[idx].username, company_name: meta.users[idx].company_name };
  });

  ipcMain.handle('user:changePassword', (e, { id, password_hash }) => {
    migrateLegacyDesktopUser();
    const meta = readMeta();
    const idx = (meta.users || []).findIndex((u) => u.id === id);
    if (idx < 0) throw new Error('用户不存在');
    meta.users[idx].password_hash = password_hash;
    writeMeta(meta);
    return true;
  });

  ipcMain.handle('user:delete', (e, id) => {
    migrateLegacyDesktopUser();
    const meta = readMeta();
    meta.users = (meta.users || []).filter((u) => u.id !== id);
    writeMeta(meta);
    try { fs.rmSync(userFilePath(id), { force: true }); } catch { /* ignore */ }
    return true;
  });

  // 旧接口：启动账期更新
  ipcMain.handle('db:updateUserPeriod', (e, id, period) => {
    const meta = readMeta();
    const idx = (meta.users || []).findIndex((u) => u.id === id);
    if (idx >= 0) {
      meta.users[idx].account_period = period;
      writeMeta(meta);
    }
    const data = readUserFile(id);
    if (data.users && data.users.length) {
      data.users[0].account_period = period;
      writeUserFile(id, data);
    }
  });

  ipcMain.handle('img:read', (e, id) => readImageFile(id));
  ipcMain.handle('img:write', (e, id, base64) => { if (base64) writeImageFile(id, base64); });
  ipcMain.handle('img:delete', (e, id) => deleteImageFile(id));

  // 百度 OCR 直连（用户自填 Key，主进程发请求规避 CORS）
  ipcMain.handle('baidu:ocr', async (e, imageB64, apiKey, secretKey) => {
    const tokenRes = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`,
    );
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      throw new Error('百度鉴权失败：' + (tokenJson.error_description || tokenJson.error || '未知错误'));
    }
    const ocrRes = await fetch(
      `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${tokenJson.access_token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `image=${encodeURIComponent(imageB64)}`,
      },
    );
    const ocrJson = await ocrRes.json();
    if (ocrJson.error_code) throw new Error('百度 OCR 错误：' + (ocrJson.error_msg || ocrJson.error_code));
    return (ocrJson.words_result || []).map((w) => w.words).join('\n');
  });

  // 仅验证百度 OCR Key 是否能拿到 access_token（配置页使用，避免用户填错）
  ipcMain.handle('baidu:validateKey', async (e, apiKey, secretKey) => {
    const tokenRes = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`,
    );
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      throw new Error('百度鉴权失败：' + (tokenJson.error_description || tokenJson.error || '未知错误'));
    }
    return true;
  });

  // 应付宝共享百度 OCR：由主进程代调 Supabase Edge Function（baidu-ocr）。
  // 渲染进程运行在 app:// 协议下，跨域请求可能被拦截，走主进程可彻底规避该问题。
  ipcMain.handle('ocr:shared', async (e, body) => {
    const res = await fetch(SUPABASE_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body || { action: 'quota' }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text || ('服务端返回异常（HTTP ' + res.status + '）') };
    }
    return { status: res.status, data: json };
  });

  ipcMain.handle('app:openDataFolder', () => { shell.openPath(dataDir()); });
  ipcMain.handle('app:openExternal', (e, url) => { shell.openExternal(url); });
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:checkUpdate', () => { if (!isDev) autoUpdater.checkForUpdatesAndNotify().catch(() => {}); });
}

// ===== 启动 =====
app.whenReady().then(() => {
  ensureDataDir();
  registerAppProtocol();
  registerIpc();
  setAppMenu();
  setupAutoUpdater();
  createWindow();
  createTray();

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    // macOS：点击 Dock 图标时，如果窗口被隐藏则显示
    if (mainWindow) {
      mainWindow.show();
    } else {
      createWindow();
    }
  });
});

// 真正退出前先标记，避免 close 事件被拦截
app.on('before-quit', () => {
  isQuitting = true;
});

// 有托盘时，Windows 下「所有窗口关闭」不退出应用，保持托盘常驻
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) {
    app.quit();
  }
});
