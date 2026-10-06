# 天御系统（StreamFlix）项目文档

> 面向后续接手开发者的一站式文档：项目总结 + 架构 + 数据模型 + 功能 + API + 部署 + 已知问题 + 优化方向。
> 最后更新：2026-09-26

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术架构](#2-技术架构)
3. [目录结构](#3-目录结构)
4. [数据模型（全部表）](#4-数据模型全部表)
5. [鉴权机制](#5-鉴权机制)
6. [功能模块详解](#6-功能模块详解)
7. [API 接口清单](#7-api-接口清单)
8. [前端说明](#8-前端说明)
9. [部署与迁移](#9-部署与迁移)
10. [数据库优化方案（本轮迭代）](#10-数据库优化方案本轮迭代)
11. [已知问题与注意事项](#11-已知问题与注意事项)
12. [后续优化方向](#12-后续优化方向)
13. [更新日志（2026-08-19 之后）](#13-更新日志2026-08-19-之后)

---

## 1. 项目概览

| 项 | 值 |
|---|---|
| 产品名 | 天御系统（代码内标识 `streamflix`） |
| 部署方式 | Cloudflare Pages（静态站点 + Pages Functions） |
| 生产域名 | `https://url.yuhd320k.site` |
| 管理后台 | `https://url.yuhd320k.site/admin.html`（`/admin` 也重定向到这里） |
| 联系方式 | Telegram `@snvtr2` |
| 核心能力 | 多租户「流量防护」平台：Facebook 像素管理、APK 下载分发、普通跳转、**落地页斗篷（cloaking）**、**AB 页斗篷**、**超强分流短链**、账户与统计 |
| 绑定资源 | D1（`DB` 数据库）、KV（`kvadmin` 命名空间）、R2（`r2admin` 存储桶） |
| 运行环境 | Cloudflare Workers Runtime（JS，无框架，纯 `onRequest(context)` 函数） |

**一句话定位**：给多个子账户（多租户）提供「落地页 → 像素/APK/跳转 → 斗篷防审核 → 短链分流」的一站式流量承接与防护工具。

---

## 2. 技术架构

### 2.1 整体模型

```
访客浏览器
   │
   ├─ 访问落地页（子账户自己的站点域名）
   │     ├─ <script src=".../api/pixels">     → 返回该站点的 Facebook Pixel ID
   │     ├─ 点击下载按钮 → /api/apk-url       → 返回该站点的 APK 下载地址
   │     ├─ 下载/跳转    → /api/dl 或 /api/rd  → 计数 + 302/文件流
   │     └─ 斗篷守卫脚本 js/cloak.js → /api/cloak → 点击拦截验证
   │
   ├─ 访问 A 页（审核页）
   │     └─ ab-ck.js → /api/ab-cloak → 真实用户跳 B 页 / 爬虫留 A 页
   │
   └─ 访问短链 https://{a域名}/rd/{8位id}
         └─ /rd/[id] → 随机/权重选目标 b 链接 → 302 + 记录 rd_logs

管理员 / 子账户浏览器
   └─ /admin.html 单页应用 → 调 /api/admin/* 接口
```

### 2.2 关键设计原则

- **多租户隔离**：一个子账户可绑定多个「落地页站点」（`site`）。像素 / APK 配置按 `(site, username)` 存 `account_sites`，**站点级隔离，绝不跨站回退**（A 站点没配像素就返回空，不用 B 站点的）。
- **站点识别（反解账户）**：公开接口通过 `?site=` 参数或请求 `Host`/`Referer` 识别站点，再经 `site_mappings` 反解出 `username`。匹配做了「多级容错」：精确 → 末尾斜杠变体 → 加 `.html` → 纯域名 → 全表 hostname 兜底。
- **fail-open（宁可放行不误伤）**：所有防护判定在「未配置 / 开关关 / 权限未开 / 表缺失 / 异常」时一律放行或跳转。
- **KV → D1 单向迁移**：账户、配置、计数逐步从 KV 迁到 D1，代码保留 KV 回退与自动迁移逻辑，过渡期双读。

### 2.3 依赖（Cloudflare 绑定）

| binding | 类型 | 用途 |
|---|---|---|
| `DB` | D1 数据库 `streamflix-db` | 账户、站点映射、配置、日志、计数器（主存储） |
| `kvadmin` | KV 命名空间 | 旧数据 / APK 历史 / 全局像素 / IP 情报缓存 |
| `r2admin` | R2 存储桶 `admin` | APK 文件存储 |

### 2.4 环境变量（`wrangler.toml` 的 `[vars]`）

| 变量 | 用途 |
|---|---|
| `ADMIN_USER` / `ADMIN_PASS` | 管理员账号密码（登录兜底 + 若干老接口的直接校验） |
| `CF_API_TOKEN` / `CF_ZONE_ID` | 预留的 Cloudflare API 凭据（当前代码未实际调用，且 token 已失效） |
| `IPINFO_TOKEN` | ipinfo.io 付费 token（`privacy.vpn/proxy` 精确字段；为空则退化为免费 `/json`） |
| `IPAPI_KEY` | api.ipapi.is 付费 key（`is_datacenter/is_vpn/is_proxy/is_tor` 精确字段） |

> ⚠️ `IPINFO_TOKEN`、`IPAPI_KEY` 是**付费 key**，禁止提交到公开仓库。

---

## 3. 目录结构

```
tvnf/
├── wrangler.toml            # Pages 配置：名称、环境变量、KV/D1/R2 绑定
├── _headers                 # 去掉斗篷守卫脚本的静态缓存
├── _redirects               # /admin/admin → /admin.html；/t/* → /t/index.html
│
├── admin.html               # 管理后台单页应用（2388 行，核心前端）
├── index.html               # 公开落地页（467 行）
├── 1.html                   # 落地页/部署示例（1264 行，含大量说明）
├── redirect-script.html     # 短链跳转中转页示例（渲染"正在跳转"后交给 /rd/[id]）
├── js/cloak.js              # 斗篷守卫脚本（静态，接入落地页 <head>）
├── ab-ck.js                 # AB 页斗篷守卫脚本（静态，接入 A 页 <head>）
│
├── functions/
│   ├── api/
│   │   ├── pixels.js        # 公开：按站点返回像素 ID + 记访问日志
│   │   ├── apk-url.js       # 公开：按站点返回 APK 下载地址
│   │   ├── dl.js            # 公开：从 R2 下载 APK + 记点击
│   │   ├── rd.js            # 公开：普通跳转 302 + 记点击
│   │   ├── cloak.js         # 公开：斗篷判定（POST）
│   │   ├── ab-cloak.js      # 公开：AB 页斗篷判定（POST）
│   │   └── admin/           # 管理后台接口（见 API 清单）
│   │       ├── login.js
│   │       ├── accounts.js
│   │       ├── migrate-accounts.js
│   │       ├── pixels.js
│   │       ├── upload.js
│   │       ├── download-count.js
│   │       ├── history.js
│   │       ├── login-logs.js
│   │       ├── debug.js
│   │       ├── ab-perm.js
│   │       └── my-*.js      # 子账户「我的」系列接口（14 个）
│   └── rd/[id].js           # 公开：短链 302 分流（动态路由）
│
├── *.sql                    # 数据库建表/迁移脚本（见 §9）
│   ├── schema.sql           # 基础表（⚠️ 含 git 冲突标记，不要编辑）
│   ├── cloak_schema.sql     # 斗篷表
│   ├── ab_schema.sql        # AB 页斗篷表
│   ├── rd_schema.sql        # 短链分流表
│   ├── alter_cloak_perm.sql # accounts 加 cloak_enabled 列
│   └── optimize_schema.sql  # 本轮优化：索引 + stats_daily 预聚合
│
├── es/                      # 独立落地页（含图片资源，非核心）
├── okonline/                # ⚠️ 遗留/备份副本（自带 wrangler.toml，非当前项目）
├── img/                     # 图片资源
└── DEPLOY.md / DEPLOY_D1.md / UPGRADE_PLAN.md   # 早期部署文档（部分过时，以本文档为准）
```

---

## 4. 数据模型（全部表）

> 主键 `PK`，索引 `IX`。时间字段均为 ISO UTC 字符串（`new Date().toISOString()`），前端展示时转 +8。

### 4.1 账户与站点

**`accounts`** —— 账户表（管理员 + 子账户）

| 列 | 类型 | 说明 |
|---|---|---|
| username | TEXT PK | 用户名 |
| password | TEXT | 密码 |
| role | TEXT | `admin` / `user`（默认 user） |
| site | TEXT | 主站点（老数据） |
| created | TEXT | 创建时间 |
| pixel_ids | TEXT | 像素 ID JSON 数组（历史共享字段） |
| apk_url | TEXT | APK 地址（历史共享字段） |
| apk_history | TEXT | 上传历史 JSON 数组 |
| config_version | INT | 配置版本号 |
| cloak_enabled | INT | 斗篷权限开关（默认 0，由 alter_cloak_perm.sql 加） |
| status | TEXT | `active` / `disabled`（⚠️ 代码用到但 schema 未声明） |

**`site_mappings`** —— 站点 → 账户映射（反解账户的关键）

| 列 | 类型 | 说明 |
|---|---|---|
| site | TEXT PK | 站点（可能是完整 URL / 域名 / 带路径） |
| username | TEXT | 归属账户 |
| | IX idx_site_mappings_user | `(username)` |

**`account_sites`** —— 每个子账户的每个落地页独立配置（**站点级隔离的主表**）

| 列 | 类型 | 说明 |
|---|---|---|
| site | TEXT | 落地页（PK 的一部分） |
| username | TEXT | 账户（PK 的一部分） |
| pixel_ids | TEXT | 该站点像素 ID JSON |
| apk_url | TEXT | 该站点 APK 地址 |
| apk_history | TEXT | 该站点上传历史 JSON |
| config_version | INT | 配置版本 |
| PK | | `(site, username)` |
| IX idx_account_sites_username | | `(username)` |

### 4.2 下载 / 访问 / 点击 / 登录日志

**`download_counts`** —— 下载计数器（按用户 + 日期 + 站点）

| 列 | 类型 |
|---|---|
| username / date / site / count | TEXT / TEXT / TEXT / INT |
| PK `(username, date, site)`（⚠️ schema.sql 冲突里另一版是 `(username, date)`） |
| IX idx_download_counts_user `(username)`、idx_download_counts_date `(date)` |

**`visit_logs`** —— 访问日志（像素/APK 请求记录）

| 列 | 类型 |
|---|---|
| id / username / site / visit_time / ip / device / user_agent | 基础 |
| terminal_type / phone_model / lang / media / referer_source | 扩展（默认空串，由前端 UA 解析展示） |
| IX idx_visit_logs_user `(username)`、idx_visit_logs_site `(site)`、idx_visit_logs_time `(visit_time)` |
| IX idx_visit_logs_user_time `(username, visit_time)`（本轮新增） |

**`click_logs`** —— 点击日志（⚠️ **仓库无建表语句**，线上手动建的）

| 列 | 类型 |
|---|---|
| username / site / click_time / ip / device / lang / user_agent | |
| IX idx_click_logs_user_time `(username, click_time)`（本轮新增） |

**`login_logs`** —— 子账户登录日志

| 列 | 类型 |
|---|---|
| id / username / login_time / ip / device / user_agent | |
| IX idx_login_logs_user `(username)`、idx_login_logs_time `(login_time)` |

### 4.3 斗篷（cloaking）

**`cloak_configs`** —— 每个落地页一条斗篷配置

| 列 | 类型 | 说明 |
|---|---|---|
| site | TEXT PK | 落地页 |
| enabled | INT | 总开关 0/1 |
| fallback_url | TEXT | 命中规则时跳转地址（默认 google） |
| whitelist_ips | TEXT | 白名单 IP JSON 数组（命中完全放行） |
| rules | TEXT | 全量规则 JSON（见 §6.4） |
| updated_at | TEXT | |

**`cloak_traffic`** —— 斗篷流量日志

| 列 | 类型 | 说明 |
|---|---|---|
| id / site / username / ip / device / terminal / lang / timezone | | 基本信息 |
| is_vpn / is_proxy | INT | 来自 IP 情报 |
| passed | INT | 1 通过 / 0 拦截 |
| triggered_rules | TEXT | 命中规则 id JSON 数组 |
| ua / created_at | TEXT | |
| IX idx_cloak_traffic_user `(username, created_at)`、idx_cloak_traffic_site `(site, created_at)` | | |

### 4.4 AB 页斗篷

**`ab_configs`** —— 每个 A 页一条 AB 配置

| 列 | 类型 | 说明 |
|---|---|---|
| a_url | TEXT PK | A 页地址（审核页） |
| username | TEXT | 归属账户 |
| enabled | INT | 总开关 |
| b_url | TEXT | B 页地址（真实业务） |
| whitelist_ips | TEXT | 白名单 IP JSON |
| rules | TEXT | 规则 JSON（爬虫 + 设备环境，无行为模块） |
| updated_at | TEXT | |

**`ab_permissions`** —— 每个子账户一条 AB 权限（默认关闭）

| 列 | 类型 |
|---|---|
| username | TEXT PK |
| enabled | INT |

**`ab_traffic`** —— AB 页流量日志

| 列 | 类型 | 说明 |
|---|---|---|
| id / a_url / username / ip / device / lang / timezone | | |
| is_vpn / is_proxy | INT | |
| passed | INT | 1 真实用户(跳 B) / 0 命中规则(留 A) |
| redirect_to | TEXT | 跳转目标（B 页或空） |
| triggered_rules / ua / created_at | TEXT | |
| IX idx_ab_traffic_user `(username, created_at)`、idx_ab_traffic_a `(a_url, created_at)` | | |

### 4.5 超强分流短链

**`rd_domains`** —— 跳转域名表（⚠️ **代码实际用硬编码数组，见 §6.6**）

| 列 | 类型 |
|---|---|
| id / username / domain / created_at | |
| UNIQUE(username, domain) | |

**`rd_links`** —— 短链（8 位字母数字 id）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | 8 位短链 id |
| username / domain | TEXT | 归属账户 / 所属 a 域名 |
| mode | TEXT | `random` 随机 / `weighted` 权重 |
| enabled | INT | 1 启用 / 0 禁用 |
| created_at / updated_at | TEXT | |
| IX idx_rd_links_user `(username, created_at)` | | |

**`rd_targets`** —— 目标链接（b1/b2/b3…）

| 列 | 类型 | 说明 |
|---|---|---|
| id / link_id / type / url / weight / sort / created_at | | type：`url` / `whatsapp`；weight 权重 |
| IX idx_rd_targets_link `(link_id)` | | |

**`rd_logs`** —— 302 跳转统计

| 列 | 类型 |
|---|---|
| id / link_id / username / domain / from_url / to_url / ip / device / created_at | |
| IX idx_rd_logs_user `(username, created_at)`、idx_rd_logs_link `(link_id, created_at)` | |

### 4.6 预聚合统计（本轮新增）

**`stats_daily`** —— 每日聚合计数器（替代 COUNT(*) 全表扫）

| 列 | 类型 | 说明 |
|---|---|---|
| username | TEXT | 账户（PK 的一部分） |
| date | TEXT | `YYYY-MM-DD`（PK 的一部分） |
| visits | INT | 访问次数 |
| clicks | INT | 点击次数 |
| cloak_total | INT | 斗篷流量总条数 |
| cloak_pass | INT | 斗篷通过条数（fail = total - pass） |
| ab_total | INT | AB 流量总条数 |
| ab_pass | INT | AB 通过条数 |
| PK | | `(username, date)` |
| IX idx_stats_daily_username_date | | `(username, date)` |

### 4.7 DP 配置（落地页环境分流）与 FB 事件（2026-08 之后新增）

**`dp_configs`** —— 每个落地页一条 DP 配置

| 列 | 类型 | 说明 |
|---|---|---|
| site | TEXT PK | 落地页地址（给用户看的落地页） |
| username | TEXT | 归属子账户 |
| enabled | INT | DP 分流总开关 0/1 |
| actual_url | TEXT | 实际地址（符合规则 → 跳这里） |
| fallback_url | TEXT | 不符合规则地址（命中规则 → 跳这里） |
| whitelist_ips | TEXT | 白名单 IP JSON（命中直接跳实际地址） |
| rules | TEXT | 全量规则 JSON（爬虫 + 设备环境，同 AB） |
| remark | TEXT | 备注（`alter_dp_configs.sql` 加，默认 `''`） |
| seq | INT | 子账户内自然增长序号（`alter_dp_configs.sql` 加） |
| updated_at | TEXT | |

**`dp_traffic`** —— DP 流量日志

| 列 | 类型 | 说明 |
|---|---|---|
| id / site / username / ip / device / lang / timezone | | 基本信息 |
| is_vpn / is_proxy | INT | 来自 IP 情报 |
| passed | INT | 1 符合规则(跳实际地址) / 0 命中规则(跳 fallback) |
| redirect_to / triggered_rules / ua / created_at | TEXT | |
| IX idx_dp_traffic_user `(username, created_at)`、idx_dp_traffic_site `(site, created_at)` | | |

**`dp_permissions`** —— DP 权限（默认关闭，仅 `xifeng666` 开通）

| 列 | 类型 |
|---|---|
| username | TEXT PK |
| enabled | INT |

**`account_sites.fb_events`** —— FB 转化事件选择（`alter_fb_events.sql` 加）

- `TEXT NOT NULL DEFAULT '["AddToCart","Contact","Lead","CompleteRegistration","Purchase","Download"]'`，按落地页隔离，默认全选 6 事件；空 `[]` = 用户主动取消全部。

---

## 5. 鉴权机制

### 5.1 Token 结构

前端登录后把 token 存 sessionStorage，后续请求带 `Authorization: Basic <base64>`。token 明文为：

```
btoa(username + ':' + role + ':' + password)
```

即 `Basic ` + base64(`user:role:password`)。服务端用相同规则重建后比对，**不存服务端会话**（无状态）。

### 5.2 三类接口权限

| 类型 | 校验方式 | 校验函数 |
|---|---|---|
| 公开 | 无鉴权 | `pixels.js / apk-url.js / dl.js / rd.js / rd/[id].js / cloak.js / ab-cloak.js` |
| 管理员 | `checkAdmin()`：解析 token，`role === 'admin'` 且用 D1 里的 admin 密码重建 token 比对 | `accounts.js / ab-perm.js / login-logs.js / migrate-accounts.js` |
| 子账户 | `getMyUser()`：解析 `user`，D1（或 KV）查密码，重建 token 比对 | `my-*.js` 系列 |

### 5.3 特殊点

- 部分老接口（`pixels.js`、`upload.js`、`download-count.js`、`history.js`、`debug.js`、`migrate-accounts.js`）直接用 `env.ADMIN_USER`/`env.ADMIN_PASS` 拼 `btoa(user + ':' + pass)` 比对，**不查 D1**、不含 role。
- `login.js` 登录成功返回 `{ ok, token, role, user, site, cloak_enabled }`；登录逻辑：D1 查账户 → KV 回退并自动迁移 → 环境变量回退（管理员首登写入 D1）。
- 子账户鉴权里 `role` 取自 token，服务端不强制校验 role（信任 token 里的 role，靠密码比对兜底）。

---

## 6. 功能模块详解

### 6.1 像素管理（Facebook Pixel）

- **数据**：`account_sites.pixel_ids`（按站点隔离）。
- **公开读**：`GET /api/pixels?site=` 返回该站点像素 ID 数组 + `config_version`，同时**记录访问日志**（`visit_logs` + `stats_daily.visits+1`）。
- **子账户**：`/api/admin/my-pixels` 读写自己站点的像素。
- **管理员**：`/api/admin/pixels` 读写全局 `kvadmin` 里的 `fb_pixel_ids`（历史遗留，与站点级像素是两套）。
- **像素 ID 校验**：`/^\d{10,20}$/`。

### 6.2 APK 下载管理

- **上传**：`POST /api/admin/upload`（管理员）或 `/api/admin/my-apk`（子账户）→ 存 R2 → 生成 `/api/dl?key=` URL → 记历史。
- **公开取址**：`GET /api/apk-url?site=` → 返回 APK 地址；若地址是内部 `/api/dl` 则追加 `_u`/`_s` 追踪参数，否则包装成 `/api/rd?_t=` 走中转计数。
- **下载**：`GET /api/dl?key=` → R2 读文件流返回；`_u`/`_s` 存在时记 `download_counts` + `click_logs` + `stats_daily.clicks+1`。
- **历史**：`account_sites.apk_history`（每站点最多 50 条）。

### 6.3 普通跳转

- `GET /api/rd?_t=<url>&_u=<user>&_s=<site>` → 记点击 → `302` 跳转目标。
- 用于给「外链 APK 下载」中转计数。

### 6.4 斗篷设置（Cloaking）—— 点击时拦截

- **守卫脚本**：`js/cloak.js`，一行 `<script src=".../cloak.js"></script>` 放进落地页 `<head>`。
- **机制**：脚本采集行为信号（滚动/鼠标/触摸/可见性/WebRTC IP），**拦截用户点击交互元素**，POST `/api/cloak` 实时判定；通过则放行原点击，未通过则 `location.replace(fallback_url)`。
- **服务端判定顺序**（`cloak.js`）：
  1. 白名单 IP 命中 → 完全放行；
  2. 账号 `cloak_enabled` 未开 / 配置未找到 / 总开关关 → 放行（fail-open）；
  3. 逐模块评估 `rules`（见下）。
- **规则模块**（`evaluateRules`）：
  | 模块 | 触发条件 |
  |---|---|
  | `crawler` | UA 命中 google/facebook/tiktok 爬虫（可配引擎） |
  | `device` | 设备类型 block/allow 列表（android/ios/pc/mac） |
  | `language` | 语言 block/allow（`zh-cn`/`zh-tw`/`zh-hk`/`en`/`ja`…） |
  | `timezone` | 时区匹配（支持 `+8`/`utc+8`/`Asia/Tokyo`/`日本`/`中国` 等） |
  | `block_ips` | IP 黑名单 |
  | `privacy`/`vpn`/`proxy` | **三路信号任一命中**：① IP 时区 vs 浏览器时区相差 >1h；② WebRTC 泄露（本机暴露与出口不同的公网 IP）；③ IP 情报（api.ipapi.is 的 datacenter/vpn/proxy/tor） |
  | `behavior` | 滚动深度 / 鼠标曲线 / 触摸连续性 / 可见性 / 滚动节奏（**仅斗篷有，AB 页无**） |
- **显示映射**（admin.html）：`privacy → "VPN/代理/机房"`、`crawler → "爬虫"`、`device → "设备环境"`、`language → "语言"`、`timezone → "时区"`、`block_ips → "IP黑名单"`、`behavior.* → "用户行为"`。
- **配置**：`/api/admin/my-cloak`，规则存 `cloak_configs.rules`（JSON）。
- **权限**：账号级 `cloak_enabled`，管理员在「账户管理」开关；未开通时子账户 POST 保存返回 `403 CLOAK_DISABLED`，前端规则设置置灰。

### 6.5 AB 页斗篷 —— 落地即跳转

- **区别**：普通斗篷是「点击按钮才拦截」；AB 页斗篷是「A 页（审核页）加载即判定」——真实用户自动 302 跳 B 页（真实业务），爬虫/审核流量留在 A 页。
- **守卫脚本**：`ab-ck.js`，放进 A 页 `<head>`。
- **判定**（`ab-cloak.js`）：
  1. 未配置 / `enabled=0` / 账号 AB 权限未开 → `{ redirect: null }`（留在 A 页，fail-open）；
  2. 白名单命中 → 视为真实用户 → 跳 `b_url`；
  3. 评估规则（爬虫/设备/语言/时区/IP/VPN/代理）：
     - 未命中（真实用户）→ 跳 `b_url`；
     - 命中（爬虫/被屏蔽）→ `redirect = null`（留在 A 页）。
- **与普通斗篷的差异**：无「用户行为」模块（落地即跳，来不及采集行为信号）；`passed` 语义相反（passed=true → 跳 B）。
- **权限**：独立表 `ab_permissions`，管理员在「账户管理」AB 权限列开关（`/api/admin/ab-perm`）。
- **配置**：`/api/admin/my-ab`，存 `ab_configs`。

### 6.6 超强分流短链

- **用途**：把一个短链地址随机/按权重分流到多个 b 链接，避免单一链接失效或被风控。
- **数据**：`rd_links` + `rd_targets` + `rd_logs`。
- **管理接口**：`/api/admin/my-rdlink`（GET `?action=domains|links|logs`；POST `action=link_add|link_edit|link_del|link_toggle`）。
- **跳转**：`GET /rd/[8位id]` → 按 `mode`（random 均匀 / weighted 权重）选目标 → 记 `rd_logs` → 302。
- **⚠️ 注意**：跳转域名**实际来自 `my-rdlink.js` 顶部的硬编码数组 `RD_DOMAINS`**（如 `https://km37acd.top/t`），**不是** `rd_domains` 表。加域名需改代码重新部署。
- **whatsapp 目标**：一行一个号码 → 展开成 `https://wa.me/<号码>?text=<文本>`。

### 6.7 账户管理（管理员）

- `GET/POST/DELETE /api/admin/accounts`：列出/创建/编辑/删除子账户；启用禁用（`status`）；斗篷权限开关（`toggle-cloak`）。
- 创建/编辑时维护 `site_mappings`、`account_sites`（多站点）一致性；改用户名时联动更新关联表。
- KV → D1 自动迁移（列账户时若 KV 有未迁移账户则自动落库）。
- `GET /api/admin/migrate-accounts`：一键把 KV 账户批量迁到 D1（幂等）。

### 6.8 统计与日志

| 面板 | 接口 | 数据源 |
|---|---|---|
| Dashboard | `/api/admin/my-stats` | 下载统计 + 访问量（visitTotal/visitToday）+ 站点/像素/APK 概览 |
| 下载统计（管理员） | `/api/admin/download-count` | `download_counts`（D1+KV 合并） |
| 访问统计 | `/api/admin/my-visit-logs` | `visit_logs`（含 UA 解析终端/型号/语言/媒体） |
| 点击统计 | `/api/admin/my-click-logs` | `click_logs` |
| 斗篷流量 | `/api/admin/my-cloak-traffic` | `cloak_traffic`（筛选 site/start/end/result） |
| AB 页流量 | `/api/admin/my-ab-traffic` | `ab_traffic`（筛选 a_url/start/end/result） |
| 登录日志 | `/api/admin/login-logs` | `login_logs` |
| 短链跳转统计 | `/api/admin/my-rdlink?action=logs` | `rd_logs` |

> 所有「总数」在**无筛选条件**时读 `stats_daily` 聚合（O(1)），有筛选时走索引 COUNT，`stats_daily` 未建表时自动回退 COUNT。

### 6.9 DP 配置（DP 分流）—— 落地页环境分流

- **定位**：与 AB 页斗篷类似，但用于「落地页」——页面加载即判定，真实用户跳「实际地址」，命中规则（爬虫/被屏蔽）跳「不符合规则地址」。
- **守卫脚本**：`js/dp-ck.js`，落地页 `<head>` 加载时 POST `/api/dp`。
- **公开判定**（`functions/api/dp.js`）：白名单 → 爬虫 UA → 设备 → 语言 → 时区 → IP 黑名单 → 代理/VPN/机房（时区一致性 + WebRTC + IP 情报三路信号）。无配置/关闭时 `redirect=null`（fail-open）。
- **规则模块**：与 AB 相同（爬虫/设备/语言/时区/IP/隐私）；行为模块保留逻辑但落地即跳默认不启用。
- **配置**：`/api/admin/my-dp`，存 `dp_configs`。含「落地页无限域名」`action=gen`（`DP_LANDING_PREFIX` 3 域名硬编码，生成 `{前缀}/{8位随机码}` 全局唯一）+ 备注快捷修改 `action=remark`。
- **流量**：`/api/admin/my-dp-traffic`，存 `dp_traffic`。
- **权限**：独立表 `dp_permissions`，管理员在「账户管理」DP 权限列开关（`/api/admin/dp-perm`）；默认关闭、仅 `xifeng666` 开通。未开通时子账户 POST/DELETE 返回 `403 DP_DISABLED`，前端 DP 导航置灰 + `showDpLocked()`。
- **查询页**：`showDpConfigQuery()`，只读列表，支持按落地页地址（完整 URL / 域名 / 后缀）+ 备注搜索；`describeDpRules()` 中语言/时区按 `mode` 显示「语言允许/屏蔽」「时区允许/屏蔽」。
- **时区输入校验**：地区时区仅允许 UTC 偏移格式（`+8`/`-5`/`+5.5`/`0`），非法保存时提示并给示范。

### 6.10 FB 转化事件多选

- **数据**：`account_sites.fb_events`（JSON 数组，按落地页隔离）。
- **默认**：全选 6 事件 `AddToCart / Contact / Lead / CompleteRegistration / Purchase / Download`（`Download` 走 `trackCustom`，其余走 `track`）。
- **公开读**：`GET /api/pixels` 返回 `events`（列缺失/空值回退全选）。
- **子账户**：`/api/admin/my-pixels` GET 返回 `events`；POST 传了 `events` 才覆盖保存，不传则保留（像素编辑不误改事件）。
- **SDK**：`js/meetu-sdk.js` 下载时按 `_events` 循环触发。
- **后台 UI**：像素管理页「转化事件（下载时触发，可多选）」卡片（在像素列表之前），保存成功弹窗 `alert('✅ 保存成功')`。
- **迁移**：`alter_fb_events.sql` 含回填 UPDATE，**无需手动批量更新**。

---

## 7. API 接口清单

### 7.1 公开接口（无鉴权）

| 方法 | 路径 | 参数 | 返回 / 作用 |
|---|---|---|---|
| GET | `/api/pixels` | `?site=` | 像素 ID 数组 + `version`；记访问日志 |
| GET | `/api/apk-url` | `?site=` | APK 下载地址 `{ url, version }` |
| GET | `/api/dl` | `?key=` `&_u=` `&_s=` | R2 文件流；记下载+点击 |
| GET | `/api/rd` | `?_t=` `&_u=` `&_s=` | 302 跳转；记下载+点击 |
| GET | `/rd/[id]` | 路径 8 位 id | 302 分流；记 rd_logs |
| POST | `/api/cloak` | `{ site, client, behavior, preflight }` | `{ passed, redirect, triggered, whitelisted }`；记 cloak_traffic |
| POST | `/api/ab-cloak` | `{ site, client }` | `{ redirect, passed, triggered, whitelisted }`；记 ab_traffic |

### 7.2 管理员接口（checkAdmin / env 变量）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/login` | 登录（公开，管理员+子账户统一） |
| GET/POST/DELETE | `/api/admin/accounts` | 子账户增删改查 + 启停 + 斗篷权限 |
| GET | `/api/admin/migrate-accounts` | KV→D1 一键迁移 |
| GET/POST | `/api/admin/pixels` | 全局像素 ID（KV `fb_pixel_ids`） |
| POST | `/api/admin/upload` | 上传 APK 到 R2 |
| GET | `/api/admin/download-count` | 下载统计（总 + 近 30 天） |
| GET | `/api/admin/history` | 上传历史（KV） |
| GET | `/api/admin/login-logs` | 登录日志（`?user=` 过滤） |
| GET | `/api/admin/debug` | 环境变量注入诊断 |
| GET/POST | `/api/admin/ab-perm` | AB 权限列表 / 翻转 |

### 7.3 子账户接口（getMyUser，Basic 鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/my-apk` | APK 读/写（手动 URL 或上传） |
| GET/POST | `/api/admin/my-pixels` | 像素读/写 |
| GET/POST/DELETE | `/api/admin/my-sites` | 落地页列表/新增/删除 |
| GET | `/api/admin/my-stats` | Dashboard 统计 |
| GET | `/api/admin/my-visit-logs` | 访问日志（`site/start/end/limit/page`） |
| GET | `/api/admin/my-click-logs` | 点击日志（同上） |
| GET/POST | `/api/admin/my-cloak` | 斗篷配置读/写 |
| GET | `/api/admin/my-cloak-traffic` | 斗篷流量（`site/start/end/result/limit/page`） |
| GET/POST | `/api/admin/my-ab` | AB 配置读/写 |
| GET | `/api/admin/my-ab-traffic` | AB 流量（`a_url/start/end/result/limit/page`） |
| GET/POST | `/api/admin/my-rdlink` | 短链管理（`action=domains/links/logs`；POST `link_add/edit/del/toggle`） |

### 7.4 DP 接口（2026-08 之后新增）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/dp` | 公开 | DP 环境分流判定，返回 `{ redirect, passed, triggered, whitelisted }`；记 dp_traffic |
| GET/POST/DELETE | `/api/admin/my-dp` | 子账户 | DP 配置读/写/删；POST `action=gen`（落地页无限域名）、`action=remark`（备注）；未开通权限 POST/DELETE 返回 403 |
| GET/POST | `/api/admin/dp-perm` | 管理员 | DP 权限列表 / 翻转 |
| GET | `/api/admin/my-dp-traffic` | 子账户 | DP 流量（`site/start/end/result/limit/page`） |

---

## 8. 前端说明

### 8.1 `admin.html`（2388 行单文件）

- **无框架、无构建**，原生 JS + 内联 CSS。全局状态 `S` 存 sessionStorage（登录 token、role、site、cloak_enabled、ab_enabled 等）。
- **主要功能函数**（从代码 grep 整理）：
  - 布局/导航：`buildNav`、`showDashboard`、`showAccounts`、`showPixels`、`showApk`、`showLanding`、`showClicks`、`showVisits`、`showLoginLogs`、`showRdlink`；
  - 斗篷：`showCloak`、`showCloakConfig`、`showCloakConfigQuery`、`showCloakDeploy`、`showCloakTraffic`、`openCloakRules`、`renderCloakRuleList`、`refreshCloakPerm`、`showCloakLocked`、`saveCloak`；
  - AB 页：`showAbConfig`、`showAbConfigQuery`、`showAbDeploy`、`showAbTraffic`、`openAbRules`、`renderAbBody`、`refreshAbPerm`、`showAbLocked`、`saveAbConfig`；
  - 账户：`loadAccounts`、`createAccount`、`saveEdit`、`deleteAccount`、`toggleAccount`、`toggleCloak`、`toggleAb`；
  - 短链：`showRdlink`、`loadRdDomains`、`loadRdLinks`、`loadRdLogs`、`openRdModal`、`saveRdLink`、`rdEdit`、`rdDel`、`rdToggle`；
  - 通用：`login`、`loadStats`、`loadPixels`、`loadApkData`、`loadClickLogs`、`loadVisits`、`loadCloak`、`loadAbConfig`、`uploadFile`、`copyText`、`msg`、`fmt8`、`fmtTime` 等。
- **导航结构**：Dashboard、像素管理、APK 下载、普通跳转、落地页斗篷设置、斗篷流量、AB 页+斗篷（AB页如何部署/AB页规则设置/AB页流量）、超强分流链接、账户管理、登录日志、访问统计、点击统计、落地页。
- **权限交互**：斗篷/AB 未开通时对应规则设置项置灰，点击弹不可关闭提示（`showCloakLocked`/`showAbLocked`）。

### 8.2 `index.html` / `1.html` / `redirect-script.html`

- `index.html`：公开落地页（467 行）。
- `1.html`：落地页/部署示例（1264 行，含大段部署说明文字）。
- `redirect-script.html`：短链中转页（读路径末尾 8 位 id → `location.replace(BACKEND + '/rd/' + id)`）。

### 8.3 守卫脚本

- `js/cloak.js`：斗篷守卫（点击拦截 + 行为采集 + WebRTC + 预检预热）。支持 `?debug=1` 或 `?cloak_debug=1` 调试。后端地址自动从 `currentScript.src` 取。
- `ab-ck.js`：AB 守卫（落地即判定 + WebRTC）。支持 `?ab_debug=1` 调试。

---

## 9. 部署与迁移

### 9.1 资源与绑定（`wrangler.toml`）

- KV 绑定 `kvadmin` = `b87ed28998314f2eaa12af96e47d7974`
- D1 绑定 `DB` = `streamflix-db`，database_id `da9473c1-8e1b-4470-be46-5e67b0c1c946`
- R2 绑定 `r2admin` = 桶 `admin`

### 9.2 建表 / 迁移脚本执行顺序

> 全部幂等（`CREATE TABLE IF NOT EXISTS` / `INSERT OR IGNORE` / `ON CONFLICT`），可重复执行。`ALTER` 类脚本**非幂等**（重复会报 `duplicate column name`），只跑一次。

| 顺序 | 脚本 | 作用 |
|---|---|---|
| 1 | `schema.sql` | 基础表（⚠️ 含冲突标记，不要直接整体执行，见 §11） |
| 2 | `cloak_schema.sql` | 斗篷 2 表 |
| 3 | `ab_schema.sql` | AB 斗篷 3 表 |
| 4 | `rd_schema.sql` | 短链 4 表 |
| 5 | `alter_cloak_perm.sql` | `accounts` 加 `cloak_enabled`（只跑一次） |
| 6 | `optimize_schema.sql` | 索引 + `stats_daily` 预聚合（本轮优化） |

**执行方式（二选一）**：

```bash
# 方式 A：wrangler CLI（需先 wrangler login）
wrangler d1 execute streamflix-db --remote --file <脚本.sql>
```

方式 B：Cloudflare Dashboard → D1 → `streamflix-db` → 控制台，把脚本内容贴进去逐段执行。

> 注意：Dashboard 控制台对**多段 `;` 分隔语句**支持良好，但不要用 `UNION ALL` 拼太多 `COUNT(*)`（曾报 `too many terms in compound SELECT`），改为逐条 `SELECT COUNT(*)`。

### 9.3 部署代码

```bash
# 纯静态 + Functions，无需构建
wrangler pages deploy . --branch main
# 或 Cloudflare Pages 连接 GitHub 自动部署（构建命令留空、输出目录留空）
```

### 9.4 首次上线清单

1. 建所有表（§9.2）；
2. 绑定 KV/D1/R2；
3. 管理员登录（`env.ADMIN_USER/ADMIN_PASS`）；
4. 创建子账户并绑定落地页站点；
5. 子账户配像素 / APK / 斗篷 / AB / 短链；
6. 落地页接入 `js/cloak.js`，A 页接入 `ab-ck.js`。

---

## 10. 数据库优化方案（本轮迭代）

### 10.1 问题

D1 免费额度「已读取行 5M/天」被击穿到 326M，根因：

1. `COUNT(*)` 在 `visit_logs`/`click_logs` 等**只增日志表**上每次 Dashboard 加载都全表扫；
2. `click_logs` **全库无任何索引**；
3. `schema.sql` 有 merge 冲突，`visit_logs` 索引存在性存疑；
4. OFFSET 深分页；
5. `pixels.js`/`apk-url.js` 里的 `site_mappings` 全表兜底扫描（小表，风险低）。

### 10.2 方案

- **P0 索引**：`idx_click_logs_user_time(username, click_time)`、`idx_visit_logs_user_time(username, visit_time)`。
- **P1 预聚合表 `stats_daily`**：
  - **写**：日志写入后，用独立 `context.waitUntil` 做 `INSERT ... ON CONFLICT(username,date) DO UPDATE SET col = col + 1`（独立 `catch`，保证 `stats_daily` 未建表也不影响日志主写入）；
  - **读**：总数改成 `SELECT COALESCE(SUM(visits),0)`，O(1)；
  - **回退**：读侧 `try/catch`，`stats_daily` 缺失时自动回退原 `COUNT(*)`。
- 覆盖四类统计：访问(`visits`)、点击(`clicks`)、斗篷流量(`cloak_total/cloak_pass`)、AB 流量(`ab_total/ab_pass`)。fail = total - pass。

### 10.3 改动文件

| 文件 | 改动 |
|---|---|
| `optimize_schema.sql` | 新增，索引 + 建表 + 4 类回填 |
| `functions/api/pixels.js` | 访问日志后 + `stats_daily.visits` |
| `functions/api/dl.js`、`rd.js` | 点击后 + `stats_daily.clicks` |
| `functions/api/cloak.js`、`ab-cloak.js` | 流量后 + `stats_daily.cloak_*/ab_*` |
| `functions/api/admin/my-stats.js` | 访问量读 SUM |
| `functions/api/admin/my-visit-logs.js`、`my-click-logs.js` | 总数读 SUM（无筛选时） |
| `functions/api/admin/my-cloak-traffic.js`、`my-ab-traffic.js` | 总数读 SUM（无 site/a_url+date 筛选时） |

### 10.4 已评估但暂缓

| 项 | 暂缓原因 |
|---|---|
| keyset（游标）分页替代 OFFSET | 需改前端 |
| 去掉 `site_mappings` 全表兜底扫描 | 表小 + 去掉有 hostname 匹配回归风险 |
| KV 服务端缓存 | 失效复杂度高 |
| 冷归档旧日志 | 有数据丢失风险 |

---

## 11. 已知问题与注意事项

1. **`schema.sql` 含未解决的 git 冲突标记**（`<<<<<<< HEAD` / `=======` / `>>>>>>>`）。**不要编辑它**，也不要整体执行。受影响：
   - `accounts` 是否含 `pixel_ids/apk_url/apk_history/config_version` 取决于线上实际建表版本；
   - `download_counts` 主键是 `(username, date, site)` 还是 `(username, date)` 不确定；
   - `login_logs`/`account_sites`/`visit_logs` 表定义只在 HEAD 分支里。
   - 建议用独立迁移脚本（如 `optimize_schema.sql`）补结构，不要动 `schema.sql`。
2. **`click_logs` 在仓库里没有建表语句**（线上手动建的，列 = `username, site, click_time, ip, device, lang, user_agent`）。若换环境重建，需手动补建。
3. **`accounts.status` 列**在代码里用到（`toggle-status`），但 `schema.sql` 未声明——线上可能也是手动加的。
4. **`IPINFO_TOKEN` / `IPAPI_KEY` 是付费 key**，勿进公开仓库；`IPINFO_TOKEN` 当前为空（退化为免费接口）。
5. **`CF_API_TOKEN` 已失效**（`user/tokens/verify` 返回 `Invalid API Token`），且代码未实际调用它。
6. **`rd_domains` 表未被使用**：短链跳转域名来自 `my-rdlink.js` 顶部硬编码 `RD_DOMAINS` 数组。加域名要改代码重部署。
7. **AB 页 `evaluateRules` 保留了 behavior 分支代码**，但 AB 页面 UI 不启用行为模块（落地即跳无行为信号），属于预留逻辑。
8. **鉴权信任 token 里的 role**：子账户 `getMyUser` 不查库校验 role，只靠「密码比对」。若担心越权，可在 `getMyUser` 里强制校验 `role === 'user'`。
9. **多站点匹配逻辑重复**：`pixels.js`/`apk-url.js`/`cloak.js`/`ab-cloak.js` 各自实现了一套「站点多级匹配」，逻辑相近但分散，改动需同步。
10. **`okonline/` 是遗留副本**，`es/` 是独立落地页，均非当前项目主线，勿误改。

---

## 12. 后续优化方向

1. **分页改造**：OFFSET → keyset 游标分页（`WHERE id < last_id ORDER BY id DESC LIMIT n`），彻底消除深分页扫描。
2. **日志冷归档**：把 N 个月前的 `visit_logs`/`click_logs`/`cloak_traffic`/`ab_traffic`/`rd_logs` 归档到单独表或导出，控制热表体积。
3. **服务端缓存**：给 `my-stats` 等高频读加 KV 短缓存（如 60s），进一步降 D1 读。
4. **统一站点匹配**：抽一个共享的 `resolveSite(env, rawSite)` 工具函数，消除四处重复。
5. **`schema.sql` 冲突修复**：另起一个干净的 `schema_full.sql`，把真实线上结构固化下来，废弃带冲突的 `schema.sql`。
6. **补齐缺失 DDL**：补 `click_logs`、`accounts.status` 的正式建表/迁移语句。
7. **鉴权加固**：子账户接口强制校验 role；把老接口统一到 D1 版 `checkAdmin`。
8. **短链域名配置化**：把 `RD_DOMAINS` 硬编码数组改成读 `rd_domains` 表 + 管理员可配置。
9. **监控告警**：接入 D1 用量监控，避免再次击穿免费额度。

---

## 13. 更新日志（2026-08-19 之后）

> 按功能记录自 2026-08-19 文档之后到 2026-09-10 的变更。每条含涉及文件 / 表 / 迁移脚本，便于回溯。

### 13.1 DP 配置（DP 分流）模块 —— 全新功能

- **新增数据表**（`dp_schema.sql` + `alter_dp_configs.sql` + `alter_dp_perm.sql`）：
  - `dp_configs`（落地页 DP 配置，后加 `remark`、`seq` 列）
  - `dp_traffic`（DP 流量日志）
  - `dp_permissions`（DP 权限，默认关闭）
- **新增接口**：
  - 公开 `POST /api/dp`（`functions/api/dp.js`）
  - 子账户 `GET/POST/DELETE /api/admin/my-dp`（`functions/api/admin/my-dp.js`）
  - 管理员 `GET/POST /api/admin/dp-perm`（`functions/api/admin/dp-perm.js`）
  - 子账户 `GET /api/admin/my-dp-traffic`（`functions/api/admin/my-dp-traffic.js`）
- **守卫脚本**：`js/dp-ck.js`（落地页 `<head>` 加载即判定）。
- **前端**：`admin.html` 新增 `showDpConfig()`（基础设置/爬虫屏蔽/设备环境）、`showDpConfigQuery()`（DP 配置查询）、DP 权限导航门控。
- **落地页无限域名**：`DP_LANDING_PREFIX` 硬编码 3 域名 `https://snk622ma.site/abwx` / `https://amh626m.site/abwx` / `https://hte629d.site/abwx`（`[vars]` 在 GitHub 部署的 Pages 上不生效，故写死在 `my-dp.js`）。
- **迁移命令**：依次执行 `dp_schema.sql` → `alter_dp_configs.sql` → `alter_dp_perm.sql`。

### 13.2 DP 权限管理

- 新增 `dp_permissions` 表 + `/api/admin/dp-perm` 端点（镜像 `ab-perm`）。
- 默认关闭，仅 `xifeng666` 开通（`alter_dp_perm.sql` 内置 INSERT）。
- `my-dp.js` 的 POST/DELETE 加 `dp_enabled` 门控（`403 DP_DISABLED`）。
- `admin.html` 账户表新增「DP 权限」列 + `toggleDp()`；子账户 DP 未开通时导航置灰 + `showDpLocked()`。

### 13.3 DP 配置查询搜索

- `showDpConfigQuery()` 支持按落地页地址（完整 URL / 域名 `snk622ma.site` / 后缀 `abmka`）+ 备注搜索（前端子串过滤，大小写不敏感）。

### 13.4 DP 查询规则显示优化（2026-09-09）

- `describeDpRules()` 中「设备语言」「地区时区」按 `mode` 区分显示：「语言允许/语言屏蔽」「时区允许/时区屏蔽」（此前写死「屏蔽」）。

### 13.5 地区时区输入校验（2026-09-10）

- `saveDpConfig()` 增加时区校验：仅允许 UTC 偏移格式 `+8`/`-5`/`+5.5`/`0`，非法时阻止保存并提示正确示范；同步更新输入框 placeholder。

### 13.6 FB 转化事件多选

- 新增 `account_sites.fb_events` 列（`alter_fb_events.sql`，默认全选 6 事件，含回填 UPDATE，**无需手动批量更新**）。
- `functions/api/pixels.js` 返回 `events`（列缺失回退全选）。
- `functions/api/admin/my-pixels.js` GET/POST 支持 `events`（POST 传 `events` 才覆盖，否则保留）。
- `js/meetu-sdk.js` 下载时按 `_events` 循环触发（`Download` 走 `trackCustom`，其余 `track`）。
- `admin.html` 像素管理页新增「转化事件」多选框卡片（`renderFbEvents`/`saveFbEvents`），按落地页隔离。

### 13.7 后台 UI 微调（2026-09-08 ~ 09-10）

- 转化事件卡片上移到「像素列表」之前（更显眼）。
- 「保存事件」成功增加 `alert('✅ 保存成功')` 弹窗。

### 13.8 站点识别修复：根域名不再误匹配子路径站点（2026-09-26）

- **问题**：`pixels.js` / `apk-url.js` 的站点反解在精确匹配失败后，走「hostname-only 兜底」（只比 hostname 不看路径），导致根域名 `https://tsc921y.site` 在 `site_mappings` 无精确命中时，误匹配到同域名的子路径站点（如 `/bttv/`、`/volttv/`），返回了别人的像素 ID / 跳转地址。
- **修复**：新增 `hostPath()` 解析函数（把站点拆成 `[hostname, pathname]`，末尾斜杠归一化），把兜底匹配收紧为「hostname + pathname 都一致」。根域名只匹配根站点，不再跨到子路径站点。
- **涉及文件**：`functions/api/pixels.js`、`functions/api/apk-url.js`。
- **范围**：grep 确认该 hostname-only 兜底仅存在于这两个文件；`cloak.js` / `ab-cloak.js` / `dp.js` 的 `.hostname` 均为提取 hostname 字符串，无此误匹配逻辑。
- **生效方式**：Pages Functions，需重新 `wrangler pages deploy . --branch main`。

---

## 附：快速上手（5 分钟）

```bash
# 1. 看配置
cat wrangler.toml

# 2. 建表（Cloudflare Dashboard D1 控制台执行 optimize_schema.sql 及其它 *.sql）

# 3. 部署
wrangler pages deploy . --branch main

# 4. 打开后台
open https://url.yuhd320k.site/admin.html
```

**改一个功能的常见路径**：`admin.html`（前端 UI）→ 对应 `functions/api/admin/*.js`（后端接口）→ 若涉及数据，新增独立 `.sql` 迁移脚本（不要动 `schema.sql`）。
