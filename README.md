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

只有在需要改代码时才需要本地环境（要求 Node.js 24+）。日常部署不需要本地做任何事。

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

## 部署：GitHub → Cloudflare Workers → 自动更新

这个项目使用 **Workers Builds** 连接 GitHub。第一次配置完成后，推送到生产分支就会自动构建和部署；数据库在控制台自行创建；无需在本地登录 Cloudflare 或执行建表命令。

### 1. 连接 GitHub 仓库

把代码上传到 GitHub，先创建 Worker 和 D1，并按下一节完成 `DB` 绑定。在 **该 Worker → Settings → Builds** 连接 GitHub 仓库，填写：

| 配置项 | 值 |
| --- | --- |
| Worker name | `wordnest-cloudflare`，与 `wrangler.jsonc` 的 `name` 一致 |
| Production branch | `main`，或你实际使用的生产分支 |
| Build command | `npm run build` |
| Deploy command | `npm run deploy:ci` |
| Root directory | 仓库根目录，留空 |
| Build variables / secrets | 无需填写 `SESSION_SECRET`，它是运行时密钥 |
| Node.js | 仓库中的 `.node-version` 已指定为 `24` |

保留自动部署生产分支的设置。部署前必须先在该 Worker 绑定你自己创建的 D1，变量名为 `DB`。尚未配置 `SESSION_SECRET` 时应用会显示配置提示。

`deploy:ci` 通过 `scripts/deploy.mjs` 读取构建生成的 `dist/server/wrangler.json`，生成只继承已有 D1 绑定的部署配置。保持部署命令为 `npm run deploy:ci`；直接使用裸 `wrangler deploy` 会绕过禁止建库的处理。

### 2. 在控制台选择 D1 数据库，无需填写 ID

代码只声明数据库绑定名：

```json
"d1_databases": [{ "binding": "DB" }]
```

进入 **该 Worker → Bindings → Add binding → D1 database**：

- Variable name 必须填 **`DB`**，大小写一致。
- 从下拉框选择你创建的 D1 数据库。数据库名称可以自定义。
- 保存并部署绑定变更。

如果 Worker 已有 `DB` 绑定，后续 GitHub 自动部署会沿用这个绑定。仓库没有固定数据库名称或 ID，不需要把控制台的数据库 ID 复制回代码。

**不会自动创建数据库。** 部署脚本把构建中的 D1 声明转换为继承已有 `DB` 绑定，并关闭 Wrangler 资源自动创建。没有已有 `DB` 绑定时，部署会报错，不会新建数据库。

新项目请先在控制台创建 Worker（可以使用 Hello World 占位），自己创建或导入 D1 数据库，在这个 Worker 的 Bindings 中绑定为 `DB` 并保存/部署绑定，再通过该 Worker 的 Settings → Builds 连接 GitHub。已有 Worker 则直接更换 `DB` 绑定到你自己选择的数据库。

数据库可以任意命名，不需要把数据库 ID 写回仓库；迁移时在控制台导入数据后，将 `DB` 改绑到目标数据库即可。

应用在首次访问数据库时自动创建表；以后沿用同一个数据库，常规代码更新不会重建数据库或清空词表。

> 如果已经使用过这个项目，选择当前保存数据的数据库。切换到一个新的空数据库会看到全新的初始化页面，旧数据仍在原数据库中。

### 3. 配置运行时密钥

进入 **该 Worker → Settings → Variables and Secrets → Add**：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `SESSION_SECRET` | Secret | 安全随机生成的至少 32 字节密钥，例如 64 位十六进制字符串 |

保存并部署密钥变更，刷新站点，创建首位管理员账号。不要把它放在 **Build Variables and Secrets**，构建期变量不会自动变成运行时密钥；不要把真实密钥提交到 GitHub。

每位用户的 AI Base URL、模型和 API Key 在站点「设置」里填写，无需统一配置到 Cloudflare。

仓库已设置 `keep_vars: true`，后续部署会保留控制台添加的普通运行时变量；Wrangler 默认也会保留已设置的 Secret。请保持 `SESSION_SECRET` 稳定，它还用于加密用户 AI Key。

### 4. 后续更新

更新代码并推送到选定的生产分支后，Cloudflare 会自动拉取仓库、安装依赖、构建并部署。无需再次填写数据库 ID、重新绑定数据库或重复设置密钥。

在 **Worker → Builds** 查看每次构建状态和失败日志，在 **Deployments** 查看生产部署版本。

建议初期只启用生产分支构建。现有 `npm run deploy:preview` 同样禁止自动建库，使用 `wrangler versions upload`，是版本预览，沿用 Worker 的数据库绑定，并不创建隔离的测试数据库。如果需要测试环境，应另建 Worker/D1 后再启用。

### 可选：本地手动部署与验证

```bash
npx wrangler login
npm run deploy          # 先构建，再部署生成的 Worker
```

只检查构建和打包、不部署：

```bash
npm run build
npm run deploy:check
```

检查不代表账号权限、线上 D1 绑定和运行时 Secret 已配置正确。

相关官方说明：[Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[控制台绑定 D1](https://developers.cloudflare.com/d1/get-started/#3-bind-your-worker-to-your-d1-database)。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | vinext 开发服务器（HMR） |
| `npm run build` | 构建 Worker 产物到 `dist/` |
| `npm run start` | 用本地 D1 预览构建产物 |
| `npm run deploy` | 构建并部署到 Cloudflare Workers |
| `npm run deploy:ci` | 部署构建产物，继承已有 DB，禁止自动建库 |
| `npm run deploy:preview` | 上传预览版本（非生产分支用） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run types` | 根据 Wrangler 配置生成绑定类型 |
| `npm run deploy:check` | 检查构建产物打包，不部署到线上 |
| `npm test` | 回归测试 |

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
- **密码哈希强度与 CPU 预算**：`lib/auth.ts` 里 PBKDF2 迭代次数设为 30,000。Workers Free 每个请求只有
  10ms CPU 预算，而 150,000 次迭代实测约 20ms，会导致注册/登录直接失败。迭代次数写在每个哈希里，
  所以以后调高不影响已有密码；如果升级到 Workers Paid（5 分钟 CPU），可以放心改回 150,000。
- 知识图谱关系缓存 30 天，可在图谱页点「重新生成」强制刷新。
- 图表现为自绘 SVG；如需拖拽、缩放等交互，可换用 React Flow。
- 预览部署（非生产分支）与生产环境共用同一个 D1 绑定，会读写同一份数据；如需隔离，可另建数据库并用 `wrangler` 的 `env` 配置分开。
- 表结构由应用自动创建（见 `lib/schema.ts`），改动 schema 时在数组末尾追加一个新版本即可，已有部署会就地升级。
- 不含原 Flask 版本的历史数据；如需导入旧 `instance/*.db`，需要另写一次导入脚本。

## 安全修复与升级说明

- 会话签名绑定当前密码哈希，管理员重置密码后，旧登录会立即失效。升级到此版本后，已有用户需要重新登录一次。
- AI Base URL 必须使用 HTTPS，支持自定义路径和完整 `/chat/completions` 地址；不接受内嵌账号、查询参数或片段，也不跟随重定向。普通请求超时为 60 秒，流式请求为 180 秒。
- AI Key 使用 AES-GCM 加密后存入 D1，加密密钥由 `SESSION_SECRET` 派生，密文绑定用户 ID。历史明文密钥在读取或保存设置时自动升级。
- 请妥善备份 `SESSION_SECRET`。更换它会使所有会话失效，已有加密 AI Key 也将无法解密，需要用户重新填写；更换前应规划密钥重新录入。
- `npm test`（需要 Node.js 22.13+ 或 24）执行回归测试，覆盖会话撤销、初始化竞争、保存回滚、密钥保护和 AI 地址校验。数据库测试使用 SQLite，不能替代部署环境的端到端验证。
