# StreamFlix — D1 完整迁移部署指南

## 最终架构

```
KV（仅保留旧数据）        D1（所有读写）              R2
─────────────────       ──────────────────       ─────────
                        accounts                APK 文件
                         ├─ username
                         ├─ password
                         ├─ role
                         ├─ site
                         ├─ pixel_ids      ← 新迁入
                         ├─ apk_url        ← 新迁入
                         ├─ apk_history    ← 新迁入
                         └─ created

                        site_mappings
                         ├─ site
                         └─ username

                        download_counts
                         ├─ username
                         ├─ date
                         └─ count
```

---

## 第一次部署 D1 时

### 1. Cloudflare Dashboard → D1 → 控制台 → 执行建表 SQL

如果**之前没有建过表**，直接执行 `schema.sql` 全部内容。

### 2. 如果**已经建过表**（之前迁移了账户和计数器），只需加新字段

在 D1 控制台执行：

```sql
ALTER TABLE accounts ADD COLUMN pixel_ids TEXT DEFAULT '[]';
ALTER TABLE accounts ADD COLUMN apk_url TEXT DEFAULT '';
ALTER TABLE accounts ADD COLUMN apk_history TEXT DEFAULT '[]';
```

> 如果报错 "duplicate column name"，说明字段已存在，忽略即可。

---

## 第三步：Cloudflare Pages 绑定 D1

1. Dashboard → Workers & Pages → 你的 Pages 项目
2. **设置 → Functions → D1 数据库绑定 → 添加绑定**
   - 变量名：`DB`
   - 选择：`streamflix-db`

---

## 第四步：推送代码

```bash
git add .
git commit -m "全部迁移到 D1：账户+计数器+像素+APK配置"
git push origin main
```

---

## 部署后验证

1. 管理员登录 → 账户管理 → 旧的 3 个子账户应可见（KV 回退自动迁移）
2. 子账户登录 → Dashboard → 历史点击数据应可见（D1+KV 合并）
3. 子账户 → 修改像素 → 应保存成功（D1 写入，不触发 KV 限额）
4. 子账户 → 修改跳转地址 → 应保存成功
5. D1 控制台检查：

```sql
SELECT username, site, pixel_ids, apk_url FROM accounts;
SELECT * FROM download_counts ORDER BY date DESC LIMIT 10;
```

---

## 回退说明

所有旧 KV 数据不会被删除。D1 不可用时，代码会自动回退到 KV 读取。迁移是单向的（KV → D1），平稳过渡。
