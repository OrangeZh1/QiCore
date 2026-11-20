# 独立插件包

插件复用受信应用的构建、完整文件清单、发行验证及受控生命周期。描述仍在 `application.json`，格式为 `qicore-plugin-v1`，发行类型为 `plugin_update`。插件不占应用坑位，也不成为租户当前应用。

`applicationKey` 为目标应用业务 key；`*` 为框架插件，在当前应用数据域运行，零应用时在 `system` 域运行。应用插件的可信发行元数据必须绑定 `parentApp`，并在依赖中声明该应用版本范围；框架插件绑定框架。`namespace` 在各目标应用内唯一。

后台 API：`/api/v1/admin/tenants/:tenantId/apps/:applicationKey/plugins/:pluginKey/<path>`。客户端 API：`/api/v1/apps/:applicationKey/plugins/:pluginKey/<path>`。宿主按声明匹配 HTTP 方法与参数，先核验真实会话、所属应用及插件授权。后台权限自动变为 `<applicationKey>:plugins.<namespace>.<permission>`；`system` 使用宿主 `tenant:` 公共权限前缀。消费者接口由插件继续校验业务权益。

后台页面可声明现有 `web.admin` 契约；不能覆盖宿主或所属应用路由。H5/小程序的构建期页面、组件通过应用自己的构建流程组合，不在运行中加载不可信脚本。公共能力经 `serverSdk.api` 或构建时外置的 `@qicore/application-sdk/server` 使用。

所有业务写入继续使用共享事务和完整消费者身份。`createRuntime` 为每个目标数据域创建运行实例，接收 `applicationKey/pluginKey`；后台/消费者处理器接收可信上下文与请求。禁止关闭宿主数据库；`close` 仅释放插件自有资源。插件为受信代码，不提供第三方安全沙箱。

`tick(enabled)` 的 false 表示禁止发起新业务；仍需按原回执处理持久任务、资金补偿及恢复义务。框架不会因授权到期删除未完成任务，也不会允许带未完成任务切换数据域。
