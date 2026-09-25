# 阶段 4：AI 工具

阶段完成后：可以做 AI 工具站。

---

## T401 ratelimit

- 分支 / worktree：`feat/ratelimit` → `../sass-ratelimit`
- 依赖：T102
- 外部依赖：Upstash Redis

**做**

- 接入 `@upstash/ratelimit` 和 `@upstash/redis`
- `src/core/ratelimit/`：`checkRateLimit(policy, identifiers)`，返回 `{ ok, retryAfter }`；另提供 `rateLimitResponse()`，生成带 `Retry-After` 头的 429 响应
- 在配置中加入 `rateLimit`：
  - `failMode`：`"open"` 或 `"closed"`，默认 `"open"`
  - `policies`：按名称定义滑动窗口，例如 `ai: 20/min`、`upload: 10/min`
  - 每条策略同时按用户和按 IP 计数
- env 校验：生产环境开启了 `ai` 或 `upload` 时，强制要求 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`
- 本地未配置 Redis 时跳过限流，并打印一次警告
- Redis 出错时的行为：`open` 放行并记录错误日志，`closed` 返回 503

**不做**：登录限流（由 Better Auth 负责）、缓存、队列

**验收**

- [ ] 超过阈值返回 429，并带上 `Retry-After`
- [ ] Redis 不可用时，按 `failMode` 执行

**测试**：Vitest 模拟 Redis，覆盖超阈值、Redis 异常时 open 和 closed 两种行为、本地跳过、生产环境缺少 env

---

## T402 ai

- 分支 / worktree：`feat/ai` → `../sass-ai`
- 依赖：T302、T401、T203
- 外部依赖：至少一个 AI 服务商的 key

**做**

- 接入 Vercel AI SDK，使用 provider registry：支持 OpenAI、Anthropic、Google 三家，env 里有哪家的 key 就启用哪家
- 在配置中加入 `ai.models`：`[{ id, provider, model, creditCost }]`，以及 `ai.defaultModel`
- 服务端封装 `runAI({ userId, modelId, ... })`，按顺序执行：
  1. 检查登录
  2. 限流（`ai` 策略）
  3. 预扣 `creditCost`（余额不足返回 402）
  4. 调用模型
  5. 失败时调用 `refundCredits`
- 新增表 `ai_usage`：用户、模型、输入 token、输出 token、积分、状态、耗时
- 示例路由 `POST /api/ai/chat`，支持流式输出
- Dashboard 中加一个示例 Playground 页面，由 `features.ai` 控制是否显示

**不做**：按 token 计费、对话历史存储、RAG

**验收**

- [ ] 调用一次扣除配置中的积分，`ai_usage` 有记录
- [ ] 模型报错时积分退回，流水中能看到对应的 refund

**测试**：Vitest 用 AI SDK 的 mock 模型，覆盖成功、余额不足 402、模型失败退款、超限 429；真实模型做人工验证

---

## T403 upload

- 分支 / worktree：`feat/upload` → `../sass-upload`
- 依赖：T401、T203
- 外部依赖：Cloudflare R2

**做**

- 用 `@aws-sdk/client-s3` 和 `@aws-sdk/s3-request-presigner` 对接 R2
- 在配置中加入 `upload`：允许的 MIME 类型、单个文件大小上限、是否公开访问
- 接口：
  - `POST /api/upload/presign`：需要登录，走 `upload` 限流，校验类型和大小，返回预签名 PUT 地址
  - `POST /api/upload/complete`：确认上传，把文件状态改为 `uploaded`
- 新增表 `files`：`user_id`、`key`、`size`、`mime`、`status`（`pending` / `uploaded`）
- 对象 key 的格式：`<userId>/<yyyy-mm>/<uuid>.<ext>`
- 私有文件通过签名 GET 地址访问
- 在 env 中加入 R2 的 account id、key、secret、bucket、公开域名

**不做**：图片处理和压缩、清理 `pending` 文件的定时任务

**验收**

- [ ] 浏览器能直接上传文件到 R2，数据库状态正确
- [ ] 超过大小或类型不允许的文件，在预签名阶段被拒绝

**测试**：Vitest 覆盖类型校验、大小校验、key 的格式；真实上传做人工验证
