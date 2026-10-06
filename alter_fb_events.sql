-- ============================================================
-- FB 转化事件选择：给 account_sites 加 fb_events 列（JSON 数组，存已选事件）
-- 运行一次即可：
--   wrangler d1 execute streamflix-db --file alter_fb_events.sql
-- 说明：默认【全选】6 个事件；子账户可在后台「像素管理」勾选/取消，各落地页独立。
--       空数组 [] = 用户主动取消全部 = 不回传任何转化事件。
-- ============================================================
ALTER TABLE account_sites ADD COLUMN fb_events TEXT NOT NULL DEFAULT '["AddToCart","Contact","Lead","CompleteRegistration","Purchase","Download"]';

-- 已有落地页全部回填为「全选」（无需你手动批量更新，跑这一条即可）
UPDATE account_sites
SET fb_events = '["AddToCart","Contact","Lead","CompleteRegistration","Purchase","Download"]';
