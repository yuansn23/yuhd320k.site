-- ============================================================
-- D1 优化迁移（独立文件，不动 schema.sql）
-- 目的：给日志表补索引 + 新增预聚合计数器，消除 COUNT(*) 全表扫
-- 执行：wrangler d1 execute streamflix-db --remote --file optimize_schema.sql
-- 或在 Cloudflare 后台 D1 → streamflix-db → Console 里逐段执行
-- ============================================================

-- ── P0 · click_logs 补索引（此前无任何索引，WHERE username ORDER BY click_time 全表扫）──
CREATE INDEX IF NOT EXISTS idx_click_logs_user_time ON click_logs(username, click_time);

-- ── P0 · visit_logs 补复合索引（比单列更贴合 WHERE username=? ORDER BY visit_time DESC）──
CREATE INDEX IF NOT EXISTS idx_visit_logs_user_time ON visit_logs(username, visit_time);

-- ── P1 · 预聚合计数器表（写入时 +1，读取时 SUM，替代 COUNT(*) 全表扫）──
-- visits/clicks 覆盖访问与点击；cloak_*/ab_* 覆盖斗篷/AB 流量（total=总条数, pass=通过条数）
CREATE TABLE IF NOT EXISTS stats_daily (
  username    TEXT NOT NULL,
  date        TEXT NOT NULL,            -- YYYY-MM-DD
  visits      INTEGER NOT NULL DEFAULT 0,
  clicks      INTEGER NOT NULL DEFAULT 0,
  cloak_total INTEGER NOT NULL DEFAULT 0,
  cloak_pass  INTEGER NOT NULL DEFAULT 0,
  ab_total    INTEGER NOT NULL DEFAULT 0,
  ab_pass     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (username, date)
);
CREATE INDEX IF NOT EXISTS idx_stats_daily_username_date ON stats_daily(username, date);

-- ── 回填历史访问计数（一次性；数据量大超时的话改用 wrangler CLI）──
INSERT INTO stats_daily (username, date, visits, clicks)
SELECT username, substr(visit_time, 1, 10) AS d, COUNT(*) AS v, 0 AS c
FROM visit_logs
GROUP BY username, substr(visit_time, 1, 10)
ON CONFLICT(username, date) DO UPDATE SET visits = excluded.visits;

-- ── 回填历史点击计数（一次性）──
INSERT INTO stats_daily (username, date, visits, clicks)
SELECT username, substr(click_time, 1, 10) AS d, 0 AS v, COUNT(*) AS c
FROM click_logs
GROUP BY username, substr(click_time, 1, 10)
ON CONFLICT(username, date) DO UPDATE SET clicks = excluded.clicks;

-- ── 回填历史斗篷流量计数（一次性）──
INSERT INTO stats_daily (username, date, cloak_total, cloak_pass)
SELECT username, substr(created_at, 1, 10) AS d, COUNT(*) AS total,
       SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS pass
FROM cloak_traffic
WHERE username != ''
GROUP BY username, substr(created_at, 1, 10)
ON CONFLICT(username, date) DO UPDATE SET cloak_total = excluded.cloak_total, cloak_pass = excluded.cloak_pass;

-- ── 回填历史 AB 流量计数（一次性）──
INSERT INTO stats_daily (username, date, ab_total, ab_pass)
SELECT username, substr(created_at, 1, 10) AS d, COUNT(*) AS total,
       SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS pass
FROM ab_traffic
WHERE username != ''
GROUP BY username, substr(created_at, 1, 10)
ON CONFLICT(username, date) DO UPDATE SET ab_total = excluded.ab_total, ab_pass = excluded.ab_pass;
