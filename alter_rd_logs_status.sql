-- ============================================================
-- rd_logs 增加「状态 / 命中原因」两列，用于统计被防护拦截的记录
-- 运行一次即可：
--   wrangler d1 execute streamflix-db --remote --file alter_rd_logs_status.sql
-- 说明：status = 'ok' 正常跳转 / 'blocked' 被拦截；reason 记录命中原因（crawler/device/language/timezone/block_ips/privacy 逗号分隔）
-- ============================================================
ALTER TABLE rd_logs ADD COLUMN status TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE rd_logs ADD COLUMN reason TEXT NOT NULL DEFAULT '';
