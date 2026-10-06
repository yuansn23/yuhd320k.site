-- 落地页备注说明（子账户为每个落地页添加备注）
-- 独立表，不改动 account_sites / schema.sql，重复执行安全（IF NOT EXISTS）。
CREATE TABLE IF NOT EXISTS site_remarks (
  site       TEXT NOT NULL,
  username   TEXT NOT NULL,
  remark     TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (site, username)
);
CREATE INDEX IF NOT EXISTS idx_site_remarks_username ON site_remarks (username);
