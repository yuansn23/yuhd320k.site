-- ============================================================
-- 斗篷权限：给子账户加「账号级」开关（管理员控制，默认关闭）
-- 运行一次即可（与 cloak_schema.sql 独立，不影响既有业务表）：
--   wrangler d1 execute streamflix-db --file alter_cloak_perm.sql
-- 说明：cloak_enabled=0 默认关闭；管理员在后台「账户管理」里给子账户开启后，
--       该子账户的「斗篷设置」全部功能才可用。
-- ============================================================
ALTER TABLE accounts ADD COLUMN cloak_enabled INTEGER NOT NULL DEFAULT 0;
