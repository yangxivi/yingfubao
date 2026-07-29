-- 应付宝 Supabase 数据表结构（初始化新项目）
-- 1) 主键使用 uuid，数据隔离由应用层按 user_id 过滤。
-- 2) image_data 直接存 base64 文本。

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
create index if not exists idx_invoices_supplier on public.invoices(supplier_id);

-- ===== 关闭 RLS（应用层已按 user_id 隔离）=====
alter table public.users disable row level security;
alter table public.suppliers disable row level security;
alter table public.invoices disable row level security;
