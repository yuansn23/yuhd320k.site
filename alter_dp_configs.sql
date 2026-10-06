-- ============================================================
-- DP配置：增加「备注 remark」+「序号 seq」两列（老库运行一次即可）：
--   wrangler d1 execute streamflix-db --file alter_dp_configs.sql
-- 说明：remark = 用户自定义备注（可修改）；seq = 每个子账户内自然增长的序号 1,2,3...
--       老数据自动按「更新时间升序」补齐序号；之后新链接保存时自动取 max+1。
-- ============================================================

ALTER TABLE dp_configs ADD COLUMN remark TEXT NOT NULL DEFAULT '';
ALTER TABLE dp_configs ADD COLUMN seq INTEGER;

-- 老数据补序号：每个子账户内按更新时间升序编号 1,2,3...
UPDATE dp_configs
SET seq = (
  SELECT sub.rn
  FROM (
    SELECT site,
           ROW_NUMBER() OVER (PARTITION BY username ORDER BY updated_at ASC, site ASC) AS rn
    FROM dp_configs
  ) sub
  WHERE sub.site = dp_configs.site
);
