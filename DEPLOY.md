# StreamFlix — 部署指南（GitHub → Cloudflare Pages）

## 架构说明

```
用户访问 index.html
  └─ 点击任意下载按钮 → k2()
       └─ fetch('/api/apk-url') → 从 KV 读取最新的 APK 下载地址
            └─ 跳转到 APK 下载链接

管理员访问 /admin.html
  └─ 登录 (admin / 123456)
       └─ 选择 APK 文件 → 上传
            └─ POST /api/admin/upload → 存入 R2 → URL 写入 KV
```

## 第一步：Cloudflare 后台配置

### 1.1 创建 R2 存储桶
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单 → **R2** → **创建存储桶**
3. 名称填 `apk-bucket`，点击创建
4. **设置 → 公开访问** → 开启 **R2.dev 子域**（或绑定自定义域名如 `apk.tudominio.com`）
5. 记下公开访问 URL，例如 `https://pub-xxx.r2.dev`

### 1.2 创建 KV 命名空间
1. 左侧菜单 → **Workers & Pages** → **KV** → **创建命名空间**
2. 名称填 `APK_STORE`，点击创建
3. 记下生成的 **命名空间 ID**（一串十六进制字符）

## 第二步：修改项目配置

### 2.1 更新 `wrangler.toml`
```toml
[[kv_namespaces]]
binding = "APK_STORE"
id = "你刚才记下的KV命名空间ID"      # ← 改这里

[[r2_buckets]]
binding = "APK_BUCKET"
bucket_name = "apk-bucket"          # ← 确认桶名一致
```

### 2.2 更新 R2 公开访问 URL
编辑 `functions/api/admin/upload.js` 第 47 行：
```js
const publicUrl = `https://pub-xxx.r2.dev/${key}`;  // ← 改成你的 R2 公开域名
```

## 第三步：部署到 Cloudflare Pages

### 方式 A：GitHub 自动部署（推荐）
1. Cloudflare 面板 → **Workers & Pages** → **创建** → **Pages**
2. 连接你的 GitHub 仓库
3. 构建设置：
   - **构建命令**：留空（纯静态 + Functions）
   - **输出目录**：留空（根目录）
4. 部署后，CF 自动给一个 `*.pages.dev` 域名

### 方式 B：命令行部署
```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录
wrangler login

# 部署
wrangler pages deploy . --branch main
```

## 第四步：绑定 KV 和 R2

部署完成后，在 Cloudflare Pages 项目设置中：
1. **设置 → Functions → KV 命名空间绑定**
   - 变量名：`APK_STORE`，选择你创建的 KV 命名空间
2. **设置 → Functions → R2 存储桶绑定**
   - 变量名：`APK_BUCKET`，选择 `apk-bucket`

## 使用流程

1. 打开 `https://你的域名/admin.html`
2. 登录：账号 `admin`，密码 `123456`
3. 选择 `.apk` 文件上传
4. 上传成功后，前端自动获取最新 APK 地址
5. 用户点击任意下载按钮即可跳转到最新 APK

## 文件清单

```
├── index.html              # 前端页面
├── admin.html              # 后台管理页面
├── functions/
│   └── api/
│       ├── apk-url.js      # GET — 返回最新APK URL
│       └── admin/
│           └── upload.js   # POST — 上传APK（需认证）
├── wrangler.toml           # CF Pages 配置
├── img/                    # 图片资源
└── DEPLOY.md               # 本文档
```
