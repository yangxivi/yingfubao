// 云端数据层（主）+ 本地降级（备）
//   - 云端模式：以 Supabase 为云端主存储，本地维护内存镜像缓存。
//   - 本地模式：Supabase 未初始化时，数据存于 localStorage（单浏览器可用）。
//
// 对外接口 readDB / writeDB / nextId 签名保持一致，
// api/client.ts 的全部业务逻辑无需改动。

import { supabase } from './supabase';
import { getAuthMode } from './auth';
import { isDesktop, electronAPI } from './desktop-env';
import { generateAvatar } from './avatar';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  company_name: string;
  email: string;
  avatar: string; // 用户名首字头像 data URL
  account_period: number; // 账期天数，默认 90
  created_at: string;
}

export interface Supplier {
  id: string;
  userId: string;
  name: string;
  tax_id: string;
  contact_person: string;
  phone: string;
  address: string;
  bank_name: string;
  bank_account: string;
  notes: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  userId: string;
  supplier_id: string | null;
  invoice_no: string;
  invoice_date: string; // YYYY-MM-DD
  payment_date: string; // YYYY-MM-DD
  amount_excluding_tax: number;
  tax_amount: number;
  total_amount: number;
  tax_rate: string;
  business_month: string;
  remark: string;
  buyer_name: string;
  buyer_tax_id: string;
  seller_name: string;
  seller_tax_id: string;
  status: string; // pending | paid （overdue 为查询时派生）
  payment_auto: boolean; // 付款日期是否由账期自动派生（手动修改则为 false）
  raw_text: string;
  file_name: string;
  image_data: string; // base64 原始发票图片
  created_at: string;
}

export interface DBShape {
  users: User[];
  suppliers: Supplier[];
  invoices: Invoice[];
  seq: { users: number; suppliers: number; invoices: number };
}

/** 清洗 OCR 误带入供应商名称的前缀，如「名称：西安 XX 公司」→「西安 XX 公司」 */
export function normalizeSupplierName(name: string): string {
  return (name || '').replace(/^(名称[：:\s]*)/, '').trim();
}

// 旧版 localStorage 的 key（迁移后清除）
const LOCAL_KEY = 'yingfubao_db_v1';
// 本地模式的数据 key（按 userId 隔离）
const LOCAL_DB_KEY_PREFIX = 'yingfubao_local_db_';

// ===== 内存缓存（当前用户视角）=====
let cache: DBShape | null = null;
let cacheUserId: string | null = null;
let syncChain: Promise<void> = Promise.resolve();
// 是否处于本地模式
let isLocalMode = false;
// 是否处于桌面端（Electron）模式
let isDesktopMode = false;

function emptyDB(): DBShape {
  return { users: [], suppliers: [], invoices: [], seq: { users: 1, suppliers: 1, invoices: 1 } };
}

export function readDB(): DBShape {
  return cache ?? emptyDB();
}

export function writeDB(db: DBShape): void {
  cache = db;
  if (isDesktopMode) {
    // 桌面端：持久化到本地 SQLite（经 IPC，主进程落盘 + 图片写磁盘文件）
    persistDesktop();
  } else if (isLocalMode && cacheUserId) {
    // 本地模式：同时持久化到 localStorage
    try {
      localStorage.setItem(LOCAL_DB_KEY_PREFIX + cacheUserId, JSON.stringify(db));
    } catch { /* ignore */ }
  } else {
    syncToCloud();
  }
}

// 全局唯一 id（uuid），避免多设备 / 多浏览器并发创建时 id 冲突
export function nextId(_db: DBShape, _key: 'users' | 'suppliers' | 'invoices'): string {
  return crypto.randomUUID();
}

// ===== camelCase <-> snake_case 映射 =====
function supplierToRow(s: Supplier): Record<string, unknown> {
  return {
    id: s.id,
    user_id: s.userId,
    name: s.name,
    tax_id: s.tax_id,
    contact_person: s.contact_person,
    phone: s.phone,
    address: s.address,
    bank_name: s.bank_name,
    bank_account: s.bank_account,
    notes: s.notes,
    created_at: s.created_at,
  };
}

function rowToSupplier(r: any): Supplier {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    tax_id: r.tax_id,
    contact_person: r.contact_person,
    phone: r.phone,
    address: r.address,
    bank_name: r.bank_name,
    bank_account: r.bank_account,
    notes: r.notes,
    created_at: r.created_at,
  };
}

export function invoiceToRow(i: Invoice): Record<string, unknown> {
  return {
    id: i.id,
    user_id: i.userId,
    supplier_id: i.supplier_id,
    invoice_no: i.invoice_no,
    invoice_date: i.invoice_date,
    payment_date: i.payment_date,
    amount_excluding_tax: i.amount_excluding_tax,
    tax_amount: i.tax_amount,
    total_amount: i.total_amount,
    tax_rate: i.tax_rate,
    business_month: i.business_month,
    remark: i.remark,
    buyer_name: i.buyer_name,
    buyer_tax_id: i.buyer_tax_id,
    seller_name: i.seller_name,
    seller_tax_id: i.seller_tax_id,
    status: i.status,
    payment_auto: i.payment_auto,
    raw_text: i.raw_text,
    file_name: i.file_name,
    image_data: i.image_data,
    created_at: i.created_at,
  };
}

function rowToInvoice(r: any): Invoice {
  return {
    id: r.id,
    userId: r.user_id,
    supplier_id: r.supplier_id,
    invoice_no: r.invoice_no,
    invoice_date: r.invoice_date,
    payment_date: r.payment_date,
    amount_excluding_tax: Number(r.amount_excluding_tax) || 0,
    tax_amount: Number(r.tax_amount) || 0,
    total_amount: Number(r.total_amount) || 0,
    tax_rate: r.tax_rate,
    business_month: r.business_month,
    remark: r.remark,
    buyer_name: r.buyer_name,
    buyer_tax_id: r.buyer_tax_id,
    seller_name: r.seller_name,
    seller_tax_id: r.seller_tax_id,
    status: r.status,
    payment_auto: r.payment_auto !== false, // 旧数据缺省视为自动派生
    raw_text: r.raw_text,
    file_name: r.file_name,
    image_data: r.image_data,
    created_at: r.created_at,
  };
}

// 云端同步用的发票行：剔除 image_data（base64 大图，UI 从不展示，启动预热也已排除）。
// 这样每次写入不会再回传全量 base64 图片，显著降低写放大与带宽消耗
// （Supabase upsert 仅更新提供的列，已有行的 image_data 不会被清空）。
function invoiceToSyncRow(i: Invoice): Record<string, unknown> {
  const row = invoiceToRow(i);
  delete (row as Record<string, unknown>).image_data;
  return row;
}

// ===== 云端同步（串行化，避免并发覆盖）=====
function syncToCloud() {
  if (!cache || !cacheUserId || isLocalMode) return; // 本地模式不同步云端
  const data = cache;
  const userId = cacheUserId;
  syncChain = syncChain.then(async () => {
    try {
      if (data.suppliers.length) {
        await supabase
          .from('suppliers')
          .upsert(data.suppliers.map(supplierToRow), { onConflict: 'id' });
      }
      if (data.invoices.length) {
        await supabase
          .from('invoices')
          .upsert(data.invoices.map(invoiceToSyncRow), { onConflict: 'id' });
      }
    } catch (e) {
      console.warn('云端同步失败', e);
    }
  });
}

async function loadCloud(userId: string): Promise<DBShape> {
  // 启动预热：仅拉取业务字段，不包含 image_data（base64 大图）。
  // 列表通过 file_name 判断是否有附件，详情/预览时再通过 invoiceApi.loadImage 按需拉取 image_data。
  // 这能显著降低首次进入的数据下载量与耗时。
  const invoiceColumns = [
    'id', 'user_id', 'supplier_id', 'invoice_no', 'invoice_date', 'payment_date',
    'amount_excluding_tax', 'tax_amount', 'total_amount', 'tax_rate', 'business_month',
    'remark', 'buyer_name', 'buyer_tax_id', 'seller_name', 'seller_tax_id', 'status',
    'payment_auto', 'raw_text', 'file_name', 'created_at',
  ].join(',');
  const [supRes, invRes] = await Promise.all([
    supabase.from('suppliers').select('*').eq('user_id', userId),
    supabase.from('invoices').select(invoiceColumns).eq('user_id', userId),
  ]);
  const suppliers = ((supRes.data as any[]) || []).map(rowToSupplier);
  const invoices = ((invRes.data as any[]) || []).map(rowToInvoice);
  return { users: [], suppliers, invoices, seq: { users: 1, suppliers: 1, invoices: 1 } };
}

// ===== 桌面端（Electron）：本地 SQLite 持久化（经 IPC）=====
// 复用与云端模式一致的「内存缓存 + 异步持久化」模型，仅把持久化后端从 Supabase
// 换成主进程内的 SQLite（离线、无 localStorage 5MB 容量上限、他人数据不进云库）。
// 图片以磁盘文件存于 %APPDATA%/YingFuBao/images/<id>.jpg，SQLite 仅存元数据。

let persistChain: Promise<void> = Promise.resolve();

async function loadDesktop(userId: string): Promise<DBShape> {
  const api = electronAPI();
  if (!api) return emptyDB();
  const data = await api.dbLoad(userId);
  const users = (data.users || []).map((r: any) => ({
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    company_name: r.company_name || '',
    email: r.email || '',
    avatar: r.avatar || generateAvatar(r.username),
    account_period: r.account_period ?? 90,
    created_at: r.created_at,
  }));
  const suppliers = (data.suppliers || []).map(rowToSupplier);
  // image_data 由主进程剥离（已落盘为图片文件），此处恒为空，loadImage 改为读磁盘
  const invoices = (data.invoices || []).map(rowToInvoice);
  return { users, suppliers, invoices, seq: { users: 1, suppliers: 1, invoices: 1 } };
}

function persistDesktop(): void {
  if (!cache || !cacheUserId) return;
  const api = electronAPI();
  if (!api) return;
  const userId = cacheUserId;
  const payload = {
    suppliers: cache.suppliers.filter((s) => s.userId === userId).map(supplierToRow),
    invoices: cache.invoices.filter((i) => i.userId === userId).map(invoiceToRow),
  };
  persistChain = persistChain.then(async () => {
    try {
      await api.dbSave(payload);
    } catch (e) {
      console.warn('[desktop] 本地数据保存失败', e);
    }
  });
}

// ===== 初始化：加载云端 + 迁移本地旧数据（云端模式） / 加载 localStorage（本地模式）=====
export async function initUserDB(userId: string): Promise<void> {
  cacheUserId = userId;

  if (isDesktop()) {
    // 桌面端：从本地 SQLite 加载（图片以磁盘文件为准，image_data 留空）
    isDesktopMode = true;
    isLocalMode = false;
    cache = await loadDesktop(userId);
    return;
  }

  isLocalMode = getAuthMode() === 'local';

  if (isLocalMode) {
    // 本地模式：从 localStorage 加载
    cache = loadLocal(userId);
    await migrateLocalIfNeeded(userId);
  } else {
    // 云端模式
    cache = await loadCloud(userId);
    await migrateLocalIfNeeded(userId);
  }
}

/** 本地模式：从 localStorage 加载用户数据 */
function loadLocal(userId: string): DBShape {
  try {
    const raw = localStorage.getItem(LOCAL_DB_KEY_PREFIX + userId);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  // 尝试从旧版 key 迁移
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const old: any = JSON.parse(raw);
      const suppliers = (old.suppliers || []).filter((s: any) => String(s.userId) === String(userId));
      const invoices = (old.invoices || []).filter((i: any) => String(i.userId) === String(userId));
      return { users: [], suppliers, invoices, seq: { users: 1, suppliers: 1, invoices: 1 } };
    }
  } catch { /* ignore */ }
  return emptyDB();
}

/** 供 auth.ts 调用：用旧数据直接初始化缓存（无需 async） */
export function initLocalCache(suppliers: any[], invoices: any[]): void {
  cache = {
    users: [],
    suppliers: suppliers || [],
    invoices: invoices || [],
    seq: { users: 1, suppliers: 1, invoices: 1 },
  };
}

export function clearUserCache(): void {
  cache = null;
  cacheUserId = null;
  isLocalMode = false;
  isDesktopMode = false;
  syncChain = Promise.resolve();
  persistChain = Promise.resolve();
}

// 首次使用时，把该账号在 localStorage 中的旧数据合并迁移到云端（按业务键去重），之后清除本地旧库
async function migrateLocalIfNeeded(userId: string): Promise<void> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LOCAL_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  let old: any;
  try {
    old = JSON.parse(raw);
  } catch {
    return;
  }
  const oldSuppliers = (old.suppliers || []).filter((s: any) => String(s.userId) === String(userId));
  const oldInvoices = (old.invoices || []).filter((i: any) => String(i.userId) === String(userId));
  if (!oldSuppliers.length && !oldInvoices.length) {
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch {
      /* ignore */
    }
    return;
  }

  // 本地模式：不写云端，仅清除旧库避免重复迁移
  if (isLocalMode) {
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch {
      /* ignore */
    }
    return;
  }

  // 云端已有数据（用于去重，避免重复迁入）
  const [cloudSup, cloudInv] = await Promise.all([
    supabase.from('suppliers').select('id,name').eq('user_id', userId),
    supabase.from('invoices').select('id,invoice_no,seller_name,total_amount').eq('user_id', userId),
  ]);
  const supNameSet = new Set(((cloudSup.data as any[]) || []).map((s) => s.name));
  const invSet = new Set(
    ((cloudInv.data as any[]) || []).map((i) => `${i.invoice_no}|${i.seller_name}|${i.total_amount}`),
  );

  const supMap = new Map<string, string>();
  const newSup: any[] = [];
  for (const s of oldSuppliers) {
    if (supNameSet.has(s.name)) {
      const ex = ((cloudSup.data as any[]) || []).find((c) => c.name === s.name);
      if (ex) supMap.set(String(s.id), ex.id);
      continue;
    }
    const nid = crypto.randomUUID();
    supMap.set(String(s.id), nid);
    newSup.push({ ...s, id: nid, userId });
  }
  if (newSup.length) await supabase.from('suppliers').upsert(newSup.map(supplierToRow));

  const newInv: any[] = [];
  for (const i of oldInvoices) {
    const key = `${i.invoice_no}|${i.seller_name}|${i.total_amount}`;
    if (invSet.has(key)) continue;
    const nid = crypto.randomUUID();
    newInv.push({
      ...i,
      id: nid,
      userId,
      supplier_id: i.supplier_id != null ? supMap.get(String(i.supplier_id)) || null : null,
    });
  }
  if (newInv.length) await supabase.from('invoices').upsert(newInv.map(invoiceToRow));

  // 重新加载缓存，并清除本地旧库，避免下次重复迁移
  if (!isLocalMode) {
    cache = await loadCloud(userId);
  }
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

// ===== 数据备份：导出 / 导入 JSON（基于当前云端缓存）=====

export interface BackupFile {
  app: 'yingfubao';
  version: 1;
  exportedAt: string; // ISO
  username: string;
  data: {
    suppliers: Supplier[];
    invoices: Invoice[];
  };
}

/** 导出当前用户的供应商与发票为备份对象 */
export function exportUserBackup(userId: string): BackupFile {
  const db = readDB();
  return {
    app: 'yingfubao',
    version: 1,
    exportedAt: new Date().toISOString(),
    username: '',
    data: {
      suppliers: db.suppliers.filter((s) => s.userId === userId),
      invoices: db.invoices.filter((i) => i.userId === userId),
    },
  };
}

/** 校验导入的备份对象是否合法 */
export function isBackupFile(obj: unknown): obj is BackupFile {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (o.app !== 'yingfubao' || o.version !== 1) return false;
  if (!o.data || typeof o.data !== 'object') return false;
  const d = o.data as Record<string, unknown>;
  if (!Array.isArray(d.suppliers) || !Array.isArray(d.invoices)) return false;
  return true;
}

/** 导入备份：替换当前用户在云端的供应商与发票（先清除再写入），并修正引用关系 */
export async function importUserBackup(userId: string, backup: BackupFile): Promise<void> {
  if (isDesktop()) {
    const api = electronAPI();
    if (api) {
      // 网页端（云端账号）导出的备份 userId 与桌面端本地账号不同，
      // 必须重写为当前登录的桌面用户，否则重登后数据挂在另一个用户下。
      const supMap = new Map<string, string>();
      const newSup = backup.data.suppliers.map((s) => {
        const nid = crypto.randomUUID();
        supMap.set(s.id, nid);
        return { ...s, id: nid, userId };
      });
      const newInv = backup.data.invoices.map((i) => ({
        ...i,
        id: crypto.randomUUID(),
        userId,
        supplier_id: i.supplier_id != null ? supMap.get(i.supplier_id) || null : null,
      }));
      await api.dbReplace({
        suppliers: newSup.map(supplierToRow),
        invoices: newInv.map(invoiceToRow),
      });
      cache = await loadDesktop(userId);
    }
    return;
  }
  await supabase.from('suppliers').delete().eq('user_id', userId);
  await supabase.from('invoices').delete().eq('user_id', userId);

  const supMap = new Map<string, string>();
  const newSup = backup.data.suppliers.map((s) => {
    const nid = crypto.randomUUID();
    supMap.set(s.id, nid);
    return { ...s, id: nid, userId };
  });
  const newInv = backup.data.invoices.map((i) => ({
    ...i,
    id: crypto.randomUUID(),
    userId,
    supplier_id: i.supplier_id != null ? supMap.get(i.supplier_id) || null : null,
  }));
  if (newSup.length) await supabase.from('suppliers').upsert(newSup.map(supplierToRow));
  if (newInv.length) await supabase.from('invoices').upsert(newInv.map(invoiceToRow));

  cache = await loadCloud(userId);
}
