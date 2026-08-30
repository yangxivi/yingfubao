// 本地后端模拟层（纯前端，无服务器）
// 对外暴露与后端一致的接口形状：每个方法返回 Promise<{ data: T }>，
// 业务错误抛出 { response: { data: { detail } } } 以兼容页面现有错误处理。
// 数据存于浏览器 localStorage（db.ts），OCR 在浏览器用 Tesseract.js（ocr.ts），鉴权用 Web Crypto（auth.ts）。

import { readDB, writeDB, nextId, invoiceToRow, normalizeSupplierName } from '../lib/db';
import type { Invoice, Supplier } from '../lib/db';
import * as authLib from '../lib/auth';
import { recognizeInvoice } from '../lib/ocr';
import { getAccountPeriod } from '../lib/accountPeriod';
import { getAuthMode } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { incrementPersonalOcrUsed } from '../lib/ocr-quota';
import { isDesktop, electronAPI } from '../lib/desktop-env';
import dayjs from 'dayjs';

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

/** 将 File 转为压缩后的 base64（用于 localStorage 存储）
 *  缩放到 maxWidth=1200px，JPEG 质量 0.8，避免 localStorage 爆容量 */
function fileToBase64(file: File, options?: { maxWidth?: number; quality?: number }): Promise<string> {
  const { maxWidth = 1200, quality = 0.8 } = options || {};
  return new Promise((resolve, reject) => {
    // 对图片类型做压缩；PDF 等非图片直接转 base64
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
      return;
    }
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 不可用')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      // 用 JPEG 压缩（即使原图是 PNG 也转 JPEG 以大幅减小体积）
      const result = canvas.toDataURL('image/jpeg', quality);
      resolve(result);
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = URL.createObjectURL(file);
  });
}
function getUserId(): string {
  const id = authLib.getCurrentUserId();
  if (!id) fail('请先登录');
  return id as string;
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
    supplier_name: normalizeSupplierName(sup ? sup.name : inv.seller_name),
    supplier_tax_id: sup ? sup.tax_id : inv.seller_tax_id,
    status,
  };
}

// 按名称查找或创建供应商（支持模糊匹配），返回 id（name 为空返回 null）
function ensureSupplier(userId: string, name?: string, taxId?: string): string | null {
  const nm = normalizeSupplierName(name || '');
  if (!nm) return null;
  const db = readDB();

  // 1. 精确匹配（trim 后相等）
  let existing = db.suppliers.find(
    (s) => s.userId === userId && s.name.trim() === nm,
  );
  if (existing) {
    if (taxId && !existing.tax_id) { existing.tax_id = taxId; writeDB(db); }
    return existing.id;
  }

  // 2. 模糊匹配：包含关系（处理 OCR 识别偏差，如多/少字、后缀差异）
  existing = db.suppliers.find((s) => {
    if (s.userId !== userId) return false;
    const sn = s.name.trim();
    return sn.includes(nm) || nm.includes(sn);
  });
  if (existing) {
    if (taxId && !existing.tax_id) { existing.tax_id = taxId; writeDB(db); }
    return existing.id;
  }

  // 3. 未找到 → 自动创建供应商（联系人/电话/地址留空供后续手动填写）
  const id = nextId(db, 'suppliers');
  const sup: Supplier = {
    id,
    userId,
    name: nm,
    tax_id: taxId || '',
    contact_person: '',   // 待手动填写
    phone: '',           // 待手动填写
    address: '',         // 待手动填写
    bank_name: '',
    bank_account: '',
    notes: '由发票 OCR 自动创建',
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
  updateAccountPeriod: (period: number) => guard(() => authLib.updateAccountPeriod(period)),
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
        list = list.filter(
          (i) =>
            (i.invoice_no || '').toLowerCase().includes(q) ||
            (i.supplier_name || '').toLowerCase().includes(q),
        );
      }
      if (params?.status) list = list.filter((i) => i.status === params.status);
      if (params?.supplier_id) {
        const sid = String(params.supplier_id);
        list = list.filter((i) => String(i.supplier_id) === sid);
      }
      if (params?.date_from) list = list.filter((i) => i.invoice_date >= params.date_from!);
      if (params?.date_to) list = list.filter((i) => i.invoice_date <= params.date_to!);
      if (params?.pay_date_from) list = list.filter((i) => i.payment_date >= params.pay_date_from!);
      if (params?.pay_date_to) list = list.filter((i) => i.payment_date <= params.pay_date_to!);
      if (params?.amount_min !== undefined) list = list.filter((i) => (i.total_amount || 0) >= params.amount_min!);
      if (params?.amount_max !== undefined) list = list.filter((i) => (i.total_amount || 0) <= params.amount_max!);

      list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return list;
    }),

  get: (id: string) =>
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
      let supplierId: string | null = data.supplier_id ?? null;
      if (!supplierId && data.supplier_name) {
        supplierId = ensureSupplier(userId, data.supplier_name, data.supplier_tax_id);
      }
      // 每次手动创建都视为新记录（不去重——用户可能有意录入相似发票）
      const id = nextId(db, 'invoices');
      const payment_date = data.payment_date || addDays(data.invoice_date, getAccountPeriod());
      const paymentAuto = !data.payment_date; // 用户未填付款日期 = 自动派生
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
        payment_auto: paymentAuto,
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
      // 识别为空时拒绝入库，避免产生空白记录污染列表
      if (!result.raw_text || result.raw_text.trim().length === 0) {
        fail('未能识别出发票内容。请检查图片清晰度，或到「设置」开启百度高精度增强。');
      }
      // 个人 OCR 计数 +1（无论自有 Key 还是共享 Key，只要识别成功就计数）
      incrementPersonalOcrUsed(authLib.getCurrentUserId());
      // 每张上传的图片都独立入库（不同图片=不同物理发票，不去重）
      const supplierId = ensureSupplier(userId, result.seller_name, result.seller_tax_id);
      // 将图片转为压缩后的 base64 存储（避免 localStorage 超限）
      let imageData = '';
      try { imageData = await fileToBase64(file, { maxWidth: 1200, quality: 0.75 }); } catch (_) { /* 图片可选 */ }
      const db = readDB();
      const id = nextId(db, 'invoices');
      const inv: Invoice = {
        id,
        userId,
        supplier_id: supplierId,
        invoice_no: result.invoice_no,
        invoice_date: result.invoice_date,
        payment_date: addDays(result.invoice_date, getAccountPeriod()),
        payment_auto: true,
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

  update: (id: string, data: any) =>
    guard(async () => {
      const userId = getUserId();
      const db = readDB();
      const idx = db.invoices.findIndex((i) => i.id === id && i.userId === userId);
      if (idx < 0) fail('发票不存在');
      // 不可变更新：替换整个对象而非 mutate 原引用，避免缓存污染
      const inv = db.invoices[idx];
      // 供应商处理
      let newSupplierId = inv.supplier_id;
      if (data.supplier_name && !data.supplier_id) {
        newSupplierId = ensureSupplier(userId, data.supplier_name, data.supplier_tax_id);
      } else if (data.supplier_id !== undefined) {
        newSupplierId = data.supplier_id || null;
      }
      const fields = [
        'invoice_no', 'invoice_date', 'amount_excluding_tax', 'tax_amount', 'total_amount',
        'tax_rate', 'business_month', 'remark', 'buyer_name', 'buyer_tax_id',
        'seller_name', 'seller_tax_id', 'status', 'image_data',
      ];
      const updated: Invoice = { ...inv, supplier_id: newSupplierId };
      for (const f of fields) {
        if (data[f] !== undefined) (updated as any)[f] = data[f];
      }
      if (data.payment_date !== undefined) {
        const autoPayDate = addDays(updated.invoice_date, getAccountPeriod());
        if (data.payment_date && data.payment_date !== autoPayDate) {
          // 用户显式修改了付款日期且与自动派生值不同，视为手动锁定
          updated.payment_date = data.payment_date;
          updated.payment_auto = false;
        } else {
          // 未填写或等于自动派生值，恢复/保持自动派生
          updated.payment_date = autoPayDate;
          updated.payment_auto = true;
        }
      }
      db.invoices[idx] = updated;
      writeDB(db);
      // 云端模式：同步更新 Supabase 记录
      if (getAuthMode() === 'cloud') {
        try { await supabase.from('invoices').update(invoiceToRow(updated)).eq('id', id); } catch { /* 静默失败 */ }
      }
      const suppliers = db.suppliers.filter((s) => s.userId === userId);
      return decorate(updated, suppliers);
    }),

  delete: (id: string) =>
    guard(async () => {
      const userId = getUserId();
      const db = readDB();
      db.invoices = db.invoices.filter((i) => !(i.id === id && i.userId === userId));
      writeDB(db);
      // 云端模式：同步删除 Supabase 记录，否则刷新后 loadCloud 会拉回旧数据
      if (getAuthMode() === 'cloud') {
        try { await supabase.from('invoices').delete().eq('id', id); } catch { /* 静默失败，本地已删 */ }
      }
      return {};
    }),

  // 账期变更后，同步重新计算所有发票的付款日期与付款状态（不管当前是什么状态）
  recomputePaymentDates: () =>
    guard(async () => {
      const userId = getUserId();
      const db = readDB();
      const period = getAccountPeriod();
      let updated = 0;
      for (const inv of db.invoices) {
        if (inv.userId !== userId) continue;
        if (!inv.invoice_date) continue;
        // 所有发票（含已付款）统一按新账期重算付款日期
        inv.payment_date = addDays(inv.invoice_date, period);
        inv.payment_auto = true; // 重新计算后恢复为自动派生
        // 同步重算付款状态：已付款保持不变；其余按新的付款日期是否过期判定 逾期 / 待付
        if (inv.status !== 'paid') {
          const pd = new Date(inv.payment_date + 'T00:00:00');
          inv.status = pd < today() ? 'overdue' : 'pending';
        }
        updated++;
      }
      if (updated > 0) {
        writeDB(db);
        // 云端模式：同步更新 Supabase 记录，避免刷新后 loadCloud 拉回旧数据
        if (getAuthMode() === 'cloud') {
          for (const inv of db.invoices) {
            if (inv.userId !== userId) continue;
            try { await supabase.from('invoices').update(invoiceToRow(inv)).eq('id', inv.id); } catch { /* 静默失败 */ }
          }
        }
      }
      return { updated };
    }),

  // 按需加载单张发票图片（启动时 loadCloud 不拉取 image_data，避免首屏过重）
  loadImage: (id: string) =>
    guard<string>(async () => {
      const userId = getUserId();
      const db = readDB();
      const inv = db.invoices.find((i) => i.id === id && i.userId === userId);
      if (inv?.image_data) return inv.image_data;
      if (isDesktop()) {
        const api = electronAPI();
        if (api) {
          const data = await api.readImage(id);
          if (data && inv) inv.image_data = data; // 回填缓存，避免重复读盘
          return data || '';
        }
      }
      if (getAuthMode() === 'cloud') {
        const { data, error } = await supabase
          .from('invoices')
          .select('image_data')
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (data?.image_data) {
          // 回填本地缓存，避免重复拉取
          inv && (inv.image_data = data.image_data);
          return data.image_data as string;
        }
      }
      return '';
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
        const q = normalizeSupplierName(String(params.search)).toLowerCase();
        list = list.filter(
          (s) => normalizeSupplierName(s.name).toLowerCase().includes(q) || s.tax_id.toLowerCase().includes(q),
        );
      }
      // 计算发票数与累计金额
      const invoices = db.invoices.filter((i) => i.userId === userId);
      list = list.map((s) => {
        const related = invoices.filter((i) => i.supplier_id === s.id);
        return {
          ...s,
          name: normalizeSupplierName(s.name),
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
      const nm = normalizeSupplierName(data.name || '');
      // 去重：同名供应商已存在则复用并补全字段，避免重复创建
      const existing = db.suppliers.find((s) => s.userId === userId && normalizeSupplierName(s.name) === nm);
      if (existing) {
        if (data.tax_id && !existing.tax_id) existing.tax_id = data.tax_id;
        if (data.contact_person && !existing.contact_person) existing.contact_person = data.contact_person;
        if (data.phone && !existing.phone) existing.phone = data.phone;
        if (data.address && !existing.address) existing.address = data.address;
        writeDB(db);
        return { ...existing, name: normalizeSupplierName(existing.name) };
      }
      const id = nextId(db, 'suppliers');
      const sup: Supplier = {
        id,
        userId,
        name: nm,
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

  update: (id: string, data: any) =>
    guard(() => {
      const userId = getUserId();
      const db = readDB();
      const sup = db.suppliers.find((s) => s.id === id && s.userId === userId);
      if (!sup) fail('供应商不存在');
      const fields = [
        'tax_id', 'contact_person', 'phone', 'address', 'bank_name', 'bank_account', 'notes',
      ];
      if (data.name !== undefined) sup.name = normalizeSupplierName(data.name);
      for (const f of fields) {
        if (data[f] !== undefined) (sup as any)[f] = data[f];
      }
      writeDB(db);
      return { ...sup, name: normalizeSupplierName(sup.name) };
    }),

  delete: (id: string) =>
    guard(async () => {
      const userId = getUserId();
      const db = readDB();
      // 仅删除供应商；关联发票保留在发票列表中，仅将 supplier_id 置空（避免发票凭空消失）
      db.invoices = db.invoices.map((i) =>
        (i.userId === userId && i.supplier_id === id) ? { ...i, supplier_id: null } : i,
      );
      db.suppliers = db.suppliers.filter((s) => !(s.id === id && s.userId === userId));
      writeDB(db);
      // 云端模式：同步删除 Supabase 记录
      if (getAuthMode() === 'cloud') {
        try { await supabase.from('suppliers').delete().eq('id', id); } catch { /* 静默失败 */ }
      }
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
      const total_amount = Math.round(
        list.reduce((s, i) => s + (i.total_amount || 0), 0) * 100,
      ) / 100;
      const paid_amount = Math.round(
        list.filter((i) => i.status === 'paid').reduce((s, i) => s + (i.total_amount || 0), 0) * 100,
      ) / 100;
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
        total_amount,
        paid_amount,
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

  recentInvoices: () =>
    guard<any[]>(() => {
      const userId = getUserId();
      const db = readDB();
      const suppliers = db.suppliers.filter((s) => s.userId === userId);
      return db.invoices
        .filter((i) => i.userId === userId)
        .map((i) => decorate(i, suppliers))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 5)
        .map((i) => ({
          id: i.id,
          invoice_no: i.invoice_no,
          supplier_name: i.supplier_name,
          total_amount: i.total_amount,
          status: i.status,
          payment_date: i.payment_date,
          image_data: !!i.file_name,
        }));
    }),

  recentSuppliers: () =>
    guard<any[]>(() => {
      const userId = getUserId();
      const db = readDB();
      return db.suppliers
        .filter((s) => s.userId === userId)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 5)
        .map((s) => ({
          id: s.id,
          name: s.name,
          tax_id: s.tax_id,
          contact_person: s.contact_person,
          created_at: s.created_at,
        }));
    }),

    analytics: () =>
      guard<any>(() => {
        const userId = getUserId();
        const db = readDB();
        const suppliers = db.suppliers.filter((s) => s.userId === userId);
        const list = db.invoices
          .filter((i) => i.userId === userId)
          .map((i) => decorate(i, suppliers));

        // 1) 月度趋势（按开票日期，近 12 个月）
        const monthlyMap = new Map<string, { count: number; amount: number }>();
        const now = dayjs();
        for (let i = 11; i >= 0; i--) {
          const m = now.subtract(i, 'month');
          monthlyMap.set(m.format('YYYY-MM'), { count: 0, amount: 0 });
        }
        list.forEach((inv: any) => {
          const key = (inv.invoice_date || inv.created_at || '').slice(0, 7);
          const cur = monthlyMap.get(key);
          if (cur) {
            cur.count += 1;
            cur.amount += Number(inv.total_amount) || 0;
          }
        });
        const monthlyTrend = Array.from(monthlyMap.entries()).map(([month, v]) => ({
          month,
          count: v.count,
          amount: Math.round(v.amount * 100) / 100,
        }));

        // 2) 付款状态分布
        const statusMeta: Record<string, string> = { paid: '已付款', pending: '待付款', overdue: '已逾期' };
        const statusDistribution = ['paid', 'pending', 'overdue'].map((st) => {
          const items = list.filter((i: any) => i.status === st);
          return {
            status: st,
            label: statusMeta[st],
            count: items.length,
            amount: Math.round(items.reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0) * 100) / 100,
          };
        });

        // 3) 供应商 TOP5（按累计金额）
        const supMap = new Map<number, { name: string; amount: number; count: number }>();
        list.forEach((inv: any) => {
          const sid = inv.supplier_id;
          if (!sid) return;
          if (!supMap.has(sid)) {
            const sup = suppliers.find((s) => s.id === sid);
            supMap.set(sid, {
              name: (sup?.name || inv.supplier_name || '未知').replace(/^(名称[：:\s]*)/, ''),
              amount: 0,
              count: 0,
            });
          }
          const cur = supMap.get(sid)!;
          cur.amount += Number(inv.total_amount) || 0;
          cur.count += 1;
        });
        const topSuppliers = Array.from(supMap.values())
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5)
          .map((s) => ({ ...s, amount: Math.round(s.amount * 100) / 100 }));

        // 4) 未来应付预测（按剩余天数分桶，对应「未来 6 个月应付预测」图表）
        const agingBuckets = [
          { bucket: '0-30天', min: 0, max: 30 },
          { bucket: '31-60天', min: 31, max: 60 },
          { bucket: '61-90天', min: 61, max: 90 },
          { bucket: '90天以上', min: 91, max: Infinity },
        ];
        const aging = agingBuckets.map((b) => {
          const items = list.filter((i: any) => {
            if (i.status === 'paid' || !i.payment_date) return false;
            const daysLeft = Math.round(
              (new Date(i.payment_date + 'T00:00:00').getTime() - today().getTime()) / 86400000,
            );
            return daysLeft >= b.min && daysLeft <= b.max;
          });
          return {
            bucket: b.bucket,
            count: items.length,
            amount: Math.round(items.reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0) * 100) / 100,
          };
        });

        // 5) 付款进度（已付金额占比）
        const totalAmount = Math.round(list.reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0) * 100) / 100;
        const paidAmount = Math.round(
          list.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0) * 100,
        ) / 100;
        const paidRatio = totalAmount > 0 ? Math.round((paidAmount / totalAmount) * 1000) / 10 : 0;

        // 6) 本月付款完成率（本月应付款中已付占比）
        const curMonth = now.format('YYYY-MM');
        const monthInvoices = list.filter((i: any) => (i.payment_date || '').slice(0, 7) === curMonth);
        const monthDueTotal = Math.round(monthInvoices.reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0) * 100) / 100;
        const monthPaidTotal = Math.round(
          monthInvoices.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0) * 100,
        ) / 100;
        const monthPaidRatio = monthDueTotal > 0 ? Math.round((monthPaidTotal / monthDueTotal) * 1000) / 10 : 0;

        // 7) 待付款到期票追度（按剩余天数分桶的未付金额分布）
        const dueBuckets = [
          { label: '逾期', min: -Infinity, max: -1 },
          { label: '0-15天', min: 0, max: 15 },
          { label: '15-30天', min: 16, max: 30 },
          { label: '30-60天', min: 31, max: 60 },
          { label: '60-90天', min: 61, max: 90 },
          { label: '90天+', min: 91, max: Infinity },
        ];
        const paymentDueDist = dueBuckets.map((b) => {
          const items = list.filter((i: any) => {
            if (i.status === 'paid' || !i.payment_date) return false;
            const daysLeft = dayjs(i.payment_date).diff(now, 'day');
            return daysLeft >= b.min && daysLeft <= b.max;
          });
          return {
            label: b.label,
            amount: Math.round(items.reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0) * 100) / 100,
            count: items.length,
          };
        });

        return {
          monthlyTrend, statusDistribution, topSuppliers, aging,
          paidRatio, paidAmount, totalAmount,
          monthPaidRatio, monthPaidTotal, monthDueTotal,
          paymentDueDist,
        };
      }),
  };

export default {};