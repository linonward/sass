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
- 补充（合入后追加）：支持阿里云百炼（`provider: "alibaba"`，`@ai-sdk/alibaba`），`ALIBABA_BASE_URL` 切地域；模型配置加可选的 `reasoning`，可以关掉默认开启的思考
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

---

## T404 ai-image

- 分支 / worktree：`feat/ai-image` → `../sass-ai-image`
- 依赖：T402、T403
- 外部依赖：支持图片生成的服务商 key（阿里云百炼、OpenAI 或 Google），Cloudflare R2

**做**

- 在配置中加入 `ai.imageModels`：`[{ id, provider, model, creditCost }]`，以及 `ai.defaultImageModel`
- 百炼的图片模型（`qwen-image-*`、`wan*-image*`）没有 AI SDK 实现，按 `ImageModelV4` 接口写一个适配器，调百炼原生接口
- 服务端封装 `runImage({ userId, modelId, prompt, aspectRatio })`：登录 → 限流（`ai` 策略）→ 预扣积分并写 `ai_usage` → `generateImage` → 存 R2 并写 `files` → 失败退款。与 `runAI` 共用预扣和结算
- `ai_usage` 加 `kind`（`text` / `image` / `video`）、`prompt`、`file_id`，用来列出用户的生成记录
- 接口：`POST /api/ai/image`（同步返回图片地址）、`GET /api/ai/generations`（当前用户最近的生成记录）
- Playground 加「图片」标签页：选模型和画幅、输入提示词、显示结果和最近生成

**不做**：图片编辑 / 局部重绘、一次生成多张、按尺寸计费

**验收**

- [ ] 生成一张图扣除配置中的积分，图片存进 R2，`ai_usage` 和 `files` 有记录
- [ ] 模型报错或存储失败时积分退回
- [ ] 刷新页面后最近生成仍然能看到

**测试**：Vitest 用 `MockImageModelV4` 和内存存储覆盖成功、余额不足 402、模型失败退款、存储失败退款、超限 429；适配器用 stub fetch 覆盖请求格式和地域；真实模型做人工验证

---

## T405 ai-video

- 分支 / worktree：`feat/ai-video` → `../sass-ai-video`
- 依赖：T404
- 外部依赖：阿里云百炼（通义万相视频模型），Cloudflare R2

**做**

- 在配置中加入 `ai.videoModels`：`[{ id, provider, model, creditCost, duration, resolution }]`，按次固定扣费，时长和分辨率由配置固定
- 异步任务：`POST /api/ai/video` 预扣积分、用 `experimental_startVideo` 提交任务，把任务信息记在 `ai_usage`；`GET /api/ai/video/:id` 查询状态，完成后把视频转存 R2，失败或超时退款
- 文生视频和图生视频：首帧可以是上传的图片或 T404 生成的图片（`files` 里的记录）
- Playground 加「视频」标签页：提交后轮询状态，最近生成里显示视频

**不做**：尾帧 / 参考视频、webhook 回调、后台定时扫描未完成的任务（只在查询时推进）

**验收**

- [ ] 提交任务扣积分，完成后视频存进 R2，`ai_usage` 状态为 `succeeded`
- [ ] 任务失败或超时时积分退回，只退一次
- [ ] 用生成的图片做首帧能生成视频

**测试**：Vitest 用 `MockVideoModelV4` 覆盖提交、进行中、完成转存、失败退款、超时退款、重复查询不重复结算；真实模型做人工验证
