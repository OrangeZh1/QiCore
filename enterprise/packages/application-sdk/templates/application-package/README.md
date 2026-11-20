# 最小应用包模板

本目录演示服务端应用包的描述和入口，不是默认安装的应用，也不是已签名发行包。示例没有业务页面、业务表、演示租户或外部调用。

1. 使用自己的应用 key、授权 packageKey、名称和版本更新 `application.json`。
2. 在独立应用工程开发业务，再编译到 `entry.mjs`。通过 `createApplication(serverSdk)` 和 `createRuntime(resources)` 接入宿主；定义真实权限、适配器及生命周期。
3. 按需加入 `migrations/` 及 `web/admin`、`web/h5`、`web/mini-program`，同步描述中的声明。没有提供的端不声明。
4. 从实际文件生成完整发行清单，依次运行 `nativeArchiveManifestSchema.parse`、`applicationDescriptorSchema.parse` 和 `assertApplicationReleaseLayout`。文件大小、SHA256、兼容范围和迁移摘要必须来自真实产物，不能使用示例占位值。
5. 验证通过后才生成 ZIP；正式安装还需要发行签名、有效授权及安装器验证。

工作源码目录与安装产物目录分别维护。模板可通过 `@qicore/application-sdk/templates/application-package/*` 定位；本目录不提供生产身份、签名或安装回执。
