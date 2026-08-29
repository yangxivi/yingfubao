// 渲染冒烟测试：复用主进程 app:// 协议逻辑，加载 app://./index.html#/，检查 DOM 是否渲染
const electron = require('electron');
console.log('EV_ELECTRON', process.versions.electron);
console.log('IS_ARRAY', Array.isArray(electron));
console.log('ELECTRON_KEYS', Object.keys(electron).slice(0,8).join(','));
const { app, BrowserWindow, protocol } = electron;
const path = require('path');
const fs = require('fs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true } },
]);

function contentTypeOf(p) {
  if (p.endsWith('.html')) return 'text/html';
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'text/javascript';
  if (p.endsWith('.css')) return 'text/css';
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.ico')) return 'image/x-icon';
  if (p.endsWith('.woff2')) return 'font/woff2';
  if (p.endsWith('.woff')) return 'font/woff';
  if (p.endsWith('.ttf')) return 'font/ttf';
  return 'application/octet-stream';
}

function registerAppProtocol() {
  const dist = path.resolve(__dirname, 'dist');
  protocol.handle('app', (request) => {
    let urlPath = request.url.replace('app://./', '').replace('app://', '');
    urlPath = urlPath.split('#')[0].split('?')[0];
    if (urlPath === '' || urlPath.endsWith('/')) urlPath += 'index.html';
    urlPath = decodeURIComponent(urlPath);
    const filePath = path.normalize(path.join(dist, urlPath));
    const safeRoot = path.normalize(dist);
    if (!filePath.startsWith(safeRoot)) return new Response('Forbidden', { status: 403 });
    if (!fs.existsSync(filePath)) return new Response('Not Found', { status: 404 });
    const body = fs.readFileSync(filePath);
    return new Response(body, { status: 200, headers: { 'Content-Type': contentTypeOf(filePath) } });
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  const w = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  const errors = [];
  w.webContents.on('console-message', (e) => { if (e.type === 'error') errors.push(e.message); });
  w.webContents.on('did-fail-load', (e, code, desc) => errors.push('FAILED ' + code + ' ' + desc));

  w.loadURL('app://./index.html#/');
  setTimeout(async () => {
    try {
      const info = await w.webContents.executeJavaScript(
        `(function(){ var r=document.getElementById('root'); return { title:document.title, rootLen: r? r.innerHTML.length:-1, bodyText: document.body? document.body.innerText.replace(/\\s+/g,' ').slice(0,200):'', hasContent: !!(r && r.children.length>0) }; })()`
      );
      console.log('RENDER_RESULT ' + JSON.stringify(info));
      console.log('CONSOLE_ERRORS ' + JSON.stringify(errors.slice(0, 10)));
    } catch (e) {
      console.log('EVAL_ERROR ' + e.message);
    }
    app.quit();
  }, 4500);
});
