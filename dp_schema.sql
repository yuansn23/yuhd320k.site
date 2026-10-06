-- ============================================================
-- DP配置（落地页环境分流）— 全新独立表，与 AB页/斗篷/其它功能完全无关
-- 建表方式（与现有手动迁移一致）：
--   wrangler d1 execute streamflix-db --file dp_schema.sql
-- ============================================================

-- 每个落地页一条 DP 配置
CREATE TABLE IF NOT EXISTS dp_configs (
  site          TEXT PRIMARY KEY,        -- 落地页地址（给用户看的落地页）
  username      TEXT NOT NULL DEFAULT '', -- 归属子账户
  enabled       INTEGER NOT NULL DEFAULT 0, -- DP 分流总开关 0/1
  actual_url    TEXT NOT NULL DEFAULT '',  -- 实际地址（符合规则 → 跳这里）
  fallback_url  TEXT NOT NULL DEFAULT '',  -- 不符合规则地址（命中规则 → 跳这里）
  whitelist_ips TEXT NOT NULL DEFAULT '[]', -- 白名单IP JSON数组（命中直接跳实际地址）
  rules         TEXT NOT NULL DEFAULT '{}', -- 全量规则 JSON（爬虫 + 设备环境，同 AB）
  updated_at    TEXT NOT NULL DEFAULT ''
);

-- DP 流量访问列表
CREATE TABLE IF NOT EXISTS dp_traffic (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site            TEXT NOT NULL DEFAULT '',   -- 落地页地址
  username        TEXT NOT NULL DEFAULT '',   -- 归属子账户
  ip              TEXT DEFAULT '',
  device          TEXT DEFAULT '',            -- android/ios/pc/mac/other
  lang            TEXT DEFAULT '',
  timezone        TEXT DEFAULT '',
  is_vpn          INTEGER DEFAULT 0,
  is_proxy        INTEGER DEFAULT 0,
  passed          INTEGER NOT NULL DEFAULT 0, -- 1=符合规则(跳实际地址) 0=命中规则(跳xx地址)
  redirect_to     TEXT DEFAULT '',            -- 跳转目标（实际地址或xx地址）
  triggered_rules TEXT DEFAULT '[]',          -- 命中规则 id 列表（JSON）
  ua              TEXT DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT ''    -- ISO UTC 时间（前端展示时转 +8）
);
CREATE INDEX IF NOT EXISTS idx_dp_traffic_user ON dp_traffic(username, created_at);
CREATE INDEX IF NOT EXISTS idx_dp_traffic_site ON dp_traffic(site, created_at);
