-- 应付宝：账期功能迁移（在已执行过 schema.sql 的库上运行）
-- 作用：users 表增加 account_period，invoices 表增加 payment_auto。
-- 幂等：使用 IF NOT EXISTS，可重复执行，不会报错。

-- users 表增加全局账期天数（默认 90）
alter table if exists public.users
  add column if not exists account_period integer default 90;

-- invoices 表增加「付款日期是否自动派生」标记（默认 true）
alter table if exists public.invoices
  add column if not exists payment_auto boolean default true;

-- 历史数据：将已有的付款日期视为自动派生（与新逻辑一致）
update public.invoices
  set payment_auto = true
  where payment_auto is null;
