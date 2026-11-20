# 单开产品的应用与插件

纯框架可独立运行。每个商业产品包含一个主应用，可同时携带多个插件。主应用使用 `qicore-application-v1`、`app_…`，插件使用 `qicore-plugin-v1`、`plugin_…` 或 `plg_…`。插件声明自己的 key、namespace、版本、权限、路由和 applicationKey。指定主应用时须与本包主应用 key 相同，通用插件沿用上游的 `*` 归属和权限检查。已保留的历史组件身份继续参与冲突检查。

## 本机开发

在本目录运行 `node scripts/development/run.mjs --port 3700 --state <独立状态目录>` 启动纯框架。联调产品时增加一次 `--app <主应用源码目录>` 和对应数量的 `--plugin <插件源码目录>`。各源码目录提供真实 application.json 和 package.json 中的 qicore.development 契约。每个活跃组件的 key、packageKey、插件命名空间在本实例唯一。开发网关监听 127.0.0.1。使用独立开发数据库、开发会话及开发签名身份。

## 制作商业整包

制作方先在受控构建目录生成可启动的 Linux x64 Node 24 完整产品。根目录包含 `product.json`（version、frameworkVersion）、`server/start.mjs` 和实际运行依赖。每个预构建主应用或插件位于 `components/<packageKey>/`，目录含 application.json、entry.mjs 和描述中声明的前端资源。主应用版本与产品版本一致，插件保留各自版本。

编译单开版 API 后执行以下命令，生成仅写一次的 `standalone-components.json`。

```sh
node scripts/prepare-standalone-composition.mjs /path/to/payload /path/to/product-public.json
```

产品公开配置的 componentType 为 app，deliveryKind 为 archive，appKey 与主应用的 packageKey 一致。将组件清单和全部运行文件一起纳入单开产品的 `app_update` 完整包清单，由产品发行流程出具可信发行签名。准备组件清单仅完成制包前的身份和文件检查。

## 安装后启动

受管启动器提供三个绝对路径。

| 环境变量 | 内容 |
| --- | --- |
| `QICORE_STANDALONE_PRODUCT_FILE` | 部署方固定的该产品公开标识、授权回执公钥及发行验证公钥 |
| `QICORE_STANDALONE_BUNDLE_ROOT` | 当前准备启动的真实版本目录 |
| `QICORE_STANDALONE_RELEASE_FILE` | 独立更新助手已核验并持久化的该版本完整发行元数据，含受信的 STANDALONE 初装或在线更新签名 |

API 启动会复核产品身份、发行签名、发布版本、整个目录的文件清单、每个组件的摘要和插件归属，再加载代码。每个插件的权限检查和授权状态独立生效。Nuxt 的受管启动命令在生产进程中通过 `node --import /path/to/scripts/standalone-web-preload.mjs …` 装配相同的已验证目录，使页面资源和服务端从同一产品版本加载。该预加载器仅供 Nuxt 渲染进程使用。Nuxt 将验证后的目录绑定到自己的 Node 进程；仅提供原 SaaS 的 QICORE_COMPONENTS 环境变量时，商业渲染器会拒绝加载。纯框架使用单开版源码的独立安装流程，商业整包走该产品专用的安装与恢复助手。

## 整包更新

`QICORE_STANDALONE_UPDATER_SOCKET` 指向该产品的受限本机更新助手。助手负责文件锁、在线下载权益、签名清单、版本切换、健康回执和失败恢复。后台使用助手的 `GET /status`、`POST /check` 和 `POST /apply` 契约；发起实际更新前，助手返回的 current.slot 须等于当前签名 release 的 `版本号-清单SHA256`，框架版本亦须匹配。视图中只提供整包更新。产品身份来自部署方固定的公开配置。

旧单开 SDK 声明采用 Express register 回调，旧 Prisma 账号表和网页接口与单开版 SDK 的 application.json、createApplication 和后台会话契约不同。已经依赖旧 SDK 的应用需要完成入口、数据库和权限映射后才能进入单开产品整包。维护既有安装时使用该产品原有的稳定助手、收据和保留策略。

## 隔离验收

```sh
pnpm db:generate
pnpm --filter @qicore/api build
node --test apps/api/test/standalone-composition.test.mjs
```

该用例在临时目录生成测试密钥、主应用和两个插件，实际加载运行时并核对撤权、签名与文件完整性。正式发行、正式绑定和客户升级由对应产品另行执行。

证件照等外部应用通过 `scripts/check-application-separation.mjs` 检查独立源码、SDK 和 `/admin/…` 页面交接。已发行应用的兼容性须在对应的商业产品重新构建、发行签名和完整包验收后记录，纯框架及临时插件的通过结果只覆盖各自范围。
