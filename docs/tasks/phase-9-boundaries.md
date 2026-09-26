# 阶段 9：错误路径与边界

阶段完成后：**任何**错误路径（404、500、权限不足、错误方法）都返回正确的状态码，并渲染模板自己的品牌化界面；这些行为被 e2e 锁住，不会在后续改动里悄悄退化。

依据：2026-09-26 的错误路径审计（Next 16.3.6 自带文档 + `node_modules/next/dist/` 源码逐条对照、运行时探针、e2e 覆盖盘点）。审计结论是**这条轴整体健康**——错误边界三层各就各位且都是真 500、404 是真 404 并带 `noindex`、10 个恶意输入零 500、权限模型自洽无缺口。问题集中在两处：**走非主流路径时 404 会退化成框架默认页**，以及**错误页的元数据没做对**。

## 批次

- **批次 A（用户可见缺陷）**：T902、T903。
- **批次 B（防退化）**：T904（测试）、T905（文档）。

T904 依赖 T902 与 T903 —— 它要锁的是修好之后的行为。T902 与 T903 互不依赖，可并行开 worktree。

---

## T902 not-found

- 分支 / worktree：`fix/not-found` → `../sass-not-found`
- 依赖：—
- 依据：审计 F1（三路交叉：浏览器实测 + proxy matcher 11/11 相关性 + 文档推导）

**问题**

全站有**两套 404**，分界线与 `src/proxy.ts` matcher 的排除集（`api|trpc|_next|_vercel|opengraph-image|monitoring|.*\..*`）11/11 完全重合：

| 路径                               | 状态码 | 渲染                                                         |
| ---------------------------------- | ------ | ------------------------------------------------------------ |
| `/does-not-exist`（过 proxy）      | 404    | 模板自己的本地化 404（`Page not found` + `Back to home`）    |
| `/missing.png`、`/foo.bar`（含点） | 404    | **Next 内置默认页**（`404 / This page could not be found.`） |
| `/api/nope`                        | 404    | 同上，且 `Content-Type: text/html`                           |

机制：matcher 排除的路径不经 next-intl 重写，`[locale]` 吞掉 `"missing.png"`，`src/app/[locale]/layout.tsx:49` 的 `hasLocale` 失败并在 **root layout 里**抛 `notFound()`。而 `not-found.tsx` 是**同段 layout 的子节点**，接不到 layout 自己抛的错；仓库又没有根级 `app/not-found.tsx`，于是退到框架默认页。状态码仍是真的 404、`noindex` 也在，所以**SEO 无碍**，丢的是品牌色、主题、本地化和「回首页」这个唯一出路。

**做**

- **先实测修法，别照文档直接写。** 两条候选，在本仓库「root layout 落在 `[locale]` 动态段」的结构下**都还没被验证过**：
  1. 新增根级 `src/app/not-found.tsx`
  2. 开 `experimental.globalNotFound` + 新增 `src/app/global-not-found.tsx`（文档给这个形态的官方解法，`next.config.ts` 当前没开）
- 让 `hasLocale` 失败这条路径也渲染模板自己的 404
- 决定并实现 API 路径的 404 形态：统一品牌化 HTML，还是给 `/api/*` 单独返回 JSON 404（现状返回 `text/html`，调 API 的人会拿到一整页 HTML）
- 若 `[...rest]/page.tsx` 需要跟着挪位置，一起处理 —— 它靠 `notFound()` 喂给 `[locale]/not-found.tsx`，单独挪 `not-found.tsx` 会让它找不到文件

**不做**：改 `proxy.ts` 的 matcher（除非实测证明必须）；给 `forbidden`/`unauthorized` 建边界（见 T905）

**验收**

- [ ] `/missing.png`、`/foo.bar` 与 `/does-not-exist` 的 404 界面一致（或 `/api/*` 明确返回 JSON 404）
- [ ] 三条路径仍是真 404 状态码 + `noindex`（别为了统一把状态码弄成 200）
- [ ] `pnpm test` + `pnpm build` + e2e 全绿

**测试**：**必须用真浏览器断言文案，不能只 curl 或只断状态码**。404 的界面是客户端渲染的（Next 的 http-access-fallback 边界是 client boundary），curl 拿到的静态 HTML 只有空壳 —— 这正是本条缺陷先前被盖住的原因（`e2e/ui-shell.spec.ts` 对 `/missing.png` 只断言了状态码）。e2e 用例与 T904 协调。

---

## T903 error-metadata

- 分支 / worktree：`fix/error-metadata` → `../sass-error-metadata`
- 依赖：—
- 依据：审计 F2、F3、F6、F8、F9

**做**

- `src/app/[locale]/not-found.tsx`：把 React `<title>` 换成 `metadata` / `generateMetadata` 导出。Next 对 not-found 有**专门的 metadata 采集路径**（`lib/metadata/metadata.js` 在 HTTP access fallback 时改调 `getNotFoundMetadata`，convention 记为 `'not-found'` 且排最后，会覆盖 layout 的），而 `not-found.tsx` 是服务端组件，本来就能用 metadata 导出；React `<title>` 是给 **client 边界**（`error.js` / `global-error.js`）的替代方案，用在这里选错了工具。
  现状代价可测量：**关 JS 时 404 的静态 `<title>` 是站名**，只有水合之后才变成 `Page not found`。
- `src/app/[locale]/error.tsx`：补 React `<title>`（client 边界按文档只能用这个）。它现在**完全没做标题处理**，出错时标题停在被替换掉的那页。`global-error.tsx` 已经是正确样例。
- `src/app/global-error.tsx` 的 `<html lang="en">`：加注释说明「买家加语言后需处理」，或改读 `Accept-Language`。今天 `locales: ["en"]` 正确，但 `e2e/i18n/serve.ts` 会把 `"de"` 追加进 locales 真跑一遍 —— 多语言机制是活的，这不是假想场景。
- 在 `not-found.tsx` 留一行注释：**无 JS 时 404 是空白页**（client 边界的固有行为，`<div hidden>` 空壳），不是模板坏了。否则买家会以为是 bug。
- `src/app/[locale]/layout.tsx` 把 `path` 写死成 `"/"`，导致 404 的 `canonical` 与 `og:url` 都指向首页。有 `noindex` 兜底、对搜索无影响，顺手修更好，不修则记录。

**不做**：给 `global-error.tsx` 接 next-intl（它替换整个 root layout，拿不到 `NextIntlClientProvider`，是框架约束不是懒）

**验收**

- [ ] 关 JS（Playwright `javaScriptEnabled: false`）时，404 的静态 HTML `<title>` 是本地化标题而非站名
- [ ] 错误页有明确的页面标题
- [ ] `pnpm test` + e2e 全绿

**测试**：Playwright 关 JS 断言 title；其余靠现有 e2e。用例与 T904 协调。

---

## T904 error-e2e

- 分支 / worktree：`chore/error-e2e` → `../sass-error-e2e`
- 依赖：T902、T903
- 依据：审计 F5（三个缺口）

**做**

- **错误边界覆盖（当前为零）**：`grep -rn "Something went wrong|Try again|digest|retry" e2e/` 只命中 `auth.spec.ts` 里一个 `retry-after` 响应头，与错误边界无关。需要一个能故意抛错的路径（`?boom=1` 之类的测试钩子，或专用的探针路由）+ 断言 `error.tsx` 的文案与 `Error ID` 可见。
- **补上 404 的 `<title>` 与 `noindex` 断言。** 注意别误以为已有：`e2e/i18n/blog.spec.ts` 里那个 `noindex, nofollow` 来自 `src/core/seo/metadata.ts` 的 `noIndex` 参数（空语言 blog 列表页），跟 404 注入的**是两套机制**。
- **修掉「只断状态码」的用例**：`e2e/ui-shell.spec.ts:88-96` 的两条（`/zh`、`/missing.png`）补文案断言 —— 正是它们盖住了 T902 的缺陷。用例名「被 proxy 跳过的带扩展名路径也返回 404」说明作者知道 proxy 会跳过，所以这是真缺口而非冗余测试。

**不做**：视觉回归快照

**验收**

- [ ] 错误边界至少一条用例，失败时能指出是哪一层边界出的问题
- [ ] `/missing.png`、`/zh` 的用例断言文案而不只是状态码
- [ ] CI 全绿

**测试**：本任务即测试。本地跑法见 [../workflow.md](../workflow.md)（`EMAIL_TRANSPORT=file`、`E2E_PORT` 必须设，否则会复用你正在跑的 dev server 测错代码）。

---

## T905 boundary-notes

- 分支 / worktree：`docs/boundary-notes` → `../sass-boundary-notes`
- 依赖：—
- 依据：审计 F7、F9

**做**

- 在 README / starter guide 写明 **`forbidden()` / `unauthorized()` 在本模板当前不可用**：`next.config.ts` 没开 `experimental.authInterrupts`，所以这两个 API 现在写下去也不会工作 —— 这不是「少两个文件」。要用必须同时开开关 + 建 `forbidden.tsx` / `unauthorized.tsx`，且**不能在 root layout 里调**（本仓库的 root layout 是 `src/app/[locale]/layout.tsx`）。两个文件在 16.3.6 仍是 experimental。
- 写明权限模型的分野是**有意的**：页面用 404 / 307、API 用 401、Server Action 返回状态对象、错方法 405。浏览器要 UX，API 调用方要机器可读。买家看到 admin 返 404 不跳登录页时不该以为是 bug。
- 写明**警告**：在 `notFound()` 路径的**上方**加 `loading.tsx` 或 `<Suspense>`，会把真 404 变成 **200 软 404**（响应头已发出，状态码改不了），靠 `noindex` 兜底。现在全站是真 404 的唯一原因就是没有任何东西在流式（零 `loading.tsx`、零 `<Suspense>`）。
- 写明 `(app)` / `(admin)` 的 layout 自己 `await headers()`，**没有 Cache Components 时 `loading.tsx` 不会为它显示 fallback**（「Navigation blocks until the layout finishes rendering」）。想加 instant loading 得用 `<Suspense>` 或把取数下移到 page。

**不做**：真的启用 `authInterrupts`

**验收**

- [ ] 上述四条能在 README / starter guide 里查到
- [ ] CI 全绿（无代码改动）

**测试**：无代码改动
