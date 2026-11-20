# qisvc-console-ui

QiSvc 共用控制台组件与样式，包名为 `@orangezh1/qisvc-console-ui`。
这是供 Nuxt 应用使用的 Vue 源码组件库，包含 29 个组件、类型声明和共用 CSS，无需单独构建。

## 环境

- Nuxt `4.5.2`
- Nuxt UI `4.10.0`
- Vue `>=3.5.40 <3.6`
- 宿主应用配置 Tailwind CSS 4、`@nuxt/ui`，并在应用根部使用 `<UApp>`。

## 安装

仓库为私有仓库，需要具有读取权限的 GitHub 账号。已配置 GitHub SSH 身份认证时：

```sh
pnpm add 'git+ssh://git@github.com/OrangeZh1/qisvc-console-ui.git#main'
```

也可以使用已配置 Git 凭据的 HTTPS 地址：

```sh
pnpm add 'git+https://github.com/OrangeZh1/qisvc-console-ui.git#main'
```

正式项目建议将 `main` 替换为经过验证的完整提交 SHA，并提交宿主项目的 lockfile。
不要在依赖 URL 或仓库文件中写入访问令牌。

## Nuxt 接入

`nuxt.config.ts`：

```ts
export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
})
```

在 `app/assets/css/main.css` 引入样式，并显式包含依赖组件的 Tailwind 类扫描路径：

```css
@import "tailwindcss";
@import "@nuxt/ui";
@import "@orangezh1/qisvc-console-ui/styles.css";

@source "../../../node_modules/@orangezh1/qisvc-console-ui/components";
```

上述 `@source` 路径相对于 CSS 文件；调整文件位置时需同步调整。

在页面中按需导入：

```vue
<script setup lang="ts">
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleStatusCard from '@orangezh1/qisvc-console-ui/components/ConsoleStatusCard'
</script>

<template>
  <div class="qisvc-console-stage space-y-6">
    <ConsolePageHeading title="控制台" description="应用运行概览" />
    <ConsoleStatusCard label="用户总数" :value="128" />
  </div>
</template>
```

## 组件

- 布局与导航：`AuthLoginShell`、`ConsoleShell`、`ConsoleSidebarRail`、`ConsoleSidebarLink`、`ConsoleSidebarGroup`
- 内容展示：`ConsolePageHeading`、`ConsoleStatusCard`、`ConsoleDataTable`、`ConsolePagination`
- 状态与交互：`ConsoleEmptyState`、`ConsoleErrorState`、`ConsoleLoadingState`、`ConsoleActionConfirmationDialog`
- 表单与筛选：`ConsoleInput`、`ConsoleListSearch`、`ConsoleListFilters`、`ConsoleListDateRange`、`ConsoleSettingsField`、`ConsoleFormActions`
- 顶部账户与主题：`ConsoleAvatar`、`ConsoleUserMenu`、`ConsoleThemeToggle`
- 授权详情：`LicenseDetailContent`

所有组件均使用 `@orangezh1/qisvc-console-ui/components/<组件名>` 导入；属性、事件和插槽请参阅 `components/` 与 `types/`。
品牌图片由宿主应用提供；使用图标时由宿主配置对应图标集合或图标服务。

## 校园后台抽取组件的稳定接口

这 9 个组件沿用校园零食后台的布局与 Nuxt UI 控件，只负责显示及交互。
接口请求、搜索防抖、权限校验、日期查询时区、保存和退出登录均由宿主应用负责。
原有 14 个组件的导出及 API 保持不变。

| 组件 | 属性 / 双向绑定 | 插槽及行为 |
| --- | --- | --- |
| `ConsoleInput` | `v-model: string \| number`；`size` 默认 `md`；透传 Nuxt UI `InputProps` 和 DOM 属性/事件 | `leading`、默认、`trailing` 插槽透传；支持宿主的 `v-model.number`、`v-model.trim` |
| `ConsoleListSearch` | `v-model: string`；`placeholder` 默认 `搜索`；`maxlength` 默认 `100`；透传其他输入属性/事件 | 固定搜索图标和 `md` 尺寸；默认以提示词作为 `aria-label`，可显式覆盖；不自动发请求 |
| `ConsoleListFilters` | 无专属属性 | 默认插槽放筛选控件，`search` 放搜索框；控件随小屏换行 |
| `ConsoleListDateRange` | 必填 `label`；`v-model:start`、`v-model:end` 为 `YYYY-MM-DD` 或空字符串；`disabled` 同时禁用两端 | 原生日期控件互设 `min/max`；不会静默修改宿主传入的日期；业务与服务端仍须校验区间 |
| `ConsoleSettingsField` | 必填 `label`；可选 `inputId` | 默认插槽放控件；提供 `inputId` 时生成关联标签，否则生成展示文本；仍需给开关等控件自己的无障碍标签 |
| `ConsoleFormActions` | 无专属属性 | 默认插槽放按钮；宽度、换行及靠右对齐一致；不会自动提交表单 |
| `ConsoleThemeToggle` | 支持透传 `disabled` 等按钮/DOM 属性 | 使用 Nuxt UI 的 `UColorModeButton` 和 Nuxt `useColorMode`；跟随宿主色彩模式，无独立主题存储 |
| `ConsoleAvatar` | `src?: string \| null`；`fallbackSrc?: string`；`icon` 默认 `i-lucide-user-round`；透传 `AvatarProps` | 默认插槽透传；没有头像时使用宿主指定的默认图，否则使用图标；图片加载失败时使用 Nuxt UI 自身回退 |
| `ConsoleUserMenu` | 必填 `items: DropdownMenuItem[] \| DropdownMenuItem[][]`；`name` 默认 `用户`；`avatarUrl`、`avatarFallbackSrc`、`disabled` 可选 | `avatar` 插槽接收 `{ name, avatarUrl }`；菜单链接和 `onSelect` 回调由宿主注入，无内置业务路由或退出请求；自定义菜单项插槽请直接使用 Nuxt UI `UDropdownMenu` |

设置字段在桌面默认使用 `10rem` 标签列和 `32rem` 内容列。可在宿主容器设置
`--settings-label-width`、`--settings-content-width`；`--settings-control-height` 可在组件自身的
`style` 属性中覆盖；移动端恢复单列。

例如将筛选和日期范围放入现有表格工具栏：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import ConsoleListFilters from '@orangezh1/qisvc-console-ui/components/ConsoleListFilters'
import ConsoleListSearch from '@orangezh1/qisvc-console-ui/components/ConsoleListSearch'
import ConsoleListDateRange from '@orangezh1/qisvc-console-ui/components/ConsoleListDateRange'
import ConsoleUserMenu from '@orangezh1/qisvc-console-ui/components/ConsoleUserMenu'

const search = ref('')
const start = ref('')
const end = ref('')
// 链接与退出动作由宿主自己的路由和鉴权逻辑注入。
const accountItems = [{ label: '个人资料', to: '/profile', icon: 'i-lucide-user-round' }]
</script>

<template>
  <ConsoleListFilters>
    <ConsoleListDateRange v-model:start="start" v-model:end="end" label="制作日期" />
    <template #search><ConsoleListSearch v-model="search" placeholder="搜索记录" /></template>
  </ConsoleListFilters>
  <ConsoleUserMenu name="管理员" :items="accountItems" />
</template>
```

## 开发检查

使用 Node.js 24 和 pnpm 11；安装依赖后运行：

```sh
pnpm install
pnpm test
```

测试使用 Node 内置测试运行器及 Vue 内存渲染器，不需要测试框架或浏览器。
覆盖全部组件的 SFC 编译、包导出完整性，以及新增组件的属性/插槽透传、
输入双向绑定、日期边界、无障碍标签、头像回退、账户菜单注入和主题响应。
Nuxt UI 控件在这些单元检查中使用小型替身，真实 Nuxt 宿主仍需运行自己的类型检查和构建。

## 维护与来源

初始源码提取自 `OrangeZh1/QiSSO` 的 `packages/qisvc-console-ui`，来源提交：
`6cba6a3bfec7acc62193b7bb9aa90b9976f5e679`。

本仓库从独立初始提交开始，未复制 QiSSO 的业务代码、环境文件或完整提交历史。
原项目的 workspace 依赖仍使用各自本地副本；后续需要接入本仓库时，替换对应依赖并验证宿主应用。

新增组件提取自 `OrangeZh1/school-shop`，来源提交
`c015818eb76b163a2e4e36d4d3ae3d2f436fb823`，位于
`apps/admin/app/components/` 中同名文件。`ConsoleThemeToggle` 和 `ConsoleUserMenu`
的紧凑尺寸与动效来自 `apps/admin/app/assets/css/main.css`，已移入对应组件的 scoped 样式。
CSS 名称统一为 `qisvc-console-*`；默认头像不再指向校园静态文件，
账户菜单不再读取 `useConsoleAuth`、`ConsoleArea` 或固定后台路径。
`ConsoleInput` 补齐底层输入插槽透传，日期区间补齐整体禁用属性。
没有复制校园业务模型、请求接口、素材、环境文件、密钥、账号或数据库。
富文本编辑、文件库、支付退款及校区管理保留在业务宿主中，没有引入它们的额外依赖。

现有工程可先使用本地 `link:` / `file:` 依赖测试；正式同步后仍建议锁定验证过的提交 SHA。
如果宿主必须使用 workspace 快照，只同步 `package.json`、`components/`、`types/`、`styles/`，
保留宿主自己的 workspace 约定，再运行其类型检查与构建；不要复制 `node_modules` 或开发临时文件。

`package.json` 保留现有 GitHub Packages 的受限发布配置。本次只建立 Git 私有仓库，尚未发布 npm/GitHub Packages 包；当前通过 Git 地址安装即可。

## SaaS 后台公共布局补充（2026-10-08）

- `ConsoleBreadcrumbs`：面包屑展示，路径由宿主提供。
- `ConsoleTopbar`：从校园 `AreaConsoleShell` 的顶栏模式提取移动导航、刷新与账户操作插槽；刷新发出事件，不内置整页重载或计时器。QiCore 的 `refreshDisabled` 扩展允许导航期间禁用刷新，`refreshing` 仍只由用户发起的刷新控制，不与导航加载状态共用。
- `ConsoleProfileLayout`：从校园 `ConsoleProfile` 提取基本资料和辅助信息的双栏布局，保存接口、身份和上传逻辑留在宿主。
- `ConsolePageTabs`：宿主控制的页面链接与关闭事件；工作台标签可固定。证件照项目按用户最新要求不挂载标签栏，组件保留用于后续项目。
- `ConsoleTrendChart`：ECharts 6 按需加载的折线/面积趋势图，包含日期刻度、悬停提示、深浅色和尺寸变化处理；只接收日期和值，不发起业务请求。
- `ConsoleShell` / `ConsoleSidebarRail` 新增 `showSidebarTheme`（默认 true），允许宿主将主题按钮放在顶栏。折叠行为集中在统一侧栏。
- `ConsoleUserMenu` 使用分组菜单，个人资料路由和退出事件仍由宿主传入；菜单宽度与行高统一。

这些是 UI 能力，不包含租户权限模型、支付或证件照业务规则。校园项目仅作为只读参考，未修改其文件。


`ConsoleTrendChart` 支持 `unit`（默认“次”）和可选 `comparison: { label, unit, data }`。比较序列同时绘制，使用独立纵轴、不同颜色/线型/标记及共用 tooltip；可访问描述包含两组数据。保留原单序列接口兼容性。


`ConsoleAuthorizationState` 为纯显示组件，提供未授权、授权到期、授权封禁、授权正常和校验失败提示，支持自定义说明、到期时间、最近校验时间、重新校验事件及操作插槽。不执行授权、不存储回执、不包含许可证密钥，不因空到期时间显示永久授权。宿主必须使用服务端可信校验结果驱动正式状态；开发样例不得写回真实授权。

`ConsoleShell` 的 Panel body 显式清除 `sm:p-6` 默认内边距，避免与 stage 内边距叠加。间距统一由 stageClass 控制。
