-- ============================================================
-- DP配置权限：新增独立权限表 dp_permissions（管理员控制，默认关闭）
-- 运行一次即可（与 dp_schema.sql 独立，不影响既有业务表）：
--   wrangler d1 execute streamflix-db --file alter_dp_perm.sql
-- 说明：dp_permissions.enabled=0 默认关闭；管理员在后台「账户管理」里给子账户
--       开启后，该子账户的「DP配置」功能才可用（生成/保存/删除落地页）。
--       默认已为 xifeng666 开通 DP 权限，其余子账户默认关闭。
-- ============================================================
CREATE TABLE IF NOT EXISTS dp_permissions (
  username TEXT PRIMARY KEY,
  enabled  INTEGER NOT NULL DEFAULT 0
);

-- 默认开通：仅 xifeng666 有 DP 权限（如该账户尚未创建，稍后创建后仍自动生效）
INSERT INTO dp_permissions (username, enabled) VALUES ('xifeng666', 1)
  ON CONFLICT(username) DO NOTHING;
