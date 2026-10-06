-- ============================================================
-- 斗篷设置（Cloaking）— 全新独立表，与既有业务（像素/跳转/下载计数）无任何关联
-- 建表方式（与现有手动迁移一致）：
--   wrangler d1 execute streamflix-db --file cloak_schema.sql
-- ============================================================

-- 每个落地页一条斗篷配置
CREATE TABLE IF NOT EXISTS cloak_configs (
  site          TEXT PRIMARY KEY,            -- 完整落地页域名（与像素/跳转的 site 一致）
  enabled       INTEGER NOT NULL DEFAULT 0,  -- 斗篷总开关 0/1
  fallback_url  TEXT NOT NULL DEFAULT 'https://www.google.com', -- 不符合规则时跳转地址
  whitelist_ips TEXT NOT NULL DEFAULT '[]',  -- 白名单IP JSON数组（命中完全放行，不受任何规则限制）
  rules         TEXT NOT NULL DEFAULT '{}',  -- 全量规则 JSON（模块1/2/3 + 预留扩展 extra）
  updated_at    TEXT NOT NULL DEFAULT ''
);

-- 斗篷流量访问列表
CREATE TABLE IF NOT EXISTS cloak_traffic (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site            TEXT NOT NULL,
  username        TEXT NOT NULL DEFAULT '',  -- 归属子账户（verify 时从 site_mappings 反解，用于 my- 查询）
  ip              TEXT DEFAULT '',
  device          TEXT DEFAULT '',           -- android/ios/pc/mac/other
  terminal        TEXT DEFAULT '',
  lang            TEXT DEFAULT '',
  timezone        TEXT DEFAULT '',
  is_vpn          INTEGER DEFAULT 0,
  is_proxy        INTEGER DEFAULT 0,
  passed          INTEGER NOT NULL DEFAULT 0, -- 1=通过 0=未通过
  triggered_rules TEXT DEFAULT '[]',          -- 未通过时命中的规则 id 列表（JSON）
  ua              TEXT DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT ''    -- ISO UTC 时间（前端展示时转 +8）
);
CREATE INDEX IF NOT EXISTS idx_cloak_traffic_user ON cloak_traffic(username, created_at);
CREATE INDEX IF NOT EXISTS idx_cloak_traffic_site ON cloak_traffic(site, created_at);
