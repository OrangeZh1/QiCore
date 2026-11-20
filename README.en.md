<p align="center">
  <img src="enterprise/apps/admin/public/brand/qicore.png" alt="QiCore" width="104" height="104">
</p>

<h1 align="center">QiCore</h1>

<p align="center">
  <strong>A self-hosted admin console and application SDK for web apps and mini programs.</strong><br>Built with Nuxt and NestJS, QiCore provides accounts, permissions, membership, payments, and content management.
</p>

<p align="center">
  <a href="README.md" lang="zh-CN">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/OrangeZh1/QiCore/actions/workflows/compatibility-host.yml"><img src="https://github.com/OrangeZh1/QiCore/actions/workflows/compatibility-host.yml/badge.svg?branch=main" alt="Compatibility host CI"></a>
  <img src="https://img.shields.io/badge/Node.js-24-417E38" alt="Node.js 24">
  <img src="https://img.shields.io/badge/MySQL-8-236283" alt="MySQL 8">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-287A47" alt="MIT License"></a>
</p>

## Quick start

Install Node.js 24, pnpm 11.25.0, MySQL 8, and Redis. The development launcher starts its own MySQL and Redis processes. Make sure `mysqld`, `mysql`, `mysqladmin`, `redis-server`, and `redis-cli` are on your `PATH`.

```sh
git clone https://github.com/OrangeZh1/QiCore.git
cd QiCore
pnpm enterprise:prepare
pnpm dev
```

Open the [admin console](http://127.0.0.1:3700/admin/login). On the first run, the launcher writes the local administrator credentials to `.local/enterprise-preview-3700/admin/admin-bootstrap.json`. Subsequent runs reuse the same accounts and data. Run `pnpm dev:stop` from the repository root to stop the development services.

## Features

| Module | Capabilities |
| --- | --- |
| Accounts and permissions | Administrator accounts, roles, fine-grained permissions, profiles, and audit logs |
| Users and membership | User profiles, membership levels and tags, points history, and issuing and redeeming service packages |
| Payments and transactions | Top-ups, orders, transaction history, and configuration for WeChat Pay, Alipay, and WeChat virtual payments |
| Content and channels | Media library, help articles, policy management, notifications, and page customization for H5 and WeChat |
| Operations | Environment checks, scheduled jobs, cache management, and database backup and recovery |

## Application development

Each site runs as an independent instance with its own database, administrator accounts, and storage. QiCore can run on its own or host one main application and its plugins. Applications declare their permissions, admin routes, and APIs through the SDK. Commercial distributions use a signed manifest to install and upgrade the framework, application, and bundled plugins together.

| Directory | Contents |
| --- | --- |
| [enterprise/apps/admin](enterprise/apps/admin) | Admin console built with Nuxt, Vue, and Nuxt UI |
| [enterprise/apps/api](enterprise/apps/api) | NestJS API service backed by Prisma |
| [enterprise/apps/client](enterprise/apps/client) | Shared client built with uni-app |
| [enterprise/packages/application-sdk](enterprise/packages/application-sdk) | Application interfaces, console integration, and client assets |

## Documentation

The guides below are in Chinese.

- [Installation and configuration](enterprise/STANDALONE.md) covers environment variables, database initialization, administrator setup, and service startup.
- [Applications and plugins](enterprise/docs/standalone-composition.md) covers local development, component declarations, packaging, and updates.
- [Compatibility host](docs/compatibility-host.md) documents existing applications built with `@qicore/standalone`, including examples and verification commands.

## License

QiCore is distributed under the [MIT License](LICENSE). Third-party components, icons, and assets retain their respective copyright and license notices.
