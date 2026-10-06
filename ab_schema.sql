-- ============================================================
-- AB页+斗篷（AB Cloaking）— 全新独立表，与既有业务/斗篷设置完全无关
-- 建表方式（与现有手动迁移一致）：
--   wrangler d1 execute streamflix-db --file ab_schema.sql
-- ============================================================

-- 每个 A 页（审核页）一条 AB 配置
CREATE TABLE IF NOT EXISTS ab_configs (
  a_url         TEXT PRIMARY KEY,     -- A页地址（给审核员看的落地页）
  username      TEXT NOT NULL DEFAULT '', -- 归属子账户
  enabled       INTEGER NOT NULL DEFAULT 0, -- AB 斗篷总开关 0/1
  b_url         TEXT NOT NULL DEFAULT '',   -- B页地址（真实业务地址）
  whitelist_ips TEXT NOT NULL DEFAULT '[]',  -- 白名单IP JSON数组（命中视为真实用户）
  rules         TEXT NOT NULL DEFAULT '{}',  -- 全量规则 JSON（爬虫 + 设备环境，无行为模块）
  updated_at    TEXT NOT NULL DEFAULT ''
);

-- 每个子账户一条 AB 权限（默认关闭，管理员开启后才可使用）
CREATE TABLE IF NOT EXISTS ab_permissions (
  username TEXT PRIMARY KEY,
  enabled  INTEGER NOT NULL DEFAULT 0
);

-- AB页流量访问列表
CREATE TABLE IF NOT EXISTS ab_traffic (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  a_url           TEXT NOT NULL DEFAULT '',   -- A页地址
  username        TEXT NOT NULL DEFAULT '',   -- 归属子账户
  ip              TEXT DEFAULT '',
  device          TEXT DEFAULT '',            -- android/ios/pc/mac/other
  lang            TEXT DEFAULT '',
  timezone        TEXT DEFAULT '',
  is_vpn          INTEGER DEFAULT 0,
  is_proxy        INTEGER DEFAULT 0,
  passed          INTEGER NOT NULL DEFAULT 0, -- 1=真实用户(跳B) 0=命中规则(留A)
  redirect_to     TEXT DEFAULT '',            -- 跳转目标（B页或空）
  triggered_rules TEXT DEFAULT '[]',          -- 命中规则时命中的规则 id 列表（JSON）
  ua              TEXT DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT ''    -- ISO UTC 时间（前端展示时转 +8）
);
CREATE INDEX IF NOT EXISTS idx_ab_traffic_user ON ab_traffic(username, created_at);
CREATE INDEX IF NOT EXISTS idx_ab_traffic_a ON ab_traffic(a_url, created_at);
