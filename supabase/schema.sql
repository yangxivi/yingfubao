-- 应付宝 Supabase 数据表结构
-- 在 Supabase Dashboard → SQL Editor 中执行本文件即可。
-- 说明：
-- 1) 主键使用 uuid（由应用层用 crypto.randomUUID() 生成），避免多设备 id 冲突。
-- 2) 数据隔离由应用层按 user_id 过滤实现（关闭 RLS，等价于原 localStorage 前端方案的安全边界）。
-- 3) image_data 直接存 base64 文本，个人小规模使用足够；后续可迁移到 Storage。

-- ===== users =====
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  company_name text default '',
  email text default '',
  account_period integer default 90, -- 全局账期天数
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
  payment_auto boolean default true, -- 付款日期是否由账期自动派生
  raw_text text default '',
  file_name text default '',
  image_data text default '',
  created_at timestamptz default now()
);

-- ===== 索引 =====
create index if not exists idx_suppliers_user on public.suppliers(user_id);
create index if not exists idx_invoices_user on public.invoices(user_id);
create index if not exists idx_invoices_supplier on public.invoices(supplier_id);

-- 新建表默认 RLS 为 disabled，应用层已按 user_id 隔离，无需额外策略。
