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
