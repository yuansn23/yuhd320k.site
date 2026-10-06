-- 超强分流链接（短链）防护配置
-- 独立表，不改动 rd_links / rd_schema.sql，重复执行安全（IF NOT EXISTS）。
-- 执行方式：wrangler d1 execute streamflix-db --remote --file rd_protection_schema.sql
CREATE TABLE IF NOT EXISTS rd_protection (
  link_id       TEXT PRIMARY KEY,               -- 短链 id（8 位字母数字）
  username      TEXT NOT NULL DEFAULT '',       -- 归属账户
  enabled       INTEGER NOT NULL DEFAULT 0,     -- 防护总开关 1/0
  whitelist_ips TEXT NOT NULL DEFAULT '[]',     -- 白名单 IP JSON 数组（命中直接放行）
  rules         TEXT NOT NULL DEFAULT '{}',     -- 规则 JSON（爬虫/设备/语言/时区/IP/隐私）
  fallback_url  TEXT NOT NULL DEFAULT '',       -- 命中规则时跳转地址（空 = 返回 404）
  updated_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_rd_protection_username ON rd_protection (username);
