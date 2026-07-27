// 本地后端模拟层（纯前端，无服务器）
// 对外暴露与后端一致的接口形状：每个方法返回 Promise<{ data: T }>，
// 业务错误抛出 { response: { data: { detail } } } 以兼容页面现有错误处理。
// 数据存于浏览器 localStorage（db.ts），OCR 在浏览器用 Tesseract.js（ocr.ts），鉴权用 Web Crypto（auth.ts）。

import { readDB, writeDB, nextId } from '../lib/db';
import type { Invoice, Supplier } from '../lib/db';
import * as authLib from '../lib/auth';
import { recognizeInvoice } from '../lib/ocr';

// ------- 错误处理：兼容 axios 风格 -------
function fail(msg: string): never {
  throw { response: { data: { detail: msg } } };
}

async function guard<T>(fn: () => T | Promise<T>): Promise<{ data: T }> {
  try {
    return { data: await fn() };
  } catch (e: any) {
    if (e && e.response && e.response.data && e.response.data.detail) throw e;
    const msg = e?.message || '操作失败';
    throw { response: { data: { detail: msg } } };
  }
}

/** 将 File 转为 base64（用于 localStorage 存储） */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}
function getUserId(): number {
  const id = authLib.getCurrentUserId();
  if (!id) fail('请先登录');
  return id as number;
}

function addDays(dateStr: string, days: number): string {
  if (!dateStr) return '';
  const dt = new Date(dateStr + 'T00:00:00');
  if (isNaN(dt.getTime())) return '';
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

function today(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

// 派生状态：paid 保持；否则若付款日早于今天则 overdue
function decorate(inv: Invoice, suppliers: Supplier[]): any {
  const sup = suppliers.find((s) => s.id === inv.supplier_id);
  let status = inv.status;
  if (status !== 'paid' && inv.payment_date) {
    const pd = new Date(inv.payment_date + 'T00:00:00');
    if (pd < today()) status = 'overdue';
  }
  return {
    ...inv,
    supplier_name: sup ? sup.name : inv.seller_name,
    supplier_tax_id: sup ? sup.tax_id : inv.seller_tax_id,
    status,
  };
}

// 按名称查找或创建供应商，返回 id（name 为空返回 null）
function ensureSupplier(userId: number, name?: string, taxId?: string): number | null {
  const nm = (name || '').trim();
  if (!nm) return null;
  const db = readDB();
  const existing = db.suppliers.find(
    (s) => s.userId === userId && s.name.trim() === nm,
  );
  if (existing) {
    // 若提供了税号且原为空，补全
    if (taxId && !existing.tax_id) {
      existing.tax_id = taxId;
      writeDB(db);
    }
    return existing.id;
  }
  const id = nextId(db, 'suppliers');
  const sup: Supplier = {
    id,
    userId,
    name: nm,
    tax_id: taxId || '',
    contact_person: '',
    phone: '',
    address: '',
    bank_name: '',
    bank_account: '',
    notes: '',
    created_at: new Date().toISOString(),
  };
  db.suppliers.push(sup);
  writeDB(db);
  return id;
}

// ------- Auth -------
export const authApi = {
  register: (data: { username: string; password: string; company_name?: string; email?: string }) =>
    guard(() => authLib.registerUser(data)),
  login: (data: { username: string; password: string }) => guard(() => authLib.loginUser(data)),
  me: () => guard(() => authLib.getMe()),
};

// ------- Invoices -------
export const invoiceApi = {
  list: (params?: any) =>
    guard<any[]>(() => {
      const userId = getUserId();
      const db = readDB();
      const suppliers = db.suppliers.filter((s) => s.userId === userId);
      let list = db.invoices.filter((i) => i.userId === userId).map((i) => decorate(i, suppliers));

      if (params?.search) {
        const q = String(params.search).toLowerCase();
        list = list.filter((i) => (i.invoice_no || '').toLowerCase().includes(q));
      }
      if (params?.status) list = list.filter((i) => i.status === params.status);
      if (params?.supplier_id) list = list.filter((i) => i.supplier_id === params.supplier_id);
      if (params?.date_from) list = list.filter((i) => i.invoice_date >= params.date_from!);
      if (params?.date_to) list = list.filter((i) => i.invoice_date <= params.date_to!);
      if (params?.amount_min !== undefined) list = list.filter((i) => (i.total_amount || 0) >= params.amount_min!);
      if (params?.amount_max !== undefined) list = list.filter((i) => (i.total_amount || 0) <= params.amount_max!);

      list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return list;
    }),

  get: (id: number) =>
    guard(() => {
      const userId = getUserId();
      const db = readDB();
      const suppliers = db.suppliers.filter((s) => s.userId === userId);
      const inv = db.invoices.find((i) => i.id === id && i.userId === userId);
      if (!inv) fail('发票不存在');
      return decorate(inv as Invoice, suppliers);
    }),

  create: (data: any) =>
    guard(() => {
      const userId = getUserId();
      const db = readDB();
      // 处理供应商
      let supplierId: number | null = data.supplier_id ?? null;
      if (!supplierId && data.supplier_name) {
        supplierId = ensureSupplier(userId, data.supplier_name, data.supplier_tax_id);
      }
      const id = nextId(db, 'invoices');
      const payment_date = data.payment_date || addDays(data.invoice_date, 90);
      const inv: Invoice = {
        id,
        userId,
        supplier_id: supplierId,
        invoice_no: data.invoice_no || '',
        invoice_date: data.invoice_date || '',
        payment_date,
        amount_excluding_tax: Number(data.amount_excluding_tax) || 0,
        tax_amount: Number(data.tax_amount) || 0,
        total_amount: Number(data.total_amount) || 0,
        tax_rate: data.tax_rate || '',
        business_month: data.business_month || '',
        remark: data.remark || '',
        buyer_name: data.buyer_name || '',
        buyer_tax_id: data.buyer_tax_id || '',
        seller_name: data.seller_name || '',
        seller_tax_id: data.seller_tax_id || '',
        status: data.status || 'pending',
        raw_text: data.raw_text || '',
        file_name: data.file_name || '',
        image_data: data.image_data || '',
        created_at: new Date().toISOString(),
      };
      db.invoices.push(inv);
      writeDB(db);
      const suppliers = db.suppliers.filter((s) => s.userId === userId);
      return decorate(inv, suppliers);
    }),

  upload: (file: File, onProgress?: (current: number, total: number) => void) =>
    guard(async () => {
      const userId = getUserId();
      const result = await recognizeInvoice(file, onProgress);
      const supplierId = ensureSupplier(userId, result.seller_name, result.seller_tax_id);
      // 将图片转为 base64 存储（限制 2MB 以避免 localStorage 超限）
      let imageData = '';
      try { imageData = await fileToBase64(file); } catch (_) { /* 图片可选 */ }
      const db = readDB();
      const id = nextId(db, 'invoices');
      const inv: Invoice = {
        id,
        userId,
        supplier_id: supplierId,
        invoice_no: result.invoice_no,
        invoice_date: result.invoice_date,
        payment_date: addDays(result.invoice_date, 90),
        amount_excluding_tax: result.amount_excluding_tax,
        tax_amount: result.tax_amount,
        total_amount: result.total_amount,
        tax_rate: result.tax_rate,
        business_month: '',
        remark: '',
        buyer_name: result.buyer_name,
        buyer_tax_id: result.buyer_tax_id,
        seller_name: result.seller_name,
        seller_tax_id: result.seller_tax_id,
        status: 'pending',
        raw_text: result.raw_text,
        file_name: file.name,
        image_data: imageData,
        created_at: new Date().toISOString(),
      };
      db.invoices.push(inv);
      writeDB(db);
      const suppliers = db.suppliers.filter((s) => s.userId === userId);
      return decorate(inv, suppliers);
    }),

  update: (id: number, data: any) =>
    guard(() => {
      const userId = getUserId();
      const db = readDB();
      const inv = db.invoices.find((i) => i.id === id && i.userId === userId);
      if (!inv) fail('发票不存在');
      // 供应商处理
      if (data.supplier_name && !data.supplier_id) {
        inv.supplier_id = ensureSupplier(userId, data.supplier_name, data.supplier_tax_id);
      } else if (data.supplier_id !== undefined) {
        inv.supplier_id = data.supplier_id || null;
      }
      const fields = [
        'invoice_no', 'invoice_date', 'amount_excluding_tax', 'tax_amount', 'total_amount',
        'tax_rate', 'business_month', 'remark', 'buyer_name', 'buyer_tax_id',
        'seller_name', 'seller_tax_id', 'status', 'image_data',
      ];
      for (const f of fields) {
        if (data[f] !== undefined) (inv as any)[f] = data[f];
      }
      if (data.payment_date !== undefined) {
        inv.payment_date = data.payment_date || addDays(inv.invoice_date, 90);
      }
      writeDB(db);
      const suppliers = db.suppliers.filter((s) => s.userId === userId);
      return decorate(inv, suppliers);
    }),

  delete: (id: number) =>
    guard(() => {
      const userId = getUserId();
      const db = readDB();
      db.invoices = db.invoices.filter((i) => !(i.id === id && i.userId === userId));
      writeDB(db);
      return {};
    }),
};

// ------- Suppliers -------
export const supplierApi = {
  list: (params?: any) =>
    guard<any[]>(() => {
      const userId = getUserId();
      const db = readDB();
      let list = db.suppliers.filter((s) => s.userId === userId);
      if (params?.search) {
        const q = String(params.search).toLowerCase();
        list = list.filter(
          (s) => s.name.toLowerCase().includes(q) || s.tax_id.toLowerCase().includes(q),
        );
      }
      // 计算发票数与累计金额
      const invoices = db.invoices.filter((i) => i.userId === userId);
      list = list.map((s) => {
        const related = invoices.filter((i) => i.supplier_id === s.id);
        return {
          ...s,
          invoice_count: related.length,
          total_amount: Math.round(related.reduce((sum, i) => sum + (i.total_amount || 0), 0) * 100) / 100,
        };
      });
      return list;
    }),

  create: (data: any) =>
    guard(() => {
      const userId = getUserId();
      const db = readDB();
      const id = nextId(db, 'suppliers');
      const sup: Supplier = {
        id,
        userId,
        name: data.name || '',
        tax_id: data.tax_id || '',
        contact_person: data.contact_person || '',
        phone: data.phone || '',
        address: data.address || '',
        bank_name: data.bank_name || '',
        bank_account: data.bank_account || '',
        notes: data.notes || '',
        created_at: new Date().toISOString(),
      };
      db.suppliers.push(sup);
      writeDB(db);
      return sup;
    }),

  update: (id: number, data: any) =>
    guard(() => {
      const userId = getUserId();
      const db = readDB();
      const sup = db.suppliers.find((s) => s.id === id && s.userId === userId);
      if (!sup) fail('供应商不存在');
      const fields = [
        'name', 'tax_id', 'contact_person', 'phone', 'address', 'bank_name', 'bank_account', 'notes',
      ];
      for (const f of fields) {
        if (data[f] !== undefined) (sup as any)[f] = data[f];
      }
      writeDB(db);
      return sup;
    }),

  delete: (id: number) =>
    guard(() => {
      const userId = getUserId();
      const db = readDB();
      db.suppliers = db.suppliers.filter((s) => !(s.id === id && s.userId === userId));
      db.invoices = db.invoices.filter((i) => !(i.supplier_id === id && i.userId === userId));
      writeDB(db);
      return {};
    }),
};

// ------- Dashboard & Reminders -------
export const dashboardApi = {
  summary: () =>
    guard<any>(() => {
      const userId = getUserId();
      const db = readDB();
      const suppliers = db.suppliers.filter((s) => s.userId === userId);
      const list = db.invoices.filter((i) => i.userId === userId).map((i) => decorate(i, suppliers));

      const pending_count = list.filter((i) => i.status !== 'paid').length;
      const overdue_list = list.filter((i) => i.status === 'overdue');
      const total_payable = Math.round(
        list.filter((i) => i.status !== 'paid').reduce((s, i) => s + (i.total_amount || 0), 0) * 100,
      ) / 100;
      const overdue_amount = Math.round(overdue_list.reduce((s, i) => s + (i.total_amount || 0), 0) * 100) / 100;

      const overdue_invoices = overdue_list.map((i) => ({
        id: i.id,
        supplier_name: i.supplier_name,
        total_amount: i.total_amount,
        payment_date: i.payment_date,
        days_overdue: i.payment_date
          ? Math.round((today().getTime() - new Date(i.payment_date + 'T00:00:00').getTime()) / 86400000)
          : 0,
      }));

      return {
        total_invoices: list.length,
        pending_count,
        overdue_count: overdue_list.length,
        total_payable,
        overdue_amount,
        supplier_count: suppliers.length,
        overdue_invoices,
      };
    }),

  reminders: () =>
    guard<any>(() => {
      const userId = getUserId();
      const db = readDB();
      const suppliers = db.suppliers.filter((s) => s.userId === userId);
      const list = db.invoices.filter((i) => i.userId === userId).map((i) => decorate(i, suppliers));

      const notPaid = list.filter((i) => i.status !== 'paid');
      const daysLeft = (d: string) =>
        d ? Math.round((new Date(d + 'T00:00:00').getTime() - today().getTime()) / 86400000) : null;

      const within = (n: number) => notPaid.filter((i) => daysLeft(i.payment_date) !== null && (daysLeft(i.payment_date) as number) <= n).length;
      const overdue = notPaid.filter((i) => i.status === 'overdue').length;

      const invoices = notPaid
        .slice()
        .sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || ''))
        .map((i) => ({
          id: i.id,
          supplier_name: i.supplier_name,
          invoice_no: i.invoice_no,
          invoice_date: i.invoice_date,
          payment_date: i.payment_date,
          total_amount: i.total_amount,
        }));

      return {
        due_within_15: within(15),
        due_within_30: within(30),
        due_within_60: within(60),
        due_within_90: within(90),
        overdue,
        invoices,
      };
    }),
};

export default {};
