# 阶段 10：渲染与包体积

阶段完成后：每个页面的首屏 JS 不含意外重量（配置 schema 不再进浏览器）；AI 页的流式输出不再阻塞输入；tab 按需加载。

依据：2026-09-26 的 Vercel 70 条 React/Next 最佳实践审计（静态 import 图闭包 + 生产构建产物逐 chunk 实测 + 运行时验证）。审计结论是**这个仓库整体很干净**——鉴权、`after()` 副作用、Sentry 的构建期开关、模块级状态、`optimizePackageImports` 全部已合规或不需要。真正的问题只有下面四条，其中第一条是本次审计最重的一处。

## 批次

- **批次 A**：T1001。单条收益最大（每页 −92 KB gzip）且完全独立。
- **批次 B**：T1002、T1003。都落在 `src/core/ai/playground*`，同一个区域，建议顺序做（T1003 会动 T1002 改过的文件）。
- **批次 C**：T1004。两处小修，随时可做。

---

## T1001 config-leaf

- 分支 / worktree：`fix/config-leaf` → `../sass-config-leaf`
- 依赖：—
- 依据：审计 P0（静态分析独立复现 + 构建产物实测）

**问题**

`92.0 KB gzip` 的 zod 被运到了浏览器，**23/25 条路由都有**，包括 privacy / terms / refund 三条静态法律页。

链条（每一跳都读过源码）：

```
客户端组件（13 个入口）
  └→ src/core/i18n/navigation.ts:3   import { routing } from "./routing"
      └→ src/core/i18n/routing.ts:3  import siteConfig from "../../../site.config"
          └→ site.config.ts:1        defineConfig({...})     ← 模块加载时执行
              └→ src/core/config/schema.ts:609  siteConfigSchema.safeParse(input)
                  └→ zod 全量 schema
```

实测：那个 chunk（`2azsgwtju6wb-.js`，397.6 KB raw / 92.0 KB gzip）里 **99.4% 是 zod**，真正需要的 `routing` 模块只占最后 2.2 KB。而 `routing.ts` 实际只需要 `locales` 和 `defaultLocale` 两个字符串。

这是**纯意外重量**：全仓库零个 `'use client'` 文件直接导入 zod，浏览器端没有任何正当的校验需求。而且这更像漏网而非取舍——`src/core/ui/page-header.tsx` 里有一条注释，作者明确写了自己刻意不 import `@/core/i18n/navigation`，理由是「会把 settings、billing、admin/* 一起拖进客户端边界」。同一个坑这里守住了，`routing.ts` 没守住。

**做**

- 断掉上面那条链。**首选**：把 `locales` / `defaultLocale` / `localePrefix` 抽成一个不 import 任何东西的叶子模块，`routing.ts` 改引用它。
  **注意**：`routing.ts` 还被 `src/proxy.ts` 引用（edge middleware），所以叶子模块必须是 **edge-safe 的纯数据**（不能碰 `node:` 或服务端 API）。
- **备选**：把 `defineConfig()` 的 `safeParse` 从 `site.config.ts` 的模块初始化挪到只跑在服务端/构建期的位置。`next.config.ts` 已经 `import "./src/core/env"`，而 `env.ts` 引用 `site.config.ts`，所以构建期校验不会丢。
- 修复范围已经核算清楚：**只改 `routing.ts` 一处即可完全清除，无残留路径**。（曾有一条经 `admin/ui/forms.tsx → admin/actions.ts → credits/index.ts` 的路径，但 `admin/actions.ts` 是 `"use server"` 文件，客户端 import server action 只发引用、不打真模块，是假阳性。）

**不做**：给 `next.config.ts` 加 `optimizePackageImports`（lucide 已被 Next 16.3.6 内置优化，base-ui 全走子路径，加了没用）

**验收**

- [ ] `pnpm build` 后，`.next/diagnostics/route-bundle-stats.json` 里**没有任何路由**的首屏 chunk 含 zod（`$ZodError` 零命中）
- [ ] 营销页首屏 JS 下降约 92 KB gzip（对照基准：privacy 345 KB → 约 253 KB，全站共享基线是 132 KB）
- [ ] `getSession` 等依赖 `routing` 的功能不受影响；`src/proxy.ts`（edge）构建通过
- [ ] `pnpm test` + e2e 全绿

**测试**：**验收核心是构建产物核对，不是单测**。做法：构建后读 `.next/diagnostics/route-bundle-stats.json`，断言每个路由的 `firstLoadChunkPaths` 里没有含 `$ZodError` 的 chunk。这条断言值得写进 CI —— 它是唯一能防止这条链被重新接上的机制。

---

## T1002 playground-stream

- 分支 / worktree：`fix/playground-stream` → `../sass-playground-stream`
- 依赖：—
- 依据：审计 P1①

**问题**

`src/core/ai/playground.tsx:55-57` 的 `useChat` **没传 `throttle`**，而 SDK 类型注释写明不传就**关闭节流**（`@ai-sdk/react/dist/index.d.ts:119-122`）。服务端确实按模型 delta 逐个推流（`src/core/ai/run.ts` → `src/core/ai/chat.ts`），所以**每个流式分片都会重渲染整个 Playground 组件**——常见 30–80 token/s 就是每秒 30–80 次。

而 `input` 状态与消息列表在**同一个组件**里，所以输出滚动时在输入框打字，按键（紧急更新）要和每秒几十次流式渲染抢主线程。

**做**

- 加节流，一行：`useChat({ transport, throttle: 50 })`（压到约 20 次/秒）。
- 评估是否把消息列表抽成 `memo` 组件、把 `input` 状态下沉到自己的组件——这才是根治「打字重渲染整条对话」。当前 `input` 与 `messages` 同在一个组件里，成本随对话变长。
- 顺带确认：更新来自 `useSyncExternalStore` 的外部 store 通知，**包不进 `startTransition`**，SDK 的 `throttle` 才是对应杠杆。

**不做**：`useDeferredValue`（次要；throttle + 拆组件已解决主因）

**验收**

- [ ] 流式输出期间在输入框打字，输入回显不卡（用 React DevTools Profiler 计数佐证）
- [ ] 对话功能与现有 e2e 不回归

**测试**：现有测试 + 手动 Profiler 计数（无 playground e2e 用例，不会撞）

---

## T1003 playground-tabs-split

- 分支 / worktree：`fix/playground-tabs` → `../sass-playground-tabs`
- 依赖：—（建议在 T1002 之后做，会动同一个文件）
- 依据：审计 P1②

**问题**

`/playground` 无论打开哪个 tab 都下载**整个 AI SDK**（`2_jswru4kxxqf.js` = 58.1 KB gzip）。`src/app/[locale]/(app)/playground/page.tsx` 里对 `ImageStudio` / `Playground` / `VideoStudio` / `PlaygroundTabs` 是**静态 import**，而 `playground-tabs.tsx` 的 `opened` set 只延迟了**挂载**、模块早就下完了。另外 `aiVideoEnabled === false` 时 video-studio 的 chunk 照样在该页的客户端 chunk group 里。

**做**

- 把 tab 内容的加载改成按需：在 `playground-tabs.tsx`（**客户端**组件）里用 `next/dynamic`，标签激活时才拉对应组件；server page 只传 id 与 props，不再传 `content: ReactNode`。
- **坑（必读）**：**不能**在 `playground/page.tsx`（服务端组件）里 `dynamic()`。这个 Next 版本明确不支持 Server Component 动态 import 客户端组件，且 `ssr: false` 在 RSC 里直接报错。lazy 必须放在客户端组件里。
- 顺带修：条件关闭 `features.ai.video` / `features.ai.image` 时，对应 chunk 不再下发。
- **可选**：把 `hidden` + `opened` set 换成 React 19.2.8 的 `<Activity>`（稳定导出，不是 `unstable_`；Next 自带文档把 tabs 列为它的用例）。换的话有两条硬约束：
  - `opened` 集合**必须保留** —— `Activity` 的 children 依然要条件渲染，否则三个 tab 首屏全挂载、视频/图片资源立刻开始加载。
  - **必须同步改测试**：`src/core/ai/playground-tabs.test.tsx` 断言的是 `.hidden`（`expect(panel("video panel").hidden).toBe(true)`），而 `Activity` 走 `display:none`，这几条会全挂 —— 改成 `toBeVisible()` / `not.toBeVisible()`。

**不做**：改 tab 的交互设计；给 `GENERATIONS_LIMIT` 之外的列表做虚拟化

**验收**

- [ ] 只打开 chat tab 时，首屏不下发 `ai` 包（约 58 KB gzip）
- [ ] 标签状态保留行为不变（切走再切回，表单与对话还在）
- [ ] `pnpm test` + e2e 全绿

**测试**：现有 `playground-tabs.test.tsx`（若换 `Activity` 需同步改断言）+ e2e；构建产物核对 tab chunk 是否还在首屏

---

## T1004 serial-queries

- 分支 / worktree：`fix/serial-queries` → `../sass-serial-queries`
- 依赖：—
- 依据：审计 P2（两路独立发现同一类问题）

**做**

- `src/core/billing/status.ts:31-58`：两个查询串行，都以 `(userId, providerSubscriptionId)` 为键、**互不依赖**，改成并行。**这条在热路径上**：结账成功页在 webhook 落库前会按 1s→5s 反复轮询这个接口（`src/core/billing/ui/checkout-status.tsx`），所以多出的一跳会在一次结账里重复发生很多次，直接影响「正在处理 → 完成」的切换速度。
- `src/core/admin/queries.ts:101-148`：profile 先串行查一次，到 `Promise.all` 那行才把另外三个并起来，而那三个只依赖 `userId`。四个一起 `Promise.all`，`!profile` 时仍返回 `null`。
  **约束**：`admin/users/[id]` 页面里的 `notFound()` **位置不要动**（要在流式开始前定状态码）。四个查询一起 await 完再返回不影响它。
  **说明**：同文件的 `listUsers` / `listOrders` / `listSubscriptions` 全是单个 `Promise.all`，所以这是孤立的一处不一致，不是全仓模式问题。

**不做**

- `src/core/billing/cancel-on-user-delete.ts` 循环里的串行 `await`：当前不可达（每个用户最多一条 billable 记录），且顺序取消承载了「provider 未配置就抛错中止、避免账户删了还在扣费」的语义，并行化要重新设计错误处理。
- AI 路由 / 上传接口里「廉价本地校验排在一次 DB 往返之后」的几处（`core/ai/chat.ts`、`core/ai/handlers.ts`、`core/upload/handlers.ts`）：毫秒级，不值得单独排期。

**验收**

- [ ] 结账成功页在 webhook 未到达时，每次轮询少一跳
- [ ] `/admin/users/[id]` 少一跳；用户不存在时仍返回 404 且 `notFound()` 语义不变
- [ ] `pnpm test` + e2e 全绿

**测试**：现有 billing / admin 单测 + e2e（`e2e/billing.spec.ts` 的成功页流程、`e2e/admin.spec.ts` 的用户详情）
