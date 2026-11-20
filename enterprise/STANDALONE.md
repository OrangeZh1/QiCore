# QiCore 安装与运行

QiCore 包含管理后台、Node API、H5 客户端和应用 SDK，一个实例运行一个站点。原始导入版本、范围和校验见 [UPSTREAM.json](UPSTREAM.json)。后台不显示平台侧的租户列表、选站、代登录或「框架与应用」。`/admin` 和 `/login` 兼容入口进入管理后台。访问者、后台管理员、消费者及应用插件使用各自的身份与权限。

## 开发预览

安装根工作区锁定依赖后，在此目录启动本机开发服务。该入口使用独立的 MySQL / Redis 数据、安装状态和登录会话。

```sh
pnpm install --frozen-lockfile
node scripts/development/run.mjs --port 3700 --state /path/to/local/enterprise-dev
```

工作台在 `http://127.0.0.1:3700/admin/workbench`。本地管理员凭据保存在该实例的 `admin/admin-bootstrap.json`。空库首次启动时创建本站记录。服务端依据数据库中的站点 ID 校验当前会话、数据归属和操作权限。对外后台页以 `/admin` 开头；旧 SaaS 的 `/tenant` 前缀在单开实例返回 404。停止该工作区使用 `node scripts/development/stop.mjs /path/to/local/enterprise-dev`。

| 功能 | 常用页面 |
| --- | --- |
| 消费者、会员与积分 | `/admin/users`、`/admin/member-levels`、`/admin/member-tags`、`/admin/points-ledger` |
| 交易、充值、服务权益 | `/admin/transactions`、`/admin/recharge-orders`、`/admin/recharge`、`/admin/packages`、`/admin/entitlements`、`/admin/entitlement-ledger` |
| 支付 | `/admin/payments`，微信支付页含虚拟支付配置页签 |
| 消息 | `/admin/sms`、`/admin/subscriptions`、`/admin/notifications`、`/admin/message-records` |
| 渠道与装修 | `/admin/mini-program`、`/admin/official-account`、`/admin/h5`、`/admin/decoration` |
| 系统维护（按角色逐项授权） | `/admin/system-logs`、`/admin/environment`、`/admin/scheduled-tasks`、`/admin/system-cache`、`/admin/data-security` |
| 权限、资料和公共配置 | `/admin/administrators`、`/admin/roles`、`/admin/profile`、`/admin/materials`、`/admin/site`、`/admin/storage` |

## 免费源码实例初始化

使用 Node.js 24、MySQL 8 和 Redis。先执行 `pnpm db:generate` 和 `pnpm build`。在服务器为该实例准备一个专用空数据库、独立 Redis 配置和仅管理进程可写的持久目录。

`pnpm install:source` 从环境读取以下参数。

| 参数 | 用途 |
| --- | --- |
| `DATABASE_URL` | 专用 MySQL 连接。迁移由 Prisma 按工作区历史执行 |
| `STANDALONE_STATE_ROOT` | 安装尝试与完成回执的绝对目录 |
| `STANDALONE_ADMIN_USERNAME` | 首位管理员的登录名 |
| `STANDALONE_ADMIN_PASSWORD_FILE` | 操作员提供的私有密码文件，密码至少 12 个字符 |
| `STANDALONE_ADMIN_NAME` | 可选，初始管理员的显示名称 |

安装器核验空库或本次可恢复的安装尝试，按数据库获取互斥锁，在同一事务中登记首位管理员、站点和授权范围，再核验数据库归属并写入回执。相同状态目录和凭据可用于核验和恢复。生产启动使用编译后的 `apps/api/dist/main.js` 和 `apps/admin/.output/server/index.mjs`。API 按服务配置连接 `DATABASE_URL` 和 `REDIS_URL`，以 `ADMIN_ORIGIN` 为对外后台来源，Nuxt 的 `NUXT_API_INTERNAL_BASE` 指向同机 API 的 `/api/v1`。服务账号、存储文件、加密密钥及备份目录均应按实例分别配置。生产反向代理使用 HTTPS。

兼容宿主的 `qc_accounts` / `qc_sessions` 与这里的管理员模型有不同的归属关系。将已有客户实例换成此版本，需要另行对账和演练数据迁移；开发服务器使用独立库。

## 商业主应用及功能插件

零应用时框架不需要商业产品身份。商业整包必须包含唯一主应用；每个功能插件的标识、命名空间及归属均须匹配。主应用与插件的运行权益分别由真实签名回执验证。

生产整包通过 `QICORE_STANDALONE_PRODUCT_FILE` 指定受信公开产品配置，`QICORE_STANDALONE_BUNDLE_ROOT` 指定实际代码槽，`QICORE_STANDALONE_RELEASE_FILE` 指定对应签名发行记录。产品身份是当前商业主应用的 APP / STANDALONE / ARCHIVE，主应用版本与整个产品版本一致。制作、安装及更新应通过该产品的受信交付助手，保留活跃和上一已知可用版本以及恢复引用。开发环境使用独立的回环测试身份；开发签名和验收材料不用于客户发行。
