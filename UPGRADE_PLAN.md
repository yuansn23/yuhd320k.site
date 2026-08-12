# StreamFlix 多租户升级方案

## 数据模型

KV 存储结构（按账户前缀隔离）：

```
account:admin          → {"role":"admin","pw":"xxx","created":"..."}
account:user1          → {"role":"user","pw":"xxx","site":"site1.example.com","created":"..."}
account:user2          → {"role":"user","pw":"xxx","site":"site2.example.com","created":"..."}

user1:apk_url          → "https://cdn.example.com/app.apk"
user1:apk_history      → [{"url":"...","filename":"...","time":"..."}, ...]
user1:pixel_ids        → ["1234567890","9876543210"]
user1:download_count   → 150
user1:download_2026-08-06 → 45

user2:apk_url          → "https://cdn.example.com/app2.apk"
user2:pixel_ids        → ["1111111111"]
user2:download_count   → 300
```

## API 路由

| 端点 | 用途 | 权限 |
|------|------|------|
| POST /api/admin/login | 登录（管理员+子账户） | 公开 |
| GET /api/admin/accounts | 列出所有子账户 | 管理员 |
| POST /api/admin/accounts | 创建/修改子账户 | 管理员 |
| DELETE /api/admin/accounts | 删除子账户 | 管理员 |
| GET /api/admin/my/apk-url | 获取我的APK URL | 所有登录用户 |
| POST /api/admin/my/apk-url | 设置APK（手动URL或上传） | 所有登录用户 |
| GET /api/admin/my/pixels | 获取我的像素ID | 所有登录用户 |
| POST /api/admin/my/pixels | 设置我的像素ID | 所有登录用户 |
| GET /api/admin/my/history | 获取我的上传历史 | 所有登录用户 |
| GET /api/admin/my/stats | 获取我的下载统计 | 所有登录用户 |

前端公开接口（无需认证，根据域名自动匹配账户）：

| 端点 | 用途 |
|------|------|
| GET /api/apk-url | 根据Host返回对应账户的APK URL |
| GET /api/pixels | 根据Host返回对应账户的像素ID |

## 账户识别机制

前端通过 `window.location.hostname` 识别站点，API 通过请求的 `Host` 或 `Referer` header 匹配账户。

```
site1.example.com → 账户 "user1" → 加载 user1 的像素 + APK
site2.example.com → 账户 "user2" → 加载 user2 的像素 + APK
```

管理员在创建子账户时绑定站点域名，域名→账户的映射存在 KV 中。
