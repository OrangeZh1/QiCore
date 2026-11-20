# QiCore 启承单开框架

QiCore 单开版以 [MIT 许可证](LICENSE)开源。随源码分发的第三方组件、图标和素材沿用各自附带的许可声明。

QiCore 为单个独立站点提供登录会话、角色权限、后台布局、私有文件存储、网页安装向导和应用接入 SDK。一个实例使用一个 MySQL 8 数据库。框架可以独立运行，开源部分无需商业授权。后台以 Nuxt UI 接入 Iconify，常用 Lucide 图标随程序交付。

## 单开版主线

单开版在 [enterprise](enterprise/README.md) 中维护。它以 QiCore-SaaS 的企业端为基线，包含原 Nuxt 企业后台、NestJS API、H5 公共客户端、SDK、资源和相互匹配的构建工具。一个独立实例运行一个站点，支持一个商业主应用和该应用的功能插件。纯框架免费。商业主应用、插件与框架按受信产品清单装配并整包升级。

在项目根目录运行 `pnpm enterprise:prepare` 安装单开版工作区的锁定依赖。开发机准备 Node.js 24、MySQL 8 和 Redis 后，以 `pnpm dev` 启动本机 3700 的开发实例，重启沿用 `.local/enterprise-preview-3700`，开发登录资料位于该目录的 `admin/admin-bootstrap.json`。用 `pnpm dev:stop` 停止该开发实例。后台登录页为 `/admin/login`。登录后从「用户管理 → 用户列表」进入消费者目录，后台操作员位于「权限管理 → 管理员」。金融账户、支付渠道及真实外部服务使用各自的授权和配置。运行、安装与兼容边界见[单开工程说明](enterprise/STANDALONE.md)。

以下是兼容既有应用的 `@qicore/standalone` 宿主说明。既有客户实例有自己的迁移历史，迁入单开版主线前应在隔离副本上核对账号、角色、客户和附件归属。

## 兼容宿主的启动与安装

准备 Node.js 24、pnpm 11 和实例的专用空数据库。克隆源码后运行 `pnpm install --frozen-lockfile` 和 `pnpm db:generate`。Linux 生产运行目标为 x64。API 默认绑定 127.0.0.1:3401，Nuxt 开发服务器默认监听 3000。后台与 API 在同一来源提供服务。生产入口使用 HTTPS，`PUBLIC_ORIGIN` 设置为用户实际访问的完整站点来源。

1. 在服务环境中设置 `INSTANCE_ROOT` 为独立可写的持久化目录，以同一运行用户启动服务。开发默认使用当前目录下的 `.local/instance`。
2. 在一个终端运行 `pnpm dev:api`，另一个终端运行 `pnpm dev:web`。将 API 和 Nuxt 绑定不同端口时，在前端进程设置 `NUXT_API_ORIGIN` 为 API 的回环地址。
3. 在与 API 相同的实例配置下执行 `pnpm install:link`，从本机终端打开一次性安装链接。链接片段携带安装凭据，页面读取后会清除地址栏中的片段。安装链接属于实例管理凭据。
4. 在向导中填写 MySQL 连接地址、管理员登录名和密码。账号密码内的保留字符要进行 URL 编码。提交后执行不可变数据库迁移，创建管理员，确认宿主可启动，再提交安装回执。浏览器随后进入登录页。

在同一数据库内已经通过 `pnpm db:migrate` 和 `pnpm admin:create` 初始化过本框架时，使用原启用管理员的账号和密码通过向导接入。安装中断后，重新打开原向导并填写同一数据库与同一管理员资料。数据库迁移若已被 MySQL 标记为失败，需要先核对并修复该迁移。安装完成后，同一实例不接受再次初始化。迁移历史、账号、实例回执和数据文件应纳入实例的独立备份。

## 框架后台

纯框架首页显示来自当前实例的账号、角色和应用统计。顶部账号菜单进入个人资料，可修改显示名称，或验证当前密码后更改密码。更改或重置密码会撤销该账号此前的登录会话。

| 页面 | 用途 |
| --- | --- |
| `/admin/accounts` | 分页查询账号、开通账号、编辑角色与姓名、启停账号及重置密码 |
| `/admin/roles` | 查看角色及成员数，创建角色并分配框架或应用声明的权限 |
| `/admin/profile` | 当前账号的个人资料与密码 |
| `/` | 工作台与当前账号已授权的应用入口 |

系统管理员负责账号和角色的写操作。可向其他角色授予 `core.accounts.read` 或 `core.roles.read` 以分别查看账号或角色目录。服务端按每次请求的当前权限返回工作台统计和目录数据。原有角色和会话表可直接使用。

## 分离应用

应用声明菜单、权限及 API，并在服务端核验其自身数据归属。在 API 进程设置 `APPLICATION_ENTRY` 为应用入口的绝对路径，前端进程设置 `QICORE_APP_LAYER` 为其 Nuxt 层的绝对路径。可使用 `examples/hello/application.mjs` 和 `examples/hello/web` 验证示例；普通成员需要 `hello.read` 权限才能访问示例页面。

为具有自有模型的产品装配预生成数据库客户端时，可调用 `@qicore/standalone/installer` 的 `startInstance({application,createDb,schema,version,hooks})`。其中 `createDb(url)` 返回该产品使用的 Prisma 客户端，`schema` 是组合后的 schema 路径。API 入口在 `startInstance` 返回时已经开始监听，可调用返回对象的 `close()` 释放连接。

| 可选钩子 | 调用时点 |
| --- | --- |
| `beforeInstall({attemptId, product, version, stateRoot, db})` | 开始迁移前执行应用前置步骤。出现异常会保留本次尝试，可用相同 attemptId 重试。 |
| `afterInstall({attemptId, receipt, stateRoot, db})` | 就绪检查和安装回执持久化后执行。未成功确认的步骤会在服务内或重启后重试，应以 attemptId 幂等处理。 |
| `authorizeRequest(req)` | 已安装实例的业务请求进入宿主前执行。返回布尔值决定是否继续。 |
| `mountPublicRoutes(expressApp)` | 在安装和业务访问控制之前装配产品专用公开路由；产品负责这些路由的身份校验。 |

安装回执只包含实例产品、版本、时间、管理员标识和尝试编号。数据库凭据写在实例状态目录内受限的 `database.json`。源码目录、构建产物和公开 HTTP 目录均应与持久状态目录分开。应用的商业交付、在线更新和授权协议由对应产品负责。

## 验证

`pnpm test` 运行单元测试，`pnpm build` 构建后台。Linux 的 `bash tests/mysql.sh` 使用一次性 MySQL 数据库验证真实账号、权限及示例 API。安装器的隔离 HTTP 验收命令为 `bash tests/mysql-installer.sh`，覆盖首装、安装中断恢复、并发、原管理员接入和应用钩子。完整验收可运行 `bash tests/verify-linux.sh`，另外验证示例 Nuxt 层、首屏 HTML，以及 Chromium 中的直接访问、刷新和菜单导航；验收设备需要对应的 Playwright Chromium。

在同一电脑同时预览框架与业务应用时，分别使用数据库、INSTANCE_ROOT、API_PORT 和 Nuxt 端口。在其中一个实例设置 QICORE_SESSION_COOKIE（例如 qc_core_preview），使同一浏览器能同时保持两个登录会话。

默认框架标志与 QiCore-SaaS 使用同一份蓝色 Q 图形。登录页、控制台侧栏和 favicon 共享 app.config 的 qicore.brandMark；独立应用可指定自己的品牌资源。

后台布局、导航、主题和统计卡直接移植自 QiCore-SaaS 的 `packages/qisvc-console-ui`。应用通过 `CoreShell` 接入，使用当前账号的授权菜单和实例品牌。
