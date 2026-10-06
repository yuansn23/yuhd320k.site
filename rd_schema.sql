-- ============================================================
-- 超强分流链接（短链分流）— 全新独立表，与既有业务（斗篷/像素/跳转/下载计数）无任何关联
-- 建表方式（与现有手动迁移一致）：
--   wrangler d1 execute streamflix-db --file rd_schema.sql
-- ============================================================

-- a跳转域名（短链前缀域名，可配置多个，下拉选择）
CREATE TABLE IF NOT EXISTS rd_domains (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL DEFAULT '',       -- 归属账户
  domain      TEXT NOT NULL,                  -- 跳转域名，如 xxx.com（不含协议与路径）
  created_at  TEXT NOT NULL DEFAULT '',
  UNIQUE(username, domain)
);

-- 短链（a链接），主键为 8 位字母数字跳转 id
CREATE TABLE IF NOT EXISTS rd_links (
  id          TEXT PRIMARY KEY,               -- 8位字母数字代码（跳转id），如 dn67sdag
  username    TEXT NOT NULL DEFAULT '',       -- 归属账户
  domain      TEXT NOT NULL DEFAULT '',       -- 所属 a域名
  mode        TEXT NOT NULL DEFAULT 'random', -- random 随机 / weighted 权重
  dedup       INTEGER NOT NULL DEFAULT 1,     -- 去重：同一 cookie 固定跳同一链接（1 开 0 关）
  enabled     INTEGER NOT NULL DEFAULT 1,     -- 1 启用 0 禁用
  created_at  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT ''
);

-- 目标链接（b链接，b1/b2/b3...），权重为相对比例（删除后自动按剩余权重重新分流）
CREATE TABLE IF NOT EXISTS rd_targets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id     TEXT NOT NULL,                  -- 所属短链 id
  type        TEXT NOT NULL DEFAULT 'url',    -- url 普通链接 / whatsapp WhatsApp
  url         TEXT NOT NULL,                  -- 最终跳转地址（whatsapp 为 https://wa.me/号码）
  weight      INTEGER NOT NULL DEFAULT 1,     -- 权重（相对值；随机模式忽略）
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT ''
);

-- 302 跳转统计
CREATE TABLE IF NOT EXISTS rd_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id     TEXT NOT NULL DEFAULT '',
  username    TEXT NOT NULL DEFAULT '',
  domain      TEXT NOT NULL DEFAULT '',       -- a域名
  from_url    TEXT NOT NULL DEFAULT '',       -- 跳转前 a链接
  to_url      TEXT NOT NULL DEFAULT '',       -- 跳转后 b链接
  ip          TEXT NOT NULL DEFAULT '',
  device      TEXT NOT NULL DEFAULT '',       -- android/ios/pc/mac/other
  created_at  TEXT NOT NULL DEFAULT ''        -- ISO UTC 时间（前端展示时转 +8）
);

CREATE INDEX IF NOT EXISTS idx_rd_links_user ON rd_links(username, created_at);
CREATE INDEX IF NOT EXISTS idx_rd_targets_link ON rd_targets(link_id);
CREATE INDEX IF NOT EXISTS idx_rd_logs_user ON rd_logs(username, created_at);
CREATE INDEX IF NOT EXISTS idx_rd_logs_link ON rd_logs(link_id, created_at);
