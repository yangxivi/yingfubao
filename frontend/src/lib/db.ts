// 本地数据层：使用 localStorage 持久化（浏览器内，无需后端服务器）
// 替代后端的 SQLite；数据按 userId 隔离，支持多账号。

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  company_name: string;
  email: string;
  created_at: string;
}

export interface Supplier {
  id: number;
  userId: number;
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
  id: number;
  userId: number;
  supplier_id: number | null;
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

const KEY = 'yingfubao_db_v1';

export function readDB(): DBShape {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DBShape;
  } catch (e) {
    console.warn('读取本地数据库失败', e);
  }
  return {
    users: [],
    suppliers: [],
    invoices: [],
    seq: { users: 1, suppliers: 1, invoices: 1 },
  };
}

export function writeDB(db: DBShape): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.warn('写入本地数据库失败', e);
    throw new Error('本地存储空间不足或不可用');
  }
}

export function nextId(db: DBShape, key: 'users' | 'suppliers' | 'invoices'): number {
  const id = db.seq[key];
  db.seq[key] = id + 1;
  return id;
}

// ===== 数据备份：导出 / 导入 JSON（按当前用户隔离）=====

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
export function exportUserBackup(userId: number): BackupFile {
  const db = readDB();
  const user = db.users.find((u) => u.id === userId);
  return {
    app: 'yingfubao',
    version: 1,
    exportedAt: new Date().toISOString(),
    username: user?.username || '',
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

/** 导入备份：替换当前用户的供应商与发票（先清除再写入），并修正自增序号避免冲突 */
export function importUserBackup(userId: number, backup: BackupFile): void {
  const db = readDB();
  // 清除当前用户现有数据
  db.suppliers = db.suppliers.filter((s) => s.userId !== userId);
  db.invoices = db.invoices.filter((i) => i.userId !== userId);
  // 写入导入数据（统一归属当前用户）
  for (const s of backup.data.suppliers) {
    db.suppliers.push({ ...s, userId });
  }
  for (const i of backup.data.invoices) {
    db.invoices.push({ ...i, userId });
  }
  // 修正自增序号，避免后续新建时 id 冲突
  const maxSupplierId = db.suppliers.reduce((m, s) => Math.max(m, s.id), 0);
  const maxInvoiceId = db.invoices.reduce((m, i) => Math.max(m, i.id), 0);
  db.seq.suppliers = Math.max(db.seq.suppliers, maxSupplierId + 1);
  db.seq.invoices = Math.max(db.seq.invoices, maxInvoiceId + 1);
  writeDB(db);
}

