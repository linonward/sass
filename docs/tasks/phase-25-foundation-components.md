# 阶段 25：基础组件

阶段完成后：买家写业务页面时，表单字段、列表分页筛选、确认操作、文件上传都有**组合好就能用**的组件，而且模板自己的页面已经在用它们 —— 不是一批没人调用的新文件。

依据：2026-09-30 的组件盘点。按钮、弹窗、表格、空状态、骨架屏已经够用，缺口在「组合层」；而且仓库里已经出现了重复实现：

| 缺口     | 现状（2026-09-30 `main` 实测）                                                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表单     | 原生 `<select>` 10 处分散在 7 个文件（账户设置、发票、状态后台 ×2、获客报表筛选、图片 / 视频 / playground）；表单结果提示写了三份（`src/core/account/settings-forms.tsx` 与 `src/core/admin/ui/forms.tsx` 各有一个 `Status`，`src/features/invoices/dialogs.tsx` 有 `FormError`）；`aria-describedby` / `aria-invalid` 只有登录、后台表单和报表筛选在接 |
| 列表     | `src/core/admin/ui/list.tsx` 有 `cleanQuery` / `StatusFilter` / `Pagination` / `EmptyRow`；`src/features/invoices/page.tsx` 把 `cleanQuery` 和 `Pagination` **整段抄了一份**（注释写明：业务模块 import 后台 UI 是反向依赖）；搜索框只有后台用户页和发票各写一个                                                                                        |
| 确认操作 | 删除账户（输入邮箱确认）、吊销 API Key、删除发票三处各自拼 `Dialog` + `useTransition` + 错误回显；「成功才关、失败留在弹层里」的写法靠注释互相引用来保持一致                                                                                                                                                                                            |
| 上传     | `src/core/upload/client.ts` 的 `uploadFile` 能用（预签名 → 直传 R2 → 确认），界面只有 `upload-example.tsx` 和视频首帧上传两处各写一份；没有拖放、预览、取消、重试，`uploadFile` 也不收 `AbortSignal`                                                                                                                                                    |
| 账户安全 | `site.config.ts` 的 `auth.changeEmail` 默认开启、双验证码，改成功后全部 session 失效（`src/core/auth/session-invalidation.ts`），`e2e/email-change.spec.ts` 直接调接口测过 —— 但设置页**没有入口**（配置注释原话：「设置页暂时没有入口」）；没有登录设备列表                                                                                            |

## 本阶段的共同约束

- **组件来源是 shadcn/ui（`base-nova`，底层 Base UI）。** 新控件先用 `pnpm dlx shadcn@latest add <name>` 拉进 `src/core/ui/`，再按 [docs/design.md](../design.md) 改成 `--edge` 驱动的贴纸描边和硬唇边，不用模糊投影；不从零手写同类控件。拉下来的文件里 `@/registry/...` / `IconPlaceholder` 之类的占位由 CLI 按 `components.json` 改写，落地后逐个确认 import 指向 `@/core/ui` 与 `lucide-react`。2026-09-30 用 shadcn CLI 4.21.0 查过，本阶段用到的 `select`、`field`、`checkbox`、`switch`、`pagination`、`alert-dialog`、`spinner`、`progress` 在 base-nova 下都存在；动手时以当时的官方文档为准重新确认。
- **Select 用 shadcn 的 Select，不用原生 `<select>`。** 这是 2026-09-30 的决定：换来样式统一，代价是移动端不再调起系统选择器、表单提交与可访问性要自己验证。所以 T2501 的验收里必须实测：server action 的 `FormData` 能拿到值、GET 表单（报表筛选）提交后 URL 带参数、键盘可完整操作、375px 下弹层不横向溢出。
- **每个新组件至少替换一个现有页面**，替换后删掉被替代的本地实现。只新增、不迁移的组件不合入。
- **按实际使用补控件**：不引入日期选择器、富文本、Combobox、复杂 DataTable（列排序 / 列显隐 / 虚拟滚动）；等业务需要时再加。
- **不做大系统**：多租户、细粒度 RBAC、站内通知中心、通用工作流不在本轮。
- **组件放 `src/core/ui/`（纯 UI）或对应能力目录（如 `src/core/upload/`）**；`src/core/ui/` 不 import 任何业务或后台模块。组件文案走 `messages`，公共文案放 `Common` 命名空间，不再挂在 `Admin.*` 下让产品面去引用。
- 每个任务都跑 `pnpm test` 和 `npx playwright test e2e/ui-shell.spec.ts e2e/landing.spec.ts`，外加被迁移页面对应的 e2e。

## 不在本轮，但记下来

- **套餐权益判断**：统一回答「当前用户能不能用某功能、是否超出套餐额度」，并给出升级提示。积分（按量扣）、套餐（订阅状态）、feature flag（灰度开关）各管一件事，不能互相替代，这一层确实缺。但它的接口形状取决于业务怎么定义「功能」和「额度」，现在凭想象设计大概率要推倒重来。等第一个真实业务（T2306 参考产品或买家反馈）提出具体需求时再开卡。
- **博客列表分页**（`src/core/blog/post-list.tsx`）：营销语域，只有上一页 / 下一页，和产品面的列表不是一个视觉层级，本轮不并入 T2502。

## 顺序

```
T2500 → T2501 ─┬→ T2502
               ├→ T2503 → T2505
T2306 ─────────┴→ T2504
```

- T2501 先做：Select、Field、FormMessage、SubmitButton 是后面几张卡的零件。
- T2502 与 T2503 在 T2501 之后可并行（不碰同一批文件）。
- T2504 等 T2306：上传组件要服务商品宣传图生成器，范围按参考产品的实际需求定，不先在模板里凭想象做全。
- T2505 在 T2503 之后：「退出其他设备」要用确认操作组件。

---

## T2500 foundation-components

- 分支 / worktree：`docs/foundation-components` → `../sass-foundation-components`
- 依赖：—

落本阶段的卡（本文件）并登记任务表。

**验收**

- [x] 阶段文档与任务表、依赖图、任务详情链接同步

---

## T2501 form-fields

- 分支 / worktree：`feat/form-fields` → `../sass-form-fields`
- 依赖：T2500

**问题**

字段说明、错误提示和提交状态每个表单各写一遍；原生 `<select>` 散在 7 个文件里，样式和语域各不相同；错误状态是否跟控件建立可访问关联，全看写的人记不记得。

**做**

- 用 shadcn CLI 拉 `field`、`select`、`checkbox`、`switch`（`spinner` 视 `SubmitButton` 需要），按 design.md 改样式。
- 在 shadcn `Field` 之上补一层 `FormField`：用 `useId` 生成 id，**自动**把 label 的 `htmlFor`、说明和错误的 `aria-describedby`、有错误时的 `aria-invalid` 接到控件上。shadcn 的 `Field` 只负责布局，不做这层关联 —— 这是本卡要补的核心。
- `FormMessage`：统一「成功 / 失败」结果提示（失败用 `role="alert"`），替换 `settings-forms.tsx` 与 `admin/ui/forms.tsx` 的 `Status`、`invoices/dialogs.tsx` 的 `FormError`。
- `SubmitButton`：读 `useFormStatus` 显示处理中文案并禁用；需要从外部传 `pending`（`useTransition` 驱动的弹层）时也能用。
- 迁移全部 10 处原生 `<select>` 到 shadcn Select，同步改 `e2e/status.spec.ts`、`e2e/invoices.spec.ts`、`e2e/acquisition/report.spec.ts`、`e2e/i18n/auth.spec.ts` 里的 `selectOption`（改成按可访问名点选，不按 DOM 结构）。
- 迁移账户设置、发票表单、后台积分调整 / 封禁表单到 `FormField` + `FormMessage` + `SubmitButton`。
- `src/core/acquisition/leads/form.tsx` 的同意勾选框换成 shadcn Checkbox。

**不做**

- 不引入表单库（react-hook-form 等）和客户端 schema 校验：校验仍在 server action 里做，组件只负责展示结果。
- 不做 Combobox / 多选 / 日期选择。
- `onboarding/checklist.tsx` 的勾选是进度展示，不是表单控件，不迁移。

**验收**

- [x] 仓库里 `grep -rn "<select" src` 零命中；本地的 `Status` / `FormError` 已删除（实际是四份，见下）
- [x] 单测：`FormField` 在有 / 无说明、有 / 无错误时输出正确的 `htmlFor` / `aria-describedby` / `aria-invalid`（`src/core/ui/form-field.test.tsx`，id 由 Base UI 生成，断言按关联关系而不是按 id 字面量）
- [x] Select 实测：server action 的 `FormData` 拿到值；报表筛选（GET 表单）提交后 URL 带参数；只用键盘能打开、选择、关闭；375px 弹层不横向溢出
- [x] 亮 / 暗主题下 Select、Checkbox 的描边和焦点环跟品牌色走，不出现写死的颜色（Switch 没做，见下）
- [x] `pnpm test`、`pnpm lint`、`pnpm typecheck`、`ui-shell` + `landing` 与上面四个受影响 e2e 通过

**实施记录（与上面「做」的出入）**

- **`FormField` 建在 Base UI 的 `Field` 上，不拉 shadcn `field`。** shadcn base-nova 的 `field` 只是布局组件，不做关联；Base UI 的 `Field` 自己就会给 Base UI 控件（`Input`、`Select`、`Checkbox`，以及改成走 `Field.Control` 的 `Textarea`）接好 label、`aria-describedby`、`aria-invalid`，所以也不需要 `useId` 手拼 id。Select 这类按钮型控件用 `labelFor="button"`：label 渲染成 `<div>` 走 `aria-labelledby`，点它不会打开弹层。
- **Switch 没加。** 仓库里没有能迁移的开关，按本阶段「只新增、不迁移的不合入」不引入；`spinner` 也没用上（`SubmitButton` 换文案就够）。
- **结果提示合并的是四份**：写卡时漏了 `status/admin-forms.tsx` 的 `Feedback`，一并换成 `FormMessage`。
- **`DeleteAccount` 只换了结果提示**，弹层与确认逻辑留给 T2503。
- **修了发票弹层一个 `main` 上就有的缺陷**：`<form action={fn}>` 在 action 结束后会被 React 自动 reset，服务端拒绝时用户填的内容被清空。单测在 jsdom 里一直是绿的（jsdom 下没触发这次 reset），真实浏览器里 `main` 同样会清空。新建 / 编辑改走 `onSubmit`，并在 `e2e/invoices.spec.ts` 加了浏览器用例锁住。账户设置、后台、状态页的表单用的是 `useActionState`，出错后同样会被 reset —— 这是原有行为，本卡没改。
- **Select 弹层默认对齐触发器**（shadcn / Base UI 的 `alignItemWithTrigger`，和 macOS 原生下拉一样），会盖住上方的 label；保留默认。
- **本地跑 acquisition 套件要带 `CI=1`**（再补 `ci.yml` 里的三条 `ALLOW_*`）：报表的筛选选项有进程内 TTL 缓存，只在 `CI` / `NODE_ENV=test` 下绕过；本地 dev 模式下「填筛选 → Apply」那条用例会选不到刚注册的 medium，`main` 上用原生 `selectOption` 也一样失败。
- 新增 `src/core/ui/testing.ts`（jsdom 里操作 Select）和 `e2e/select-helpers.ts`（浏览器里按可访问名点选），后面的卡迁移时直接用。

---

## T2502 list-kit

- 分支 / worktree：`feat/list-kit` → `../sass-list-kit`
- 依赖：T2501

**问题**

分页和筛选已经有了，但放在 `src/core/admin/ui/list.tsx` 里，产品面用不了；发票示例因此整段复制了一份。搜索框在后台用户页和发票各写一个。

**做**

- 把 `cleanQuery`、`Pagination`、`StatusFilter`、`EmptyRow` 挪到 `src/core/ui/`（纯 UI，不 import 后台模块），文案挪到 `Common` 命名空间；后台各页改从新位置 import。`RoleBadge` / `UserStatusBadge` 是后台专属，留在原处。
- `Pagination` 参考 shadcn `pagination` 的结构与样式，但链接用 `@/core/i18n/navigation` 的 `Link`，保持现有「摘要 + 上一页 / 下一页」形态，不加页码列表。
- 新增 `ListToolbar`：搜索框（GET 表单，`?q=`，提交回到第 1 页）+ 可选的筛选槽位（`StatusFilter` 或 Select）。
- 新增 `parsePage`（从发票挪过来）作为公共工具，后台各列表统一用它解析 `?page=`。
- 「无结果」和「还没有数据」分开：有筛选或搜索条件时显示「没有匹配结果」并给出清除条件的链接。
- 迁移：发票示例删掉本地副本改用公共组件；后台用户页的搜索改用 `ListToolbar`。

**不做**

- 不做客户端分页、列排序、列显隐、批量选择。分页始终在服务端。
- 不改各列表的查询函数（分页上限与 `offset` 计算留在各自的 queries 里）。

**验收**

- [x] `src/features/invoices/page.tsx` 里不再有 `cleanQuery` / `Pagination` 的本地实现
- [x] `src/core/ui/` 下的列表组件不 import `@/core/admin/**`
- [x] 搜索 + 筛选 + 翻页组合时查询参数互相保留，第 1 页不写 `page`（单测覆盖 `cleanQuery`、`ListToolbar` 的隐藏字段、`StatusFilter` / `Pagination` 的链接）
- [x] 有条件无结果时出现清除链接，点了回到无条件列表（`e2e/invoices.spec.ts` 在浏览器里走一遍）
- [x] `pnpm test`、`ui-shell` + `landing`、`e2e/invoices.spec.ts` 与后台列表相关 e2e 通过

**实施记录（与上面「做」的出入）**

- **位置**：`cleanQuery` / `ListToolbar` / `StatusFilter` / `Pagination` / `EmptyRow` 在 `src/core/ui/list.tsx`；`parsePage` 不是 UI，放 `src/core/lib/pagination.ts`（后台各页和发票示例都从这里 import，`core/admin/queries.ts` 与发票 `queries.ts` 里的两份已删）。
- **`admin/ui/list.tsx` 改名为 `admin/ui/badges.tsx`**：挪走通用件之后只剩 `RoleBadge` / `UserStatusBadge`，文件名跟着内容走；不留转发导出（两条 import 路径只会制造漂移）。
- **文案**：新增 `Common.list`（中英）；`Admin.pagination`、`Admin.filter.label` / `all`、`Invoices.pagination` 已无引用，删掉。`Admin.filter.range` 仍被数据页的时间范围切换使用，保留。
- **「无结果」是 `EmptyRow` 的 `filtered` 参数**，不是另一个组件：传了就把文案换成「没有符合条件的结果」并给出「清除筛选」链接（`keep` 用来保留不算筛选的参数，如时间范围）。除卡上的发票与用户页，订单、订阅、计费异常、邀请关系、线索这几个带状态筛选的后台列表也一并接上；**渠道报表没接** —— 它的空文案在解释「归因开启前的注册会落在无归因」，比通用的「无结果」有用，且 `report.spec.ts` 锁着这段文案。
- **`ListToolbar` 的表单按搜索词加 `key`**：同路由的客户端跳转（点「清除筛选」、前进后退）不会重挂载，不加的话非受控输入框会停在旧词上而表格已经是新结果（和 `report-filters.tsx` 同一个坑）。
- **线索页的搜索没迁**：它按 `?email=` 搜，且和导出链接排在一起，换成 `ListToolbar` 要重排那一栏；只接了 `filtered`。另外它的 `StatusFilter` 点击时会丢掉当前的 email 搜索（没把 `email` 传进 `query`），是原有行为，没改。
- **发票 e2e 不再用 `data-testid="invoice-search"`**，改成按可访问名找 `searchbox`。
- `EmptyRow` 里的「清除筛选」链接要过一遍 `cn()`：`buttonVariants()` 自己不做 tailwind-merge，基础串里的 `border-transparent` 会盖掉 outline 的描边，亮色下链接没有边（实测后修正）。仓库里还有几处 `className={buttonVariants({ variant: "outline" })}` 直接用（如 `billing/ui/checkout-status.tsx`），可能有同样的问题，不在本卡范围。

---

## T2503 confirm-action

- 分支 / worktree：`feat/confirm-action` → `../sass-confirm-action`
- 依赖：T2501

**问题**

三处确认操作各自拼 `Dialog` + `useTransition` + 错误回显。「成功才关弹层、失败把错误留在弹层里、关掉再打开是干净状态、不用 `useEffect` 观察 state 去关」这些规则，现在靠代码注释互相引用来维持。

**做**

- 用 shadcn CLI 拉 `alert-dialog`（Base UI AlertDialog），按 design.md 改样式。
- `ConfirmActionDialog`，放 `src/core/ui/`：
  - 普通确认 / 危险操作两种语气（危险操作的确认按钮用 `destructive`）；
  - 可选的输入确认（输入指定文本后才能确认，比较时忽略首尾空格与大小写）；
  - 接一个返回 `{ status, error? }` 的 action，处理中禁用按钮并显示处理中文案；
  - 成功后关闭并回调（刷新列表等）；失败时弹层不关，错误用 `FormMessage` 显示，已输入的确认文本保留；
  - 关闭后重置状态。
- 迁移：删除账户（输入邮箱确认）、吊销 API Key、删除发票。

**不做**

- `HandleExceptionDialog`（计费异常处理）带备注字段、结果要留在弹层里给人看，是表单弹层不是确认，不迁移。
- 不做全局 `confirm()` 式的命令式 API（`await confirm(...)`）：声明式组件够用，命令式要额外的 provider 和挂载点。

**验收**

- [x] 三处迁移后，本地的 `Dialog` + `useTransition` 确认逻辑已删除
- [x] 单测：输入不匹配时确认按钮禁用；action 失败时弹层保持打开、错误可见、输入保留；成功后关闭；再次打开是干净状态（`src/core/ui/confirm-action-dialog.test.tsx`，另加处理中与 tone 两条）
- [x] 键盘：打开后焦点在弹层内，Esc 关闭，焦点回到触发按钮（真实浏览器实测）
- [x] `pnpm test`、`ui-shell` + `landing`、删除账户 / API Key / 发票相关 e2e 通过

**实施记录（与上面「做」的出入）**

- **alert-dialog 没走 `shadcn add`**：CLI 要覆盖已按设计系统改过的 `button.tsx`，所以用 `shadcn view` 取源码手工落地，import 改指 `@/core/ui/button`。样式对齐 `dialog.tsx`：遮罩只有暗色、不加 backdrop-blur，弹层用 `.sticker` 代替 `ring-1`；没用上的 `Media` / `Action` 没带进来。
- **弹层的角色从 `dialog` 变成 `alertdialog`**，也没有右上角的关闭按钮（只能「取消」、Esc 或操作成功后关闭，点遮罩不关）。三个 e2e 和发票单测里按 `dialog` / 关闭按钮找弹层的地方跟着改了。
- **提交走 `onSubmit`**（不是 `<form action={fn}>`），关闭发生在拿到结果之后的提交回调里，不用 effect 观察状态。删除账户原来用 `useActionState` + `<form action>`，失败时 React 会重置表单；现在改成同一套写法，输入的邮箱在失败后保留。
- **要操作的 id 用 `fields` 传成隐藏字段**，和输入确认（字段名 `confirm`）在同一个 `FormData` 里交给 action。
- 给 `FormField` 加了 `labelClassName`：删除账户的 label 是带加粗邮箱的富文本，默认的 flex label 会把它拆成几块。
- 「失败保留输入」在浏览器里没法稳定造出删除账户的服务端失败，所以这一条由单测覆盖；「失败时弹层留着、错误可见」在浏览器里用另一个标签页先删掉同一张发票（`not_found`）实测过。375px 亮 / 暗主题截图核对：弹层 16–359px，无横向溢出。

---

## T2504 upload-field

- 分支 / worktree：`feat/upload-field` → `../sass-upload-field`
- 依赖：T2501、T2306

**问题**

上传服务是成熟的（预签名直传、类型大小校验、私有下载），但界面只有示例级别的实现，每个用到上传的地方都要自己处理状态、错误和预览。

**做**

- 开工前先读 T2306 的 `docs/reference-product.md`：商品宣传图生成器实际需要什么（单张还是多张、要不要裁剪、失败怎么提示），按那个定本卡的最终范围；和下面的草案冲突时以参考产品为准，并在本卡里记下改动。
- `uploadFile` 增加可选的 `signal`（取消）；需要进度时把 PUT 那一步换成 `XMLHttpRequest` 以拿到 `upload.onprogress`（`fetch` 拿不到上传进度），接口保持向后兼容。
- `UploadField`，放 `src/core/upload/`：点击选择 + 拖放、客户端先按 `site.config.ts` 的 `upload` 做类型 / 大小预检（服务端校验不变）、图片本地预览、上传中 / 成功 / 失败状态、取消、失败重试；表单里通过隐藏字段提交 `fileId`。
- 需要进度条时用 shadcn `progress`。
- 迁移：`upload-example.tsx` 与视频首帧上传改用 `UploadField`。

**不做**

- 不做裁剪、压缩、断点续传、分片上传。
- 不改服务端接口和 R2 存储结构。

**验收**

- [ ] 两处迁移后本地的上传状态管理已删除
- [ ] 类型 / 大小不合规时不发请求，直接提示；服务端拒绝时显示对应错误
- [ ] 取消后不再调用 `/api/upload/complete`；重试复用同一个文件
- [ ] 键盘可选择文件；拖放区有可访问名
- [ ] `pnpm test`、`ui-shell` + `landing`、上传相关 e2e 通过

---

## T2505 account-security

- 分支 / worktree：`feat/account-security` → `../sass-account-security`
- 依赖：T2503

**问题**

改邮箱的后端是完整的（双验证码、改完全部 session 失效、有 e2e），设置页却没有入口；用户也看不到自己在哪些设备上登录着，没法把丢失的设备踢下线。

**做**

- 设置页加「修改邮箱」：输入新邮箱 → 发验证码（`verifyCurrentEmail` 开启时新旧邮箱各一个）→ 填码 → 成功后提示「所有设备已退出，请用新邮箱登录」并跳转登录页。`auth.changeEmail.enabled` 为 `false` 时整块不渲染。
- 设置页加「登录设备」：列出当前用户的 session（设备 / 浏览器由 User-Agent 粗略解析、IP、最近活动时间、标出当前设备），可单独退出某台设备，也可「退出其他所有设备」（用 `ConfirmActionDialog`）。
- 用 Better Auth 自带的会话接口实现（动手前按当时的官方文档确认 `listSessions` / `revokeSession` / `revokeOtherSessions` 的名称与返回形状），不自己写 session 表的查询。
- 扩展 `e2e/email-change.spec.ts`：在现有接口测试之外，加一条走设置页界面的完整流程。

**不做**

- 不做两步验证、Passkey、登录提醒邮件、异地登录检测。
- 不引入 User-Agent 解析库：只区分几类常见浏览器 / 系统，认不出的显示原始字符串的简短形式。

**验收**

- [x] 界面改邮箱全流程可走通，改完旧 session 全部失效（e2e 查 `session` 表，行数为 0；不以页面提示为证据）
- [x] `changeEmail.enabled: false` 时设置页不出现入口（临时改 `site.config.ts` 在浏览器里实测：关掉后表单消失、设备列表仍在；同一断言在关掉时期待表单会失败，证明断言有效）
- [x] 设备列表标出当前设备；退出单台设备后该设备下一次请求被要求重新登录；「退出其他所有设备」后当前设备仍在线（e2e 用多个浏览器上下文当多台设备，查 `session` 表行数）
- [x] `pnpm test`、`ui-shell` + `landing`、`e2e/email-change.spec.ts` 与设置页相关 e2e 通过

**实施记录（与上面「做」的出入）**

- **设备列表不走 `list-sessions` 接口。** 它挂着 `freshSessionMiddleware`：当前 session 创建超过 `freshAge`（默认 1 天）就返回 `SESSION_NOT_FRESH`，大多数用户打开设置页时都会报错。改为服务端通过 Better Auth 的 `auth.$context.internalAdapter.listSessions`（就是那个接口内部的读取，不是手写 SQL，也照顾 secondary storage）读取，只把 id、设备、IP、时间、是否当前设备交给页面，**token 不出服务端**。吊销单台时服务端按 id 在本人 session 里找 token，再调 `revoke-session`（只要求 session 有效，不要求新鲜）；「其他所有设备」调 `revoke-other-sessions`。当前设备不能在列表里被退出（用退出登录按钮）。
- **「最近活动」是近似值**：取 session 的 `updatedAt`，Better Auth 只在续期时（`updateAge`，默认一天）才更新它；页面用相对时间显示，不受服务端时区影响。
- **改邮箱在浏览器里直接调 Better Auth 的 email OTP 接口**（和登录页一样），保留 HTTP 层限流与 CSRF 校验。开了 `verifyCurrentEmail` 时，新邮箱那一步「重新发送」会回到当前邮箱那一步：当前邮箱的验证码已经被 `request-email-change` 用掉了。新邮箱已被占用时 Better Auth 回成功但不发信（不暴露哪些邮箱已注册），提示文案里说明了这种情况。
- **成功后不自动跳转**：显示「所有设备已退出，请用新邮箱登录」并给一个「去登录」按钮（整页跳转），自动跳走会让用户看不到这条说明。
- **错误码 → 文案抽成共享函数** `authErrorMessage`（`src/core/auth/errors.ts`），登录页和改邮箱共用；登录页行为不变（`e2e/auth.spec.ts` 通过）。
- 管理员模拟登录产生的 session 也会列出来，并标「管理员打开」。
- `verifyCurrentEmail: false` 的分支只有单测覆盖（直接向新邮箱发码），没在浏览器里单独跑。
- 截图核对时 dev 浮层出现过一次「1 Issue」（服务端日志带 `RedirectErrorBoundary`），之后按同样流程重跑三次都没有复现，浏览器控制台也没有错误，判断为 dev 编译中的瞬时问题。

---

## T2506 button-variants-cn

- 分支 / worktree：`fix/button-variants-cn` → `../sass-button-variants-cn`
- 依赖：T2502（它的「清除筛选」链接是第一个被发现的受害者，也是本卡要撤掉的临时绕法）

**问题**

T2502 实施时发现：「清除筛选」链接在亮色下没有边框。根因不在调用处，而在 `src/core/ui/button.tsx`：`buttonVariants` 的基础串有 `border-transparent`，`outline` 变体再加 `border-border`，两者特异性相同，谁赢取决于 Tailwind 输出 CSS 的顺序 —— 实测是透明赢。`Button` 组件自己用 `cn()`（tailwind-merge）合并过，所以没事；但把 `buttonVariants()` 直接塞进 `className` 的地方（链接做成按钮样式）拿到的是未合并的串。全仓 22 个文件、34 处这样的调用。暗色不受影响：`dark:border-input` 带变体前缀，天然更具体。

**做**

- 在源头修：导出的 `buttonVariants` 包一层 `cn()`，返回已合并的串；`Button` 组件改为直接用它（`cn` 幂等，按钮输出不变）。调用处一行不用改，以后新写的也不会再踩。
- 去掉因为这个问题而加的单参数 `cn(buttonVariants(...))` 包装（`src/core/ui/list.tsx` 的清除筛选链接及其解释注释、`demo/page.tsx`）；带额外 class 的 `cn(buttonVariants(...), extra)` 保留。
- `badgeVariants`、`sidebarMenuButtonVariants` 查过：每处调用都已在 `cn()` 里，不动。

**验收**

- [x] 浏览器实测（`/status` 的 Refresh、`/changelog` 的 RSS，都是直接用 `buttonVariants` 的 outline 链接）：修前亮色 `border-top-color` 为 `rgba(0, 0, 0, 0)`，修后为 `--border` 的 `rgb(212, 219, 218)`；暗色修前修后都是 `rgb(42, 47, 46)`
- [x] 单测 `src/core/ui/button.test.tsx`：outline 不再带 `border-transparent`；tone 的贴纸描边替换变体描边；没有自带描边的变体保留透明边。撤掉修复时其中两条失败
- [x] `pnpm test`、`pnpm lint`、`pnpm typecheck`、`ui-shell` + `landing` + `invoices` e2e 通过
