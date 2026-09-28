# 阶段 20：审查收口（二）

阶段 18（支付商扩展）落地后留下两个**当时没开卡**的缺口。都不是新功能，都是「照仓库现有代码 / 文档走会踩到」的坑 —— 一个在源码里（只在慢水合时现形，CI 抓不到），一个在 `docs/workflow.md` 的命令里（照抄就假红，两个 fork 都踩了）。

依据：阶段 18 收尾时对本地 e2e 失败的复现（`e2e/pricing.spec.ts` 的失败追到 `src/core/auth/sign-in-form.tsx`），以及 T1801 / T1802 两个 fork 各自报告里「照 `docs/workflow.md` 跑 e2e 假红」的记录。

## 批次

- **T2001**（产品代码 + e2e）与 **T2002**（只改文档）改动面不重叠，但都要动 `docs/tasks/README.md` 的任务表 —— 按老规矩串行：T2001 先合，T2002 rebase 到新 `main` 后再合。
- 两个都做完本阶段即结束；下面「待定」里那个同类的表单不在本阶段范围。

---

## T2001 signin-hydration

- 分支 / worktree：`fix/signin-hydration` → `../sass-signin-hydration`
- 依赖：—

**问题**

`src/core/auth/sign-in-form.tsx` 的邮箱表单只有 `onSubmit`、**没有 `action`**，提交按钮在 SSR 里是 `disabled={pending}`（`pending` 初值 `false` → 可用）。水合完成前点「发送验证码」或在邮箱框回车，浏览器走的是**原生表单 GET**：地址栏被整个换成 `/sign-in?email=…`，`callbackURL` 就此丢失 —— `sign-in/page.tsx` 的「带了 callbackURL 一律先去目标页」规则失效，从受保护页面或邀请链接过来的用户登录后落到引导页。

本地 dev 稳定复现（关 JS 时地址栏就是）：

```
http://localhost:3300/sign-in?email=hydration%40example.com
```

CI 跑的是生产构建、水合快，**命中不到** —— 所以 CI 全绿也在掩盖它。这一点要写进 PR 的「测试方式」一栏：新用例必须能证明它在修之前是红的。

**做**

- 给提交按钮加 hydration 守卫：`disabled={!hydrated || pending}`。`hydrated` 用 `useSyncExternalStore` 取（服务端快照 `false`、客户端快照 `true`；取法同 `src/core/hooks/use-mobile.ts`）—— SSR 与首帧一致，不会水合失配；**不要**写成 `useState` + `useEffect(() => setHydrated(true), [])`，那正是这次踩到的 `react-hooks/set-state-in-effect`（仓库 lint 把它当 error 拦下）。禁用提交按钮能同时挡掉**点击**和**回车（表单的隐式提交）**两条原生路径。
- **不要**改成禁用 `Input`：那会丢掉 `autoFocus`（用户进页面就得先自己点一下输入框）。
- 验证码那一步的按钮同样补上 `!hydrated ||`：它现在靠 `code.length !== otp.length` 恰好也是禁用状态，把不变式写全，免得以后那条长度规则一改就重新引入同一个洞。
- 回归用例放 `e2e/auth.spec.ts`，用 `test.use({ javaScriptEnabled: false })`（关 JS = 「永远没水合」；仓库先例是 `e2e/ui-shell.spec.ts` 的 404 元数据那一节）：断言 hydration 前提交按钮是禁用的，且提交邮箱后地址栏仍带 `callbackURL`。
- `e2e/auth-helpers.ts` 的 `requestCode` 里那个「重复填写并发送」的 `toPass` 循环，`click` 要补上界（`timeout: 1000`，同文件 `openUserMenu` 的既有注释）：提交按钮现在多了一个「水合完成前禁用」的状态，而配置里没有 `actionTimeout` —— 一次点击会一直等到用例超时（30s），把 `toPass` 的预算一把耗光，慢水合的环境（i18n 副本、冷启动的 dev server）上就变成失败。属防御性改动，不是本缺陷的一部分。

**不做**

- 给表单加 `action`：那需要服务端也渲染一份能用的降级表单，收益不抵改动面。
- 把 `callbackURL` 放进隐藏字段：规则判在服务端，原生 GET 会把 query string 整个换掉，隐藏字段只是换个形式丢。

**验收**

- [ ] 关 JS 下提交邮箱后地址栏仍带 `callbackURL`；新用例在改动前红、改动后绿（两次输出贴进 PR）
- [ ] `pnpm test`、`pnpm typecheck && pnpm lint && pnpm format:check` 全绿
- [ ] 本地 e2e 全绿（用 CI 等价 env，即 T2002 要补进 `docs/workflow.md` 的那份命令）

---

## T2002 e2e-env-docs

- 分支 / worktree：`docs/e2e-env` → `../sass-e2e-env`
- 依赖：T2001（同一个 PR 会改 `docs/tasks/README.md`）

**问题**

`docs/workflow.md` 的「本地跑 e2e」命令只给了 `EMAIL_TRANSPORT` / `E2E_PORT` / `ADMIN_EMAILS`，正文那句「CI 通过 workflow 的 env 提供」把差异一笔带过，读者不会意识到本地要自己补。两类假红：

- **billing**：不带 `BILLING_PROVIDER=fake` 时站点按 `site.config.ts` 里的真实服务商启动（结账入口拿不到，或报 `plan_not_configured`）；`CREEM_PRODUCT_ID_*` 与 `BILLING_SUCCESS_TIMEOUT_MS` 缺任何一个都会红。阶段 18 的两个 fork 都踩了。
- **站点身份**：`e2e/onboarding.spec.ts` 的 `placeholdersGone` 按「出厂占位值还在不在」分叉断言，而 `SITE_NAME` / `SITE_DOMAIN` / `SITE_LEGAL_NAME` / `SITE_EMAIL_FROM` 与 `CREEM_PRODUCT_ID_*` 是一组 —— **只设一半**（例如设了产品 ID、没设 `SITE_NAME`）两边都不成立：清单里定价那步已经是 done，断言却按「占位值还在」算。T2001 落地时实测撞到过。

**做**

- 把 `ci.yml` 里那组变量**整组**补进命令（billing + `SITE_*`），并加 bullet 说明为什么不能省、也不能只抄一半（省了是假红，抄一半是自相矛盾的断言）。
- 顺带核对这份命令与 `ci.yml` 还有没有别的差异（例如 `ALLOW_FAKE_BILLING`、`ALLOW_UNRATELIMITED`、`ALLOW_NON_RESEND_EMAIL` —— 这三条是给生产构建的，本地 dev 用不上），逐条对齐或写明为什么本地不需要。

**不做**：改 `playwright.config.ts` 去兜默认值 —— 那会把「本地与 CI 用不同环境」这件事藏起来，以后再假红更难查。

**验收**

- [ ] 在一个干净 worktree 里，照 `docs/workflow.md` 的原样命令跑 `npx playwright test`，全绿
- [ ] `pnpm format:check` 绿

---

## 明确不修 / 待定

- **`src/core/acquisition/leads/form.tsx` 是同一类缺陷**：客户端 `onSubmit`、`name="email"` / `website` / `consent` 都是真字段、提交按钮 hydration 前可用。水合前提交同样走原生 GET，把落地页地址栏换成 `/?email=…` —— 冲掉 `?ref=` / `utm_*` 归因参数（阶段 13 的获客链路正靠它），并把邮箱写进浏览器历史。**本阶段不动**（本轮只收两个缺口）：T2001 合入后可照同样的守卫单开一张卡。
- **三个 AI 表单现在不可利用**：`playground.tsx` / `video-studio.tsx` / `image-studio.tsx` 的提交按钮是 `disabled={busy || !prompt.trim()}`，SSR 时输入为空 → 本来就是禁用的。但它们没有 `name=` 字段，一旦有人去掉「空输入禁用」这条规则就会变成同一类问题。记在这里，不单独立卡。
- **其余表单都带 `action=`**（Server Action 或 GET 搜索），原生提交是设计内行为，不受影响 —— 这也是为什么这个坑只出现在 `onSubmit` 的那几个上。
- **本地 e2e 的既有 flake（超时/竞态类，本阶段不修）**：`i18n` project 在 6 worker 下压冷启动的 i18n 副本 dev server 时会超时（`e2e/i18n/auth.spec.ts` 两条 + `e2e/i18n/locale.spec.ts:12`）；desktop / mobile 也会零星出现竞态类失败 —— 实测踩到 `e2e/admin.spec.ts:117` 的余额告警、`e2e/dashboard.spec.ts:96` 的删号跳转、`e2e/pricing.spec.ts:56` 的结账页（都是「等元素出现」的 5s 超时），以及 `e2e/changelog.spec.ts:57`（点页脚链接做客户端跳转时，`<head>` 里新旧两个 canonical 并存，strict mode 冲突 —— 属于 `next dev` 下的客户端导航竞态）。判定依据：**把 T2001 的源码改动 stash 掉跑同一套，同样红**（3 条，含同一条 admin 用例），与本次改动无关；单跑失败的那条文件稳定绿。CI 跑生产构建、首屏与水合都快，命中不到。这条与 `docs/workflow.md` 的命令无关，T2002 不必处理。
