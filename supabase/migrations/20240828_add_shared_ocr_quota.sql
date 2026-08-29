-- 共享 OCR 额度表：按自然月统计所有用户通过 Supabase Edge Function 消耗的百度 OCR 次数
-- 每月默认 800 次，达到上限后当月不再通过共享 Key 调用百度 OCR。
-- 用户可自行在「设置」配置自有百度 Key 以绕过共享配额。

CREATE TABLE IF NOT EXISTS shared_ocr_quota (
  month TEXT PRIMARY KEY,          -- 自然月，格式 YYYY-MM
  used_count INT NOT NULL DEFAULT 0,
  max_count INT NOT NULL DEFAULT 800,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 允许公开读取（匿名用户也能看到当月剩余额度）
ALTER TABLE shared_ocr_quota ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shared_ocr_quota_select_policy ON shared_ocr_quota;
CREATE POLICY shared_ocr_quota_select_policy
  ON shared_ocr_quota
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Edge Function 使用 service_role 写入，无需为 service_role 开 RLS policy

-- 原子扣减配额：
-- 若记录不存在则插入 used_count=1；若存在且未达上限则 +1 并返回新值。
-- 返回当前月的 used_count 与 max_count。
CREATE OR REPLACE FUNCTION increment_shared_ocr_quota(
  p_month TEXT,
  p_max INT DEFAULT 800
)
RETURNS TABLE (used_count INT, max_count INT) AS $$
BEGIN
  RETURN QUERY
  INSERT INTO shared_ocr_quota (month, used_count, max_count)
  VALUES (p_month, 1, p_max)
  ON CONFLICT (month)
  DO UPDATE SET
    used_count = LEAST(
      shared_ocr_quota.used_count + 1,
      shared_ocr_quota.max_count
    ),
    updated_at = NOW()
  RETURNING shared_ocr_quota.used_count, shared_ocr_quota.max_count;
END;
$$ LANGUAGE plpgsql;
