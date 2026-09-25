# 阶段 6：可观测性

阶段完成后：线上出问题能查到是哪个请求、哪个用户；能看到流量、页面性能和核心业务指标。

方案见 [plan.md 的可观测性一节](../plan.md#可观测性阶段-6)。

---

## T601 logger

- 分支 / worktree：`feat/logger` → `../sass-logger`
- 依赖：阶段 1–5

**做**

- 配置：`features.observability` 总开关；`site.config.ts` 新增 `observability` 字段：`logLevel`（默认 `info`）、`otel`、`sentry`、`analytics`、`speedInsights`（后四项默认 `false`，T602 / T603 实现后两块的行为，本任务只加 schema）
- `src/core/observability/logger.ts`：`logger.debug/info/warn/error(event, fields?)`
  - 生产环境输出单行 JSON（`level`、`event`、`time`、`traceId`、字段），开发环境输出易读格式
  - 自动带上当前 OTel trace ID（有的话）
  - 统一脱敏：`email`、`token`、`password`、`authorization`、`cookie` 等字段替换为 `[redacted]`
  - `error` 接受 `Error`，输出 message 和 stack；预留 `onError` 钩子给 T602 接 Sentry
- 把 `src/core` 里的 `console.error` / `console.warn` 换成 `logger`（测试里的跳过提示除外）；现有可注入的 `logError` 参数默认值改为 `logger.error`
- `src/instrumentation.ts`：
  - `observability.otel` 开启时用 `@vercel/otel` 的 `registerOTel`，服务名取 `siteConfig.name`；在 Vercel 上走 Vercel 的 trace 收集，其他环境用 `OTEL_EXPORTER_OTLP_ENDPOINT`（可选，没配就不导出）
  - `onRequestError`：未捕获的请求错误统一走 `logger.error`，带路由、方法、渲染类型
- 在关键路径上加 span 和日志事件：`runAI` / 图片 / 视频生成（模型、积分、耗时、结果）、billing webhook（provider、事件类型、是否重复）、积分扣减与退款
- `.env.example` 和 README 上线清单补对应说明

**不做**：自建日志存储或查询界面、metrics 导出（OTel metrics）、采样策略配置

**验收**

- [ ] `features.observability` 关闭时，行为与现在一致，不要求任何新的 env
- [ ] 生产构建下一次 AI 调用和一次 webhook 各产生一条带 `traceId` 的 JSON 日志，日志里没有邮箱或 token
- [ ] `src/core` 中（测试文件除外）没有直接的 `console.error` / `console.warn`

**测试**：Vitest 覆盖日志格式、级别过滤、脱敏、Error 序列化、`onError` 钩子；config schema 覆盖新字段默认值

---

## T602 sentry

- 分支 / worktree：`feat/sentry` → `../sass-sentry`
- 依赖：T601

**做**

- 接入 `@sentry/nextjs`（版本以官方文档为准）：`instrumentation.ts` 里按 runtime 初始化 server / edge，`instrumentation-client.ts` 初始化浏览器端；`onRequestError` 用 Sentry 的 `captureRequestError`
- 只在 `features.observability && observability.sentry` 时初始化；env 用 `requiredWhen`：`NEXT_PUBLIC_SENTRY_DSN` 必填，`SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` 可选（有才上传 source map）
- `logger.error` 通过 T601 的 `onError` 钩子上报到 Sentry，附带事件名和字段
- `error.tsx` / `global-error.tsx` 上报渲染错误
- 登录用户只设置 `id`，不发邮箱和 IP（`sendDefaultPii: false`）
- 开启 tunnel 路由，减少被广告拦截
- 采样率写进配置：`observability.sentryTracesSampleRate`，默认 `0.1`

**不做**：Session Replay、用户反馈组件、性能 profiling

**验收**

- [ ] 关闭 `observability.sentry` 时不加载 Sentry SDK，也不要求 Sentry 相关 env
- [ ] 开启后，服务端抛错、客户端抛错、`logger.error` 三种情况都能在 Sentry 里看到，且带 release 和用户 ID，不带邮箱

**测试**：Vitest 覆盖 env 开关、`onError` 钩子调用 Sentry；构建产物检查关闭时不含 Sentry 代码

---

## T603 web-analytics

- 分支 / worktree：`feat/web-analytics` → `../sass-web-analytics`
- 依赖：T601

**做**

- `observability.analytics` 开启时在根布局挂 `@vercel/analytics` 的 `<Analytics />`；`observability.speedInsights` 开启时挂 `<SpeedInsights />`
- 转化事件（统一封装在 `src/core/observability/track.ts`，关闭时为空操作）：
  - 客户端：`checkout_started`
  - 服务端（`@vercel/analytics/server`）：`sign_up`（Better Auth 创建用户后；客户端分不清验证码登录是新用户还是老用户）、`purchase`（在 billing 的 `checkout.completed` 里触发，只带套餐 ID）
- 事件名和属性列在代码常量里，业务可扩展
- README 说明：Vercel Analytics 的自定义事件需要 Pro 计划，Hobby 只有页面浏览

**不做**：PostHog / Plausible 等其他分析服务适配、Cookie 同意横幅（Vercel Analytics 不使用 cookie）

**验收**

- [ ] 两项都关闭时，页面不加载任何分析脚本
- [ ] 开启后部署到 Vercel，Analytics 和 Speed Insights 面板有数据

**测试**：Vitest 覆盖开关（组件是否渲染）、`track` 关闭时为空操作；e2e 断言关闭时页面没有 `/_vercel/insights` 请求

---

## T604 admin-metrics

- 分支 / worktree：`feat/admin-metrics` → `../sass-admin-metrics`
- 依赖：T502

**做**

- `/admin/metrics` 页面，入口加进后台导航；时间范围 7 / 30 / 90 天
- 指标（服务端直接查 Postgres）：
  - 用户：新注册数、累计用户、被封禁数
  - 收入：区间内订单收入（按币种）、付费用户数、活跃订阅数、MRR（月付按原价，年付 ÷ 12）
  - 积分：发放总量、消耗总量、退款总量
  - AI：按类型（对话 / 图片 / 视频）和模型的调用次数、失败率
- 按天的注册数和收入用 CSS 或内联 SVG 画简单柱状图，不引入图表库
- 查询集中在 `src/core/admin/metrics.ts`，带相应索引（如需）
- 跟随 `features.admin`；某个模块关闭时（如 `features.ai`）对应区块不显示

**不做**：留存 / 队列分析、导出 CSV、实时刷新、按业务自定义指标

**验收**

- [ ] 非管理员访问 `/admin/metrics` 返回 404
- [ ] 用测试数据验证 MRR、收入、积分和 AI 失败率的数字正确

**测试**：Vitest 用测试库造数据验证每个指标的查询；e2e 覆盖页面访问控制
