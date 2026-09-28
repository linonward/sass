# 阶段 17：审计收尾

审计（2026-09-28 全项目审计）发现的剩余缺口，按优先级挑了 4 个值得修的。

## 依赖

全部独立，无相互依赖。可以并行开 4 个 worktree。

```
T1701 ─┐
T1702 ─┤  全部可并行
T1703 ─┤
T1704 ─┘
```

## 任务

### T1701: auth server + OTP 单测
- **topic**: `auth-tests`
- **分支**: `fix/auth-tests`
- **范围**: `src/core/auth/server.ts` + `src/core/auth/errors.ts`
- **做什么**:
  - 给 `server.ts` 里 Better Auth 配置写单测：插件顺序、emailOTP 参数、admin plugin 行为
  - 给 `sendVerificationOTP` 回调写单测：cooldown-reset-on-failure 逻辑（`server.ts:207-210`）
  - 给 `session.create.after` / `user.create.after` hook 写单测：admin promotion、lead linking、referral binding
  - 给 `src/core/auth/` 下已有的纯函数（routes、cooldown、locale）补齐边界用例
- **验证**: `pnpm test -- --coverage`，auth 模块覆盖率从当前提升

### T1702: instrumentation + 启动逻辑单测
- **topic**: `instrumentation-tests`
- **分支**: `fix/instrumentation-tests`
- **范围**: `src/instrumentation.ts` + `src/instrumentation-client.ts` + `src/core/ratelimit/startup.ts`
- **做什么**:
  - 给 `register()` 里条件加载 OTel / Sentry 的逻辑写单测
  - 给 `onRequestError` 的 Sentry 转换写单测
  - 给 `src/core/ratelimit/startup.ts` 的启动检查写单测：「生产环境缺 Redis → loud error log」
  - Mock `@sentry/nextjs`、`@opentelemetry/*` 避免真连外部服务
- **验证**: `pnpm test -- --coverage`，启动路径覆盖率不为零

### T1703: 安全敏感操作触发 session 失效
- **topic**: `session-invalidation`
- **分支**: `feat/session-invalidation`
- **范围**: `src/core/auth/server.ts` + `src/core/account/`
- **做什么**:
  - 用户修改邮箱验证状态后，失效所有已有 session（better-auth 支持 `secondaryStorage` 或 `session.allowedSubset`）
  - 账户删除后（`src/core/account/on-user-delete.ts`）确保 session 全部清掉（目前依赖数据库清理，确认行为后补注释或补逻辑）
  - 如 better-auth 1.7.6 不支持直接 invalidate-all，至少文档里写清楚当前行为，留 `ADR`
- **验证**: e2e：改邮箱后旧 session 不能再访问 `/dashboard`

### T1704: CI 依赖审计
- **topic**: `ci-dep-audit`
- **分支**: `chore/ci-dep-audit`
- **范围**: `.github/workflows/ci.yml`
- **做什么**:
  - CI 加 `pnpm audit`（或 `pnpm audit --audit-level=high`）step
  - 当前有已知漏洞则先修再开闸
  - 确认 Dependabot 每周还在跑、PR 自动 merge 策略合理
- **验证**: CI 通过；`pnpm audit` 不报 high/critical

## 完成后

- 审计 backlog 清空（C1–S7 全部处理完毕）
- 覆盖率在几个关键模块（auth、proxy、instrumentation）从零拉到有
- 安全敏感操作有防御深度