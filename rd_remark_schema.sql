-- 超强分流链接（短链）备注说明
-- 独立表，不改动 rd_links / rd_schema.sql，重复执行安全（IF NOT EXISTS）。
CREATE TABLE IF NOT EXISTS rd_link_remarks (
  link_id    TEXT PRIMARY KEY,
  username   TEXT NOT NULL DEFAULT '',
  remark     TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_rd_link_remarks_username ON rd_link_remarks (username);
