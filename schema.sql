-- ============================================================
-- StreamFlix — D1 数据库 Schema
-- 部署时在 Cloudflare Dashboard 或 wrangler CLI 执行此 SQL
-- ============================================================

-- 账户表（替代 KV account:* + account_list）
CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  role     TEXT NOT NULL DEFAULT 'user',
  site     TEXT NOT NULL DEFAULT '',
  created  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 站点 → 用户映射表（替代 KV site:*）
CREATE TABLE IF NOT EXISTS site_mappings (
  site     TEXT PRIMARY KEY,
  username TEXT NOT NULL
);

-- 下载计数器表（按用户 + 日期）
CREATE TABLE IF NOT EXISTS download_counts (
  username TEXT NOT NULL,
  date     TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (username, date)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_download_counts_user ON download_counts (username);
CREATE INDEX IF NOT EXISTS idx_download_counts_date ON download_counts (date);
CREATE INDEX IF NOT EXISTS idx_site_mappings_user    ON site_mappings (username);
