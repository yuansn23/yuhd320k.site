-- ============================================================
-- TikTok 像素配置：给 account_sites 加 tt_pixel_ids（JSON 数组）+ tt_events（JSON 数组）
-- 运行一次即可：
--   wrangler d1 execute streamflix-db --file alter_tt_pixel.sql
-- 说明：tt_pixel_ids 默认空数组 []（未配置）；tt_events 默认全选 4 个 TikTok 事件。
--       各落地页独立隔离，与 Facebook 像素互不影响。
-- ============================================================
ALTER TABLE account_sites ADD COLUMN tt_pixel_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE account_sites ADD COLUMN tt_events TEXT NOT NULL DEFAULT '["ClickButton","Contact","AddToCart","CompleteRegistration"]';

-- 已有落地页的 tt_events 回填为「全选 4 个」（tt_pixel_ids 保持默认 [] 无需回填）
UPDATE account_sites
SET tt_events = '["ClickButton","Contact","AddToCart","CompleteRegistration"]';
