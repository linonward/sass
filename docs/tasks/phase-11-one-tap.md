# 阶段 11：登录体验（Google One Tap）

阶段完成后：进登录页即弹出 Google 账号提示，点一下头像就完成登录，不再整页跳去 Google 再跳回来；没配 Google 凭据时（本地、CI、Vercel 预览）行为与现在完全一致。

依据：2026-09-26 提出「增加 Google one step 登录」。现状是整页跳转的 OAuth（`src/core/auth/server.ts` 的 `socialProviders.google`），One Tap 把「跳走再回来」压缩成「点一下」。`better-auth@1.7.6` 自带 `one-tap` 插件，**不引入新依赖**。

范围：只做登录页。营销页不加载 Google 脚本（性能、隐私、CSP 面都更小）。

---

## T1101 one-tap

- 分支 / worktree：`feat/one-tap` → `../sass-one-tap`
- 依赖：T203（auth）
- 外部依赖：Google Cloud OAuth Client —— **同一个 client 的 Authorized JavaScript origins 必须登记**。README 上线清单第 4 节一直列着这一项，但对跳转式 OAuth 可有可无，One Tap 让它变成必需。

**做**

- 服务端：凭据齐全时注册 better-auth 的 `oneTap` 插件（`clientId` 与 `socialProviders.google` 同值）；`/one-tap/callback` 加进 `rateLimit.customRules` —— 该端点不用登录就能打，且每次调用都会实时拉 Google 的 JWKS 验签（better-auth 没有缓存）。
- 客户端：`src/core/auth/one-tap.ts` 按需创建客户端实例并缓存。共享 `authClient` 挂不了这个插件（插件列表是模块级静态的，clientId 只有运行期才知道），「是否启用」仍由服务端 `googleClientId()` 一处判断，作为 prop 传下来。挂 `autoSelect: false`、`context: "signin"`，并复用 `LOCALE_HEADER` 钩子，让 One Tap 首次注册的欢迎邮件跟着界面语言。
- 登录页：进页面触发一次提示（`useRef` 守卫，StrictMode 会跑两次 effect）；`SignInForm` 的 `googleEnabled: boolean` 收敛成 `googleClientId: string | null`，按钮与提示同源，不会各判一次。
- CSP：Google 启用时放行 GIS 的脚本、样式、服务端点和提示 iframe；`frame-src` 必须带 `'self'`（它一旦出现就取代 `default-src` 对 frame 的回落）。
- 文档：README「登录（Google）」补 JavaScript origins 的作用与失败症状。

**不做**

- 落地页与其他公开页（只登录页）。
- 提示文案跟随站点语言：GIS 加载器硬编码脚本 URL，不支持 `hl`，提示语言跟随浏览器/Google 账号。
- 登出时调 `google.accounts.id.disableAutoSelect()`：`autoSelect` 已关，不会有静默重登。
- GIS 渲染的 Google 按钮：品牌样式没法进设计系统，自绘按钮保留。
- 预览部署启用 Google：预览地址每次不同，仍是邮箱验证码登录。
- `nonce`：服务端 `verifyGoogleIdToken` 不校验它，写了不构成重放保护。

**验收**

- [ ] 配了 Google 凭据时，进 `/sign-in` 弹出 One Tap；点头像后落在 `callbackURL`（默认 `/dashboard`）且是登录态
- [ ] 没配凭据（本地无 key、Vercel 预览、CI）时不加载 GIS 脚本、不弹提示，登录页与现在完全一致
- [ ] One Tap 首次注册：欢迎邮件语言跟随界面语言，注册事件与 OAuth 一致
- [ ] 同一邮箱先用验证码注册、再用 One Tap 登录，进入同一个账户
- [ ] 回调失败时登录页显示错误，邮箱验证码与 Google 按钮照常可用
- [ ] 登出后不会被 Google 会话静默送回登录态
- [ ] CSP 含 GIS 的四个源；未启用时一个都不出现，且不下发 `frame-src`
- [ ] 真浏览器访问 `/sign-in` 无 CSP 违规

**测试**

- 单测：`src/core/security/headers.test.ts`（启用 / 未启用 / 预览三态）、`src/core/auth/one-tap.test.ts`（叶子守卫 + 接线 + 实例缓存）、`src/core/auth/env.test.ts`。
- e2e：`e2e/sign-in-one-tap.spec.ts`（stub GIS，**只在本地跑** —— CI 没有凭据，而 CSP 是构建期算的，脚本请求根本发不出去）、`e2e/auth.spec.ts` 的无凭据用例顺带断言不加载 GIS 脚本。
- 人工（成功路径无法自动化：服务端要用 Google 的 JWKS 实时验签，假 token 只能得到失败）：真实 Google 账号在 `http://localhost:3000`（该 origin 需登记）走通一次；生产 https 域名再走一次。

**已知限制**

- **未登记 origin 时完全静默**：提示不出现，也没有任何报错，只有 console 里的 `The given origin is not allowed for the given client ID`。开发环境会额外打印 `getNotDisplayedReason()`，生产不打印（避免噪音）。
- 提示是 Google 品牌 UI，不能主题化，也不跟随站点的明暗主题。
- 插件有一个模块级的「调用中」标志，只在 GIS 回调通知时复位；GIS 若从不通知（官方承认的抑制路径），同一 tab 里后续进入登录页不再弹提示（只 `console.warn`），按钮和验证码不受影响。
- 登出后停在登录页可能再次看到提示 —— 这是预期行为；`autoSelect: false` 保证的是不会被静默重登。
