-- ============================================================
-- StreamFlix — D1 数据库 Schema
-- 部署时在 Cloudflare Dashboard 或 wrangler CLI 执行此 SQL
-- ============================================================

-- 账户表（替代 KV account:* + account_list）
CREATE TABLE IF NOT EXISTS accounts (
<<<<<<< HEAD
  username    TEXT PRIMARY KEY,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user',
  site        TEXT NOT NULL DEFAULT '',
  created     TEXT NOT NULL DEFAULT (datetime('now')),
  pixel_ids     TEXT NOT NULL DEFAULT '[]',
  apk_url       TEXT NOT NULL DEFAULT '',
  apk_history   TEXT NOT NULL DEFAULT '[]',
  config_version INTEGER NOT NULL DEFAULT 0
);

-- 如果是从旧表升级，执行下面 3 条 ALTER（已有表则忽略错误）
-- ALTER TABLE accounts ADD COLUMN pixel_ids TEXT DEFAULT '[]';
-- ALTER TABLE accounts ADD COLUMN apk_url TEXT DEFAULT '';
-- ALTER TABLE accounts ADD COLUMN apk_history TEXT DEFAULT '[]';

=======
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  role     TEXT NOT NULL DEFAULT 'user',
  site     TEXT NOT NULL DEFAULT '',
  created  TEXT NOT NULL DEFAULT (datetime('now'))
);

>>>>>>> 2e74306ac7a5a558fd5a918bfb28b0528ede5ca9
-- 站点 → 用户映射表（替代 KV site:*）
CREATE TABLE IF NOT EXISTS site_mappings (
  site     TEXT PRIMARY KEY,
  username TEXT NOT NULL
);

<<<<<<< HEAD
-- 下载计数器表（按用户 + 日期 + 站点）
CREATE TABLE IF NOT EXISTS download_counts (
  username TEXT NOT NULL,
  date     TEXT NOT NULL,
  site     TEXT NOT NULL DEFAULT '',
  count    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (username, date, site)
=======
-- 下载计数器表（按用户 + 日期）
CREATE TABLE IF NOT EXISTS download_counts (
  username TEXT NOT NULL,
  date     TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (username, date)
>>>>>>> 2e74306ac7a5a558fd5a918bfb28b0528ede5ca9
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_download_counts_user ON download_counts (username);
CREATE INDEX IF NOT EXISTS idx_download_counts_date ON download_counts (date);
CREATE INDEX IF NOT EXISTS idx_site_mappings_user    ON site_mappings (username);
<<<<<<< HEAD

-- 登录日志表
CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  login_time TEXT NOT NULL,
  ip TEXT NOT NULL,
  device TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs (username);
CREATE INDEX IF NOT EXISTS idx_login_logs_time ON login_logs (login_time);

-- 按站点配置表（每个子账户的每个落地页独立配置像素/APK）
CREATE TABLE IF NOT EXISTS account_sites (
  site            TEXT NOT NULL,
  username        TEXT NOT NULL,
  pixel_ids       TEXT NOT NULL DEFAULT '[]',
  apk_url         TEXT NOT NULL DEFAULT '',
  apk_history     TEXT NOT NULL DEFAULT '[]',
  config_version  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site, username)
);
CREATE INDEX IF NOT EXISTS idx_account_sites_username ON account_sites (username);

-- 访问日志表（前端像素/APK请求记录）
CREATE TABLE IF NOT EXISTS visit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  site TEXT NOT NULL,
  visit_time TEXT NOT NULL,
  ip TEXT NOT NULL,
  device TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  terminal_type TEXT NOT NULL DEFAULT '',
  phone_model TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  media TEXT NOT NULL DEFAULT '',
  referer_source TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_visit_logs_user ON visit_logs (username);
CREATE INDEX IF NOT EXISTS idx_visit_logs_site ON visit_logs (site);
CREATE INDEX IF NOT EXISTS idx_visit_logs_time ON visit_logs (visit_time);
=======
>>>>>>> 2e74306ac7a5a558fd5a918bfb28b0528ede5ca9
