// 云端数据层：以 Supabase 为云端主存储，本地维护「当前用户」的内存镜像缓存。
// 对外接口 readDB / writeDB / nextId 签名保持与原 localStorage 版一致，
// 因此 api/client.ts 的全部业务逻辑（去重、派生状态、关联供应商等）无需改动。
//
// 数据隔离：应用层按 user_id 过滤（与原来按 userId 过滤的语义一致）。
// 同步策略：writeDB 同步更新内存缓存，并触发后台串行的 upsert 同步到云端，
//           下一次 readDB 立即读到最新内存数据，云端最终一致。

import { supabase } from './supabase';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  company_name: string;
  email: string;
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

// 旧版 localStorage 的 key（迁移后清除）
const LOCAL_KEY = 'yingfubao_db_v1';

// ===== 内存缓存（当前用户视角）=====
let cache: DBShape | null = null;
let cacheUserId: string | null = null;
let syncChain: Promise<void> = Promise.resolve();

function emptyDB(): DBShape {
  return { users: [], suppliers: [], invoices: [], seq: { users: 1, suppliers: 1, invoices: 1 } };
}

export function readDB(): DBShape {
  return cache ?? emptyDB();
}

export function writeDB(db: DBShape): void {
  cache = db;
  syncToCloud();
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

function invoiceToRow(i: Invoice): Record<string, unknown> {
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
    raw_text: r.raw_text,
    file_name: r.file_name,
    image_data: r.image_data,
    created_at: r.created_at,
  };
}

// ===== 云端同步（串行化，避免并发覆盖）=====
function syncToCloud() {
  if (!cache || !cacheUserId) return;
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
          .upsert(data.invoices.map(invoiceToRow), { onConflict: 'id' });
      }
    } catch (e) {
      console.warn('云端同步失败', e);
    }
  });
}

async function loadCloud(userId: string): Promise<DBShape> {
  const [supRes, invRes] = await Promise.all([
    supabase.from('suppliers').select('*').eq('user_id', userId),
    supabase.from('invoices').select('*').eq('user_id', userId),
  ]);
  const suppliers = ((supRes.data as any[]) || []).map(rowToSupplier);
  const invoices = ((invRes.data as any[]) || []).map(rowToInvoice);
  return { users: [], suppliers, invoices, seq: { users: 1, suppliers: 1, invoices: 1 } };
}

// ===== 初始化：加载云端 + 迁移本地旧数据 =====
export async function initUserDB(userId: string): Promise<void> {
  cacheUserId = userId;
  cache = await loadCloud(userId);
  await migrateLocalIfNeeded(userId);
}

export function clearUserCache(): void {
  cache = null;
  cacheUserId = null;
  syncChain = Promise.resolve();
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
  cache = await loadCloud(userId);
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
