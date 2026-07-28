// Supabase 初始化检测与自动建表
// 解决「换浏览器登录不了、数据不同步」的根因：Supabase 表未创建。
//
// 策略：
//   1. 启动时探测三张核心表是否存在
//   2. 若均存在 → 正常云端模式
//   3. 若任意表缺失 → 进入「待初始化」状态，返回建表 SQL 供用户复制到 Supabase SQL Editor 执行
//   4. 同时提供 localStorage 降级模式，确保即使不建表 App 也能用（只是无法跨浏览器同步）

import { supabase } from './supabase';

export type SupabaseStatus = 'ready' | 'uninitialized' | 'error';

/** 探测结果 */
export interface ProbeResult {
  status: SupabaseStatus;
  tables: { users: boolean; suppliers: boolean; invoices: boolean };
  message: string;
  setupSql?: string; // status === 'uninitialized' 时提供完整建表 SQL
}

// ===== 建表 SQL（与 supabase/schema.sql 保持一致）=====
const SETUP_SQL = `-- 应付宝 Supabase 数据表结构
-- 复制本段内容到 Supabase Dashboard → SQL Editor 中执行即可。

-- ===== users =====
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  company_name text default '',
  email text default '',
  account_period integer default 90,
  created_at timestamptz default now()
);

-- ===== suppliers =====
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  tax_id text default '',
  contact_person text default '',
  phone text default '',
  address text default '',
  bank_name text default '',
  bank_account text default '',
  notes text default '',
  created_at timestamptz default now()
);

-- ===== invoices =====
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  supplier_id uuid,
  invoice_no text default '',
  invoice_date text default '',
  payment_date text default '',
  amount_excluding_tax numeric default 0,
  tax_amount numeric default 0,
  total_amount numeric default 0,
  tax_rate text default '',
  business_month text default '',
  remark text default '',
  buyer_name text default '',
  buyer_tax_id text default '',
  seller_name text default '',
  seller_tax_id text default '',
  status text default 'pending',
  payment_auto boolean default true,
  raw_text text default '',
  file_name text default '',
  image_data text default '',
  created_at timestamptz default now()
);

-- ===== 索引 =====
create index if not exists idx_suppliers_user on public.suppliers(user_id);
create index if not exists idx_invoices_user on public.invoices(user_id);
create index if not exists idx_invoices_supplier on public.invoices(supplier_id);`;

/**
 * 探测 Supabase 三张核心表是否存在。
 * 返回状态和（如需要）建表 SQL。
 */
export async function probeSupabase(): Promise<ProbeResult> {
  const tables = { users: false, suppliers: false, invoices: false };

  try {
    // 并发探测三张表（各取 1 条记录来判断表是否存在）
    const [usersRes, suppliersRes, invoicesRes] = await Promise.all([
      supabase.from('users').select('id').limit(1),
      supabase.from('suppliers').select('id').limit(1),
      supabase.from('invoices').select('id').limit(1),
    ]);

    // 判断逻辑：error 中包含 "relation" 或 "does not exist" 说明表不存在
    // 注意：空表（0 行）不是错误，error 为 null
    tables.users = !usersRes.error || !isTableNotFoundError(usersRes.error);
    tables.suppliers = !suppliersRes.error || !isTableNotFoundError(suppliersRes.error);
    tables.invoices = !invoicesRes.error || !isTableNotFoundError(invoicesRes.error);

    if (tables.users && tables.suppliers && tables.invoices) {
      return { status: 'ready', tables, message: 'Supabase 云端已就绪' };
    }

    // 部分或全部表缺失
    const missing = Object.entries(tables)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    return {
      status: 'uninitialized',
      tables,
      message: `缺少数据表: ${missing.join(', ')}`,
      setupSql: SETUP_SQL,
    };
  } catch (e: any) {
    return {
      status: 'error',
      tables,
      message: `Supabase 连接失败: ${e?.message || '未知错误'}`,
    };
  }
}

/** 判断是否为「表不存在」类错误 */
function isTableNotFoundError(error: { code?: string; message?: string }): boolean {
  const msg = (error.message || '').toLowerCase();
  const code = error.code || '';
  // PostgreSQL relation does not exist = 42P01
  return (
    code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('relation') ||
    msg.includes('table')
  );
}

/**
 * 验证用户是否已在 Supabase users 表中注册（用于 SetupWizard 的验证步骤）
 */
export async function verifyUserExists(username: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}
