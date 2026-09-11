# WordNest (Cloudflare Workers)

多用户英语单词学习平台，运行在 Cloudflare Workers 上。全栈 Next.js（App Router + RSC）由
[vinext](https://github.com/cloudflare/vinext) 构建，数据存在 D1，无服务器常驻。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js App Router / RSC，通过 vinext 跑在 Workers 上 |
| 样式 | Tailwind CSS v4 |
| 数据 | Cloudflare D1（SQLite 语义） |
| 鉴权 | 自建账号体系，PBKDF2 密码哈希 + HMAC 签名的会话 Cookie |
| AI | 每位用户自带 OpenAI 兼容接口（Base URL / 模型 / API Key） |
| 可观测性 | Workers Logs + Traces（已在 `wrangler.jsonc` 开启） |

## 功能

- **账号体系**：首位注册者自动成为管理员；之后的新用户由管理员在「用户」页创建，可调整角色与启用状态、重置密码、删除账号。
- **多词表**：每个用户拥有独立的词表集合，可创建、重命名、删除、切换。
- **单词管理**：多词性/多释义，含例句与学习笔记；支持搜索、标注、字母排序、CSV 导出。
- **单词练习**：随机抽查、释义揭示、仅抽查已标注词、浏览器朗读发音、键盘快捷键（空格 / → / M）。
- **AI 生成**：一键填充整词信息，或按释义单独生成例句、学习笔记。
- **知识图谱**：AI 生成同义/反义/相关/主题关系，SVG 径向图展示，结果在 D1 缓存 30 天。
- **AI 助教**：流式对话，自动携带当前词表内容，会话历史持久化。
- **深色模式**：跟随系统并记住选择。

## 本地开发

只有在需要改代码时才需要本地环境（要求 Node.js 20+）。日常部署不需要本地做任何事。

```bash
npm install
cp .dev.vars.example .dev.vars   # 并填入一个随机 SESSION_SECRET
npm run dev                      # 开发服务器（HMR）
```

打开 http://localhost:3000 ，首次访问会引导创建管理员账号。表结构由应用在首次请求时
自动创建，本地和线上都是如此，没有单独的迁移步骤。

生产构建的本地预览：

```bash
npm run build
npm run start                    # http://localhost:8787
```

> **注意**：`wrangler dev` 的 `--persist-to` 是相对于**配置文件所在目录**解析的，
> 而构建产物在 `dist/server/`。`npm run start` 已经用绝对路径把两个命令的本地 D1
> 指向同一处（`.wrangler/state`），请勿去掉该参数，否则会出现「表不存在」的错误。

## 部署：在 Cloudflare 连接 GitHub 即可

这个项目就是按"连上仓库就能跑"来配置的：**不需要在本地克隆、建库或执行任何迁移命令**。
数据库会在首次部署时自动创建，表结构由应用在第一次收到请求时建好。

1. 把仓库推送到 GitHub。
2. Cloudflare 控制台 → **Workers & Pages → Create application → Import a repository**，
   选中该仓库。
3. 按下表填写构建配置：

| 字段 | 填入 |
| --- | --- |
| Worker name | `wordnest-cloudflare`（**必须**与 `wrangler.jsonc` 里的 `name` 完全一致，否则构建会失败） |
| Git branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy:ci` |
| Non-production deploy command | `npm run deploy:preview`（只在你启用「非生产分支构建」时才需要改） |
| Root directory | 留空 |
| Build variables / secrets | 不需要（构建期变量在运行时不可见，别把 `SESSION_SECRET` 放这里） |

4. **Save and Deploy**。首次部署会自动创建并绑定 D1 数据库（`wrangler.jsonc` 中刻意没写
   `database_id`，交给 Cloudflare 自动配置）。
5. 部署完成后添加运行时密钥：**该 Worker → Settings → Variables and Secrets → 添加
   `SESSION_SECRET`**，类型选 **Secret**，值用 `openssl rand -hex 32` 生成的随机串。
   在没有设置它之前，站点会显示一条明确的配置提示，而不是报错。
6. 打开 Worker 的 `*.workers.dev` 地址，创建第一个管理员账号，即可开始使用。

之后每次 push 到 `main`，Cloudflare 都会自动重新构建并部署。

> **部署命令为什么要带 `--config`**：根目录 `wrangler.jsonc` 里的 `main` 指向 vinext 的
> 开发入口，用默认的 `npx wrangler deploy` 会部署出一个空壳 Worker。`npm run deploy:ci`
> 已经是 `wrangler deploy --config dist/server/wrangler.json`，请不要改成裸的 `npx wrangler deploy`。

### 可选：本地手动部署

```bash
npx wrangler login
npm run deploy         # 构建并部署
```

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | vinext 开发服务器（HMR） |
| `npm run build` | 构建 Worker 产物到 `dist/` |
| `npm run start` | 用本地 D1 预览构建产物 |
| `npm run deploy` | 构建并部署到 Cloudflare Workers |
| `npm run deploy:ci` | 仅部署构建产物（Workers Builds 的 Deploy command 用这个） |
| `npm run deploy:preview` | 上传预览版本（非生产分支用） |
| `npm run typecheck` | TypeScript 类型检查 |

## 目录结构

```
app/
  (app)/            登录后的页面：练习、词表、图谱、助教、设置、用户管理
  actions/          Server Actions（认证、单词、词表、设置、用户管理）
  api/              Route Handlers（抽查、AI 生成、流式对话、图谱、导出）
  login/            登录 / 初始化
components/         客户端组件
lib/                数据访问、认证、AI 客户端、校验
  schema.ts         表结构定义（应用首次请求时自动应用）
```

## 已知边界

- AI 相关功能（生成、图谱、助教）需要用户先在「设置」中填写自己的模型接口，否则返回明确的配置提示。
- 知识图谱关系缓存 30 天，可在图谱页点「重新生成」强制刷新。
- 图表现为自绘 SVG；如需拖拽、缩放等交互，可换用 React Flow。
- 预览部署（非生产分支）与生产环境共用同一个 D1 绑定，会读写同一份数据；如需隔离，可另建数据库并用 `wrangler` 的 `env` 配置分开。
- 表结构由应用自动创建（见 `lib/schema.ts`），改动 schema 时在数组末尾追加一个新版本即可，已有部署会就地升级。
- 不含原 Flask 版本的历史数据；如需导入旧 `instance/*.db`，需要另写一次导入脚本。
