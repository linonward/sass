# 阶段 15：差异化补齐

状态：规划完成，实施任务待启动（2026-09-27）。

阶段完成后：模板新增四项市场上无竞品同时具备的能力——用户 API Key 管理、Feature Flags、内置 Changelog、System Status Page。这四项与现有 Creem + 积分 + 获客 + 品牌系统组合后，形成**"AI SaaS 完整操作系统"**的定位护城河。

依据：[竞争格局分析](../competitive-landscape.md) 与 [进入市场策略](../go-to-market.md)。动机：现有 7 个差异点中，获客与积分是功能深度优势；但"用户拿到模板后第一天就能用 API 交付、第二天就能灰度发布、第三天就能展示产品更新和系统状态"这件事，市场上没人做。补齐这四项把"完整底盘"从口号变成事实。

## 范围与共用规则

- **API Key 管理**：用户在自己的 dashboard 生成/命名/撤销 API Key；API 路由通过 Bearer token 鉴权识别用户；每个 key 可独立限流。
- **Feature Flags**：`site.config.ts` 扩展用户面开关；支持全局启用/关闭、按百分比灰度、admin-only；提供 `isEnabled()` 和 `<FeatureFlag>` 组件。
- **Changelog**：content-collections + MDX 驱动的 `/changelog` 页面和 RSS feed；复用博客基础设施。
- **Status Page**：`/status` 公开页面展示核心服务状态；支持手动设置和自动 health check 两种模式；显示过往 incident。

不做：

- 不做 API Key 的 OAuth2/scope 体系、不做多级权限 key、不做 key 的调用量计费（积分已有）
- 不做 Feature Flag 的 A/B 实验统计、不做按国家/IP 维度的规则、不做 kill switch 紧急熔断
- 不做 Changelog 的后台发布 UI（v1 直接改 MDX 文件）
- 不做 Status Page 的第三方监控集成（PagerDuty/Opsgenie）、不做自定义域名 status 页
- 不做用户面 API Docs（留到 key 管理成熟后再做）

复用 TypeScript + Node、Postgres、现有认证、邮件、content-collections、可观测性；首版不新增外部服务、SDK 或运行时。实施中确需新增依赖时先查官方最新稳定版。

通用能力位于：

- `src/core/api-keys/` —— key 生成、hash、验证、中间件
- `src/core/flags/` —— flag 评估逻辑与组件
- `src/app/[locale]/(app)/api-keys/`、`(marketing)/changelog/`、`/status/` —— 页面
- `src/core/status/` —— health check 逻辑

配置新增 `apiKeys`、`userFlags`、`changelog`、`statusPage` 段，各自有 `enabled` 开关默认 `false`。关闭后路由返回 404、中间件放行所有请求不做 key 校验。API Key 模块依赖 `features.auth`；Status Page 自动模式依赖 `features.observability`（手动模式独立可用）。

UI 实施先读 `docs/design.md`，沿用配置色、贴纸描边和硬唇边；所有新增文案进入语言文件。新增页面都需要 375px 不横向溢出 + 亮暗两套 e2e。

## 批次

- **批次 A（差异核心）**：T1501–T1504。四条互不重叠，可并行开 worktree。
- 全部做完本阶段即结束，没有再往下拆的项。

---

## T1500 differentiation-plan

- 分支 / worktree：`docs/differentiation-plan` → `../sass-differentiation-plan`
- 依赖：—（规划任务；实施依赖在各卡单列）

**做**

- 新增 `docs/tasks/phase-15-differentiation.md`（本文件）
- 更新 `docs/tasks/README.md`：总览表加阶段 15 行、依赖图加阶段 15 依赖链、推荐顺序补 T1501–T1504（四条可并行）
- 在 `docs/go-to-market.md` 的"与现有阶段的关系"一节把阶段 15 加进去

**不做**：调整其他阶段的编号或依赖；改动任何 `src/` 代码

**验收**

- [ ] `docs/tasks/phase-15-differentiation.md` 存在且四块均有实施任务、分支/worktree、依赖与验收标准
- [ ] `docs/tasks/README.md` 总览表、依赖图、推荐顺序三处都已更新
- [ ] `docs/go-to-market.md` "与现有阶段的关系"指向阶段 15
- [ ] Markdown 内部链接全部可解析（相对路径不跨 worktree）

**测试**：Markdown 格式检查、相对链接一致性检查；纯文档不跑应用测试

---

## T1501 api-keys

- 分支 / worktree：`feat/api-keys` → `../sass-api-keys`
- 依赖：T1500、T203、T201、T401、T204
- 配置开关：`apiKeys.enabled`（默认 `false`）

**问题**

AI SaaS 的用户需要通过 API 调用服务。当前模板有认证（人登录）但没有 API 鉴权（机器调用）。买家必须自己实现 key 生成、哈希存储、Bearer 解析、撤销、限流——这套代码在每个 AI SaaS 里几乎一模一样，但没有人把它做成模板能力。

**做**

- `src/core/db/schema/api-keys.ts`：`userApiKeys` 表——
  - `id`（uuid）、`userId`（→ user）、`name`（用户给 key 起的名字）、`prefix`（`sk_` + 前 8 位明文，用于在 UI 里辨认 key）、`hashedKey`（SHA-256）、`lastUsedAt`、`expiresAt`（可选）、`revokedAt`（null = 有效）
  - 唯一约束 `(userId, name)` 防止重名；索引 `(hashedKey)` 用于鉴权查找
- `src/core/api-keys/generate.ts`：生成 `sk_` + 32 字节随机 hex、SHA-256 哈希、返回一次性明文（调用方负责展示，之后无法恢复）
- `src/core/api-keys/middleware.ts`：解析 `Authorization: Bearer sk_xxx` → 查 `hashedKey` → 校验未过期、未撤销 → 注入 `request.apiKey`（含 userId + keyId）；中间件不在 `src/core` 里直接挂载，而是导出一个 `createApiKeyMiddleware` 让 API 路由选择性使用
- `src/core/api-keys/rate-limit.ts`：可选 per-key 限流，复用 Upstash `@upstash/ratelimit`，key = `api_key:<keyId>`，阈值在 `site.config.ts` 的 `apiKeys.rateLimitPerKey`（默认不限制）
- 用户侧页面（`src/app/[locale]/(app)/api-keys/`）：
  - 列表页：展示所有 key（name、prefix、createdAt、lastUsedAt、状态）、新建按钮、撤销按钮
  - 新建对话框：输入 name → 展示一次性明文 + "复制并安全保存，之后无法再次查看"提示
  - 撤销确认对话框（注明不可逆）
- 后台入口（受 `features.admin` 控制）：查看所有用户的 key 数量与最后使用时间，不暴露 key 原文或 hash
- 开关关闭时：API key 页面和 API 路由均 404；中间件不在任何路由生效

**不做**

- OAuth2 provider / scope 体系、多级权限 key（read/write/admin）、按 key 的调用量计费（积分系统已有，key 只做身份不做出账）
- 用户自助轮换 key（v1 撤销再创建即可）、key 到期自动通知
- SDK 生成与多语言代码示例（留到 API Docs 阶段）

**验收**

- [ ] 用户登录后在 dashboard 侧栏看到 "API Keys" 入口，可新建、命名、复制明文、撤销
- [ ] 撤销后的 key 在 30 秒内不可再用于鉴权（最多 60 秒缓存窗口）
- [ ] `Authorization: Bearer sk_valid` → 路由拿到 `request.apiKey.userId`；过期/撤销/随机字符串 → 401
- [ ] `apiKeys.enabled: false` 时页面和中间件均不可达
- [ ] 产品面 UI 在 375px + 亮暗两套下不横向溢出
- [ ] 文案全部走 i18n 文件

**测试**

- Vitest：key 生成格式（`sk_` 前缀 + 64 hex）、hash 确定性、中间件各分支（有效/过期/撤销/格式错误/缺失）、撤销幂等
- e2e：用户登录 → 创建 key → 复制明文 → 用 key 调一个测试 API → 撤销 key → 同一 key 再次调用返回 401

---

## T1502 feature-flags

- 分支 / worktree：`feat/feature-flags` → `../sass-feature-flags`
- 依赖：T1500、T102、T201、T502
- 配置开关：`userFlags.enabled`（默认 `false`）

**问题**

SaaS 上线后需要灰度发布新功能——先给 admin 看、再给 10% 用户看、最后全量。早期项目可能不需要，但从"第一个付费用户"开始就有场景（"先给这个客户开 beta 功能"）。当前配置开关是编译期的模板功能开关，不是运行期的用户面 feature flag。竞品没有一个做这件事。

**做**

- `site.config.ts` 新增 `userFlags` 段：
  ```typescript
  userFlags: {
    enabled: boolean; // 默认 false，关闭后 isEnabled() 永远返回 false
    definitions: Record<
      string,
      {
        description: string;
        enabled: boolean; // 总开关
        rollout: number; // 0–100，百分比灰度
        adminOnly: boolean; // 仅 admin 可见
      }
    >;
  }
  ```
- `src/core/flags/evaluate.ts`：
  - `isEnabled(userId: string | null, flagName: string): boolean`
  - 逻辑：`!userFlags.enabled` → false；`!def.enabled` → false；`adminOnly && !isAdmin` → false；`rollout < 100` → 对 `sha256(userId + flagName)` 取前 8 hex → 转 [0,1) → 小于 rollout/100 则 true
  - 确定性分桶：同一 user+flag 永远落在同一桶
- `src/core/flags/components.tsx`：
  - `<FeatureFlag name="x" fallback={...}>` 客户端组件
  - `useFlag(name)` hook → boolean
- 后台管理页（`src/app/[locale]/(app)/admin/flags/`）：
  - 表格列出所有 definitions：name、description、enabled、rollout、adminOnly
  - 行内编辑（toggle + slider），操作写入 `site.config.ts` 不现实 → v1 管理界面读配置展示，修改提供 SQL 片段或告知"改 site.config.ts 后重新部署"
- 设计上不引入新的外部服务或数据库表——v1 纯配置驱动，不需要 DB 存储 flag 状态

**不做**

- 数据库存储 flag 状态（v1 配置足够；v2 如果需要运行时改 flag 再迁）
- A/B 实验统计（展示/点击/转化漏斗）、按国家/IP/plan 维度的规则、kill switch 紧急熔断
- flag 变更历史与审计日志

**验收**

- [ ] 配置一个 `beta-dashboard: { enabled: true, rollout: 50, adminOnly: false }`——admin 永远可见、普通用户约一半可见、未登录用户不可见
- [ ] `rollout: 100` 时所有用户可见；`rollout: 0` 时仅 admin 可见（`adminOnly: false` 时也是 0 可见，除非设 `adminOnly: true`）
- [ ] `userFlags.enabled: false` 时 `isEnabled()` 永远 false、`<FeatureFlag>` 永远不渲染 children
- [ ] 同一个 user + flag 多次评估结果一致（确定性分桶）
- [ ] 新 flag 加进 `definitions` 后 `pnpm typecheck` 通过
- [ ] 后台 flag 列表页展示所有定义、状态清晰可读

**测试**

- Vitest：`isEnabled` 各分支（总开关关、单 flag 关、adminOnly、rollout 0/50/100）、分桶确定性、null userId
- e2e：admin 可见 beta 功能、普通用户按 rollout 可见/不可见、关闭总开关后功能消失

---

## T1503 changelog

- 分支 / worktree：`feat/changelog` → `../sass-changelog`
- 依赖：T1500、T501、T104、T105
- 配置开关：`changelog.enabled`（默认 `false`）

**问题**

每个 SaaS 都需要一个地方告诉用户"最近更新了什么"。当前模板博客已经有了（content-collections + MDX），但 changelog 和 blog 的定位不同——changelog 是产品更新、按时间倒序、通常有分类（feature/improvement/fix）、需要 RSS feed 让用户订阅。竞品没有一个提供内置 changelog。

**做**

- `content/changelog/` 目录，MDX 文件，复用 content-collections：
  ```md
  ---
  title: "API Keys 功能上线"
  date: "2026-10-15"
  category: "feature"  // feature | improvement | fix
  ---

  用户现在可以在 dashboard 生成和管理自己的 API Key...
  ```
- collection 定义 (`src/core/content/changelog-collection.ts`) 或扩展现有 content-collections 配置
- `/changelog` 页面（`src/app/[locale]/(marketing)/changelog/`）：
  - 按日期倒序排列，按月份分组
  - category badge：`feature`（`success` 色）、`improvement`（`info` 色）、`fix`（`outline` 色）
  - 右侧或底部 RSS 订阅链接
- RSS feed：`/changelog/rss.xml`（或 `/changelog/feed.xml`），标准 RSS 2.0
- 落地页 footer 加 changelog 链接（`features.changelog` 开启时显示）
- 不做分类过滤页面（v1 单页足够）；不做后台发布 UI（直接改 MDX 文件 + git push 部署）
- 设计沿用营销面语域（`.sticker` 卡片 + display 标题）；375px + 亮暗 e2e

**不做**

- 后台 changelog 发布 UI、草稿/定时发布、邮件推送新 changelog
- 分类过滤、标签、全文搜索
- changelog 与博客的交叉引用（"Read more in our blog"——可以手动加链接，不模板化）

**验收**

- [ ] `content/changelog/` 下有一条示例条目，`pnpm dev` 后 `/changelog` 可访问
- [ ] 页面按日期倒序、按月分组、category badge 颜色正确
- [ ] `/changelog/rss.xml` 返回合法 RSS 2.0、在阅读器里可订阅
- [ ] `changelog.enabled: false` 时页面 404、footer 不显示链接
- [ ] 375px 亮暗两套不横向溢出
- [ ] changelog 页面使用 display 字体 + 营销面语域（不是产品面面板）

**测试**

- Vitest：collection 解析 MDX frontmatter、RSS feed 内容校验（含 `channel` / `item` 必填字段）
- e2e：访问 changelog 页面 → 可见至少一条条目 → RSS link 存在

---

## T1504 status-page

- 分支 / worktree：`feat/status-page` → `../sass-status-page`
- 依赖：T1500、T601、T202、T502
- 配置开关：`statusPage.enabled`（默认 `false`）

**问题**

SaaS 上线后出故障是必然的。用户第一反应是"我的问题还是你的问题？"——一个 status page 回答这个问题。当前模板有完整的可观测性基础设施（OTel、Sentry、结构化日志、admin metrics），但缺少面向用户的"现在系统怎么样"的展示窗。竞品没有一个提供内置 status page。

**做**

- `site.config.ts` 新增 `statusPage` 段：
  ```typescript
  statusPage: {
    enabled: boolean; // 默认 false
    mode: "manual" | "auto"; // 默认 "manual"
    components: Record<
      string,
      {
        label: string; // 展示名（如 "API"、"Database"、"AI Provider"）
        description?: string;
        healthUrl?: string; // auto 模式下的 health check URL
      }
    >;
    historyDays: number; // 默认 30，展示最近 N 天的 uptime 和 incident
  }
  ```
- `src/core/status/`：
  - `statusStore`：当前状态存储。v1 用 `status_events` 表（component、status（operational/degraded/outage）、message、createdAt、resolvedAt），admin 通过管理页修改
  - `getComponentStatus(component)`：当前状态（最近一条未 resolved 的事件 → degraded/outage，否则 operational）
  - `getUptime(component, days)`：最近 N 天的 uptime 百分比
  - `healthCheck(healthUrl)`：auto 模式下的定时检查。v1 在 `/status` 页面渲染时同步检查（不引入 cron）；检查超时 5s，失败两次后自动记为 degraded
- `/status` 页面（`src/app/[locale]/(marketing)/status/`）：
  - 顶部：整体状态横幅（All systems operational / Some systems degraded / Major outage）
  - 主体：每个 component 一行（label、当前状态 badge、最近 30 天 uptime bar）
  - 底部：近期 incident 时间线（按时间倒序）
  - 可选：邮件订阅通知（输入邮箱 → 写入 `status_subscribers` 表 → 发生 outage 时 Resend 群发）
- 后台管理页（`src/app/[locale]/(app)/admin/status/`）：
  - 创建 incident（component、status、message）
  - 更新 incident（改状态或追加更新）
  - 解决 incident（填 resolvedAt）
  - 查看订阅者列表
- 设计：营销面语域的变体——status page 用干净、一目了然的布局，不是营销色带；沿用 `--primary` 用于绿色状态视觉锚点
- 邮件通知做简单聚合：同一个 incident 的创建和更新在 5 分钟内合并发送，避免用户在短时间内收到多封邮件

**不做**

- 第三方监控集成（PagerDuty/Opsgenie/Datadog）、自定义域名 status 页、API 触发 incident 创建
- 自动模式下的分布式 health check（cron job 从多地域检查）
- 订阅者 SMS/Webhook 通知
- uptime 可视化图表（v1 文本百分比足够）、SLA 计算

**验收**

- [ ] 管理员在后台创建一个 incident（component: "API"、status: degraded、message: "Elevated latency"）→ `/status` 页面显示 "Some systems degraded" 横幅、API 行显示 degraded badge
- [ ] 管理员解决该 incident → `/status` 显示 "All systems operational"
- [ ] 最近 30 天 uptime 百分比正确（按 component 分别计算）
- [ ] `mode: "auto"` 时对一个不存在的 healthUrl → 连续两次后自动 degraded
- [ ] `statusPage.enabled: false` 时 `/status` 404
- [ ] 375px 亮暗两套不横向溢出
- [ ] 邮件订阅：输入邮箱 → 收到确认 → incident 创建后收到通知

**测试**

- Vitest：`getComponentStatus`、`getUptime` 计算正确性、health check 超时处理、邮件合并发送逻辑
- e2e：admin 创建 incident → 访客访问 `/status` → 看到横幅和 degraded badge → admin 解决 → 访客刷新看到绿色全正常
