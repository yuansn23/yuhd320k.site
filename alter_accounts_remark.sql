-- 给 accounts 表加 remark 列（账户级备注，管理员填写）
-- 非幂等（ALTER TABLE），只执行一次
ALTER TABLE accounts ADD COLUMN remark TEXT;
