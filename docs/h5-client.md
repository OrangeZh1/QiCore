# 单开公共客户端

## 已接入的 H5 服务

原有工作台与登录继续由 Nuxt 提供，匿名访客通过同源的 `/h5` 打开服务中心。页面标题与 favicon 在首个 HTML 中使用本实例的公开品牌配置。服务端只返回当前接入应用或纯框架自身已发布的内容。

| 访客入口 | 读取的数据 | 可操作内容 |
| --- | --- | --- |
| `/h5` | `/api/public/site-brand` | 跳转帮助、客服、用户协议和隐私政策 |
| `/h5/help` | `/api/public/help` | 按分类浏览、加载更多、展开问题 |
| `/h5/help/detail?id=<文章 UUID>` | `/api/public/help/:id` | 查看已发布正文，隐藏文章与隐藏分类中的文章返回 404 |
| `/h5/policy?kind=terms` 或 `kind=privacy` | `/api/public/policies/:kind` | 查看最新发布版本，`termsVersion` 和 `privacyVersion` 可分别指定已发布版本 |
| `/h5/contact` | `/api/public/customer-service` | 拨打已配置的电话、复制微信号、查看二维码 |

这些页面复用 QiCore-SaaS 公共 SDK 的帮助问答、文章、协议及客服布局和相应图标，使用 Vue 与 Nuxt 实现 H5 导航和服务端渲染。源图标许可随 `web/public/h5-assets/icons/LICENSE` 交付。

按照根目录 README 启动开发 API 和 Nuxt，即可在同一预览端口访问 `/h5`。生产环境随 `pnpm build` 构建。验收设备执行 `bash tests/verify-linux.sh` 时，独立数据库实例会运行 `tests/h5-public.browser.mjs`，覆盖无登录访问、发布与隐藏隔离、历史协议、客服操作、移动宽度、页面初始标题和应用内导航。生产预览包的 H5 公共入口与 Nuxt 服务共用进程。

## 上游对照与后续接入

上游仓库 QiCore-SaaS 的 `apps/client/src/pages.json` 注册 14 页。其 `apps/client/build.mjs` 合并 `packages/application-sdk/dist/client` 和宿主源码，然后执行 uni-app 的 `build -p h5`。在上游根目录，`pnpm build:client` 先构建 SDK，再生成 `apps/client/dist/h5`。联合开发入口是 `pnpm dev`，SDK 自测入口是 `pnpm --filter @qicore/application-sdk test`，管理端 H5 路由测试见 `apps/admin/test/h5-channel-title.test.mjs`。上述命令和路径供核对原工程。

| 上游源码（QiCore-SaaS 相对路径） | 对应契约及待接工作 |
| --- | --- |
| `apps/admin/server/utils/h5-entry.ts`、`packages/application-sdk/client/lib/runtime-config.ts` | 上游由服务端核验域名及应用，注入 `qicore-h5-runtime`、站点身份、标题、资源地址和路由前缀。迁入完整 uni-app 壳时需适配单实例身份和 `/h5` 前缀，并保留深链与初始 HTML 标题。 |
| `packages/application-sdk/client/lib/api.ts`、`apps/api/src/core/consumer-sessions.mjs` | 上游请求使用 `/api/v1`、`{data}` 响应及独立消费者令牌。登录、个人资料、手机号绑定与注销需建立消费者身份、授权与会话回归，管理员 Cookie 只用于企业后台。 |
| `packages/application-sdk/client/pages/{home,profile,levels,growth-records}`、`apps/api/src/core/tenant-decoration.mjs`、`consumer-member-levels.mjs` | 上游首页与个人中心依赖实际装修配置、会员等级、成长记录及消费者资料；当前服务中心展示已接入的公开服务。 |
| `packages/application-sdk/client/pages/{member,recharge,orders}`、`apps/api/src/core/wallet.mjs` | 账户资产、积分套餐、订单及充值依赖消费侧账本、交易幂等、支付渠道、通知与退款核对；这些需要独立移植与隔离验收。 |
| `apps/client/vite.config.ts`、`packages/application-sdk/client/lib/runtime-config.ts`、`docs/application-package-layout.md` | 上游框架的公共构建脚本只产出 H5。微信端源码包含条件编译和 `uni.login`，发布模型由业务应用提供 `web/mini-program` 模板，并核验实际 AppID 与 `static/runtime.json`。独立框架小程序需要单设编译入口、微信工具链、多端启动配置与体验验收。 |

完整消费客户端迁入后，仍需按设备验证访客、已登录消费者、渠道停用、维护恢复、跨页面导航等状态，并分别记录 H5 构建、小程序编译与实际发布结果。
