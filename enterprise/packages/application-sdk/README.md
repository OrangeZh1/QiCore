# QiCore 应用 SDK

框架自身的 `apps/client` 同样装配这里已有的公共首页、个人中心、登录、帮助与资产页面，作为零应用站点的默认 H5。宿主公共数据域不加入已安装应用目录，也不替代应用授权；应用页仍由各应用独立装配。`pnpm build:client` 构建这一框架客户端。

由 QiCore 维护的公开构建依赖，不包含证件照实现或应用默认安装记录。执行根目录 `pnpm build:sdk` 从本工程的规范源码生成 `dist`；应用只安装公开 SDK 包（构建内容与独立开发 CLI），不直接读取框架内部源码。生成目录不纳入源码版本控制。

- `contracts`：与宿主一致的应用描述和完整发行包校验。
- `templates/application-package/*`：最小服务端应用包模板，不注册或安装示例应用。
- `browser/*`：浏览器可用的公共装修、富文本清理、品牌与路径契约，以及对应类型；引用的运行依赖随模块打包。
- `console`：无页面、无服务端业务的 Nuxt 层，提供现有 Console 布局、组件和组合函数。
- `client/*`：公共小程序/H5 页面、会话、钱包、装修、组件及所需静态素材。登录图标、默认头像、会员等级和支付标志由 SDK 一并提供；应用构建器与自身业务页面组合，应用身份模板 `static/runtime.json` 仍由应用维护。

服务端应用继续通过 `createApplication(serverSdk)` 借用宿主模块；构建时的 `@qicore/server/*` 引用在装配时解析到同一宿主实例，不打包复制身份、授权或资金状态。

客户端装配必须注入自身 `__QICORE_APPLICATION_KEY__`。登录结果校验租户和应用，会话存储在 H5 与小程序均按租户及应用区分；公共包没有证件照默认身份。公开源码中的相对页面路径是客户端装配契约，不能单独作为一个已安装业务应用运行。

微信小程序装配在 `manifest.json` 的 `mp-weixin` 中开启 `mergeVirtualHostAttributes`。装修交互组件使用单个原生根节点接收父级 scoped 类名，装修容器显式共享其 scoped 样式，避免 Banner 高度、卡片排列和导航样式在组件边界丢失。滚动容器使用 `enhanced` 与 `show-scrollbar=false`，隐藏滚动条并保留触摸滚动；验收须包含微信模拟器，H5 截图或编译通过不能代替小程序渲染检查。

公共订单通过 `client/lib/order-payment.ts` 调用框架支付与查单接口，复用普通微信、公众号、H5、支付宝、余额和虚拟支付的现有契约；不要求应用提供 `unlock`、订单业务类型或开发提示组件。公共认证页面只管理框架会话，不读取、重置应用的制作草稿；应用负责按 `consumerScope()` 与 `sessionStorageKey()` 隔离和恢复自己的状态。客户端构建由应用提供 Vue、uni-app 与富文本渲染依赖 `mp-html`；SDK 检查同时验证相对导入，并在只有公开包及这些外部运行时的临时目录选择 H5/小程序条件分支，编译公共脚本与模板。

新应用的模型、物理表和任务命名使用自身命名空间；宿主同时核对模型名和物理表名，冲突时拒绝启动。已有证件照模型保留原名称以保持历史迁移不可变，不能把它们当成框架通用表。

打包器在创建 ZIP 前，对真实清单和应用描述依次执行 `nativeArchiveManifestSchema.parse`、`applicationDescriptorSchema.parse`、`assertApplicationReleaseLayout`；安装、更新与启动复用相同布局契约。固定路径、可选前端和兼容边界见[应用安装包规范](../../docs/application-package-layout.md)。

后台同名业务路径按可信站点绑定分发，各应用内部路径仍须唯一；框架保留页不可覆盖。应用身份、版本与静态资源目录分别校验。应用是受信服务端代码，不是第三方代码沙箱。

独立 SDK 交付、公开服务端 API、插件及任意目录宿主接入见[独立开发协议](../../docs/extension-development.md)。本地联调按[开发工作区契约](../../docs/development-workspace.md)提供 `qicore.development`，无需修改宿主注册表。执行 `pnpm --filter @qicore/application-sdk test` 会增量生成 SDK，在系统临时目录只安装公开包，检查所有公共源码中的自身包导入、浏览器声明文件与富文本清理行为；该检查已接入根目录 `pnpm test`。
