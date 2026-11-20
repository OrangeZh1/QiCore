# QiCore

QiCore 是一套面向 Web 与小程序应用的开源开发框架，提供管理后台、Node.js API、H5 客户端和应用 SDK。每个站点独立部署，使用自己的数据库、管理员账号和存储空间。QiCore 可以直接运行，也可以接入一个主应用及其功能插件。

## 快速开始

本机开发需要 Node.js 24、pnpm 11.25.0、MySQL 8 和 Redis。启动脚本会创建专用开发实例，请确保 `mysqld`、`mysql`、`mysqladmin`、`redis-server` 和 `redis-cli` 在 `PATH` 中。

```sh
git clone https://github.com/OrangeZh1/QiCore.git
cd QiCore
pnpm enterprise:prepare
pnpm dev
```

启动后打开 [管理后台](http://127.0.0.1:3700/admin/login)。首次启动生成的管理员账号和密码保存在 `.local/enterprise-preview-3700/admin/admin-bootstrap.json`。再次启动会沿用该实例的数据和账号。在仓库根目录运行 `pnpm dev:stop` 可停止开发服务。

## 功能

| 模块 | 提供的能力 |
| --- | --- |
| 账号与权限 | 后台登录、管理员与角色管理、分项授权、个人资料和操作日志 |
| 用户与会员 | 消费者资料、会员等级与标签、积分流水、服务次数套餐的发放与核销 |
| 支付与交易 | 充值配置、订单与交易流水、微信支付、支付宝和微信虚拟支付配置 |
| 内容与渠道 | 素材库、帮助中心、协议管理、消息配置，以及 H5 和微信页面装修 |
| 运行维护 | 环境检查、计划任务、缓存管理、数据库备份与恢复 |

## 应用开发

主应用通过 SDK 声明权限、后台页面和 API。插件可以扩展主应用的功能。以商业产品交付时，框架、主应用和随包插件按同一份签名清单安装和升级。[应用与插件开发指南](enterprise/docs/standalone-composition.md)

| 路径 | 内容 |
| --- | --- |
| [enterprise/apps/admin](enterprise/apps/admin) | 基于 Nuxt、Vue 和 Nuxt UI 的管理后台 |
| [enterprise/apps/api](enterprise/apps/api) | 基于 NestJS 和 Prisma 的 API 服务 |
| [enterprise/apps/client](enterprise/apps/client) | 基于 uni-app 的公共客户端 |
| [enterprise/packages/application-sdk](enterprise/packages/application-sdk) | 应用开发接口、后台集成与客户端资源 |

## 文档

- [安装与运行](enterprise/STANDALONE.md) — 环境变量、数据库初始化、管理员配置和服务启动。
- [应用与插件](enterprise/docs/standalone-composition.md) — 本地联调、组件声明、打包和更新。
- [兼容宿主](docs/compatibility-host.md) — 使用 `@qicore/standalone` 的既有应用及其示例和验收命令。

## 许可证

QiCore 使用 [MIT 许可证](LICENSE)。第三方组件、图标和素材的版权及许可声明随相应文件分发。
