# QiCore 源码与来源

本目录从 QiCore-SaaS 提交 `38af676e2b2a4c1f86d4c5ccf713c70a1a81d020` 导入，作为 QiCore 工作区的初始源码。API、后台、客户端、应用 SDK、共享 UI、测试与构建脚本保留上游目录结构。源码开发的运行要求和工作区参数见[上游开发说明](https://github.com/OrangeZh1/Qicore-Saas/blob/38af676e2b2a4c1f86d4c5ccf713c70a1a81d020/docs/development-workspace.md)。

## 来源与校验

`UPSTREAM.json` 记录源提交、文件范围、数量及来源链接。`UPSTREAM.sha256` 逐文件记录首次导入的 SHA-256。初次导入时还逐项验证了 Git blob 和落盘字节。在本目录使用 `sha256sum --check UPSTREAM.sha256` 可定位后续单开适配涉及的原始文件。这两份记录描述本次来源快照。

## 开发与交付边界

本地开发由 `scripts/development/run.mjs` 创建隔离的数据库、Redis、开发授权与状态目录。上游正式产品配置和客户发行包沿用原产品的身份约束。单开交付须提供本产品正式确认的标识、公钥及验证配置。引用旧产品配置、历史签名初装清单、历史提交或客户制品的专项验收，需要相应的独立输入；新库的迁移基线需另行核对。已纳入 `config/release-baselines` 的历史摘要供兼容检查使用。[上游原生运行包](https://github.com/OrangeZh1/Qicore-Saas/blob/38af676e2b2a4c1f86d4c5ccf713c70a1a81d020/docs/native-package.md) · [上游发行规则](https://github.com/OrangeZh1/Qicore-Saas/blob/38af676e2b2a4c1f86d4c5ccf713c70a1a81d020/docs/release-signing.md)

资源附带的第三方声明和 niucloud 参考许可保留在原路径。对外分发时应依照对应源码和资源的授权范围。[上游源码](https://github.com/OrangeZh1/Qicore-Saas/tree/38af676e2b2a4c1f86d4c5ccf713c70a1a81d020) · [资源许可](docs/reference-projects/niucloud/LICENSE)
