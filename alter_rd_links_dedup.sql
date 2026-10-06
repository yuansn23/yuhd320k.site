-- ============================================================
-- rd_links 增加「去重」开关列：同一 cookie 固定跳转到同一目标链接
-- 运行一次即可：
--   wrangler d1 execute streamflix-db --remote --file alter_rd_links_dedup.sql
-- 说明：dedup = 1 开启去重（默认）/ 0 关闭。仅当跳转后链接多于 1 个时生效。
-- ============================================================
ALTER TABLE rd_links ADD COLUMN dedup INTEGER NOT NULL DEFAULT 1;
