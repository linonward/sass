# 阶段 7：视觉重设计

阶段完成后：整站由 `site.config.ts` 里的一个色推导配色；营销面和产品面/后台各自有一套讲得清的表面语言。

视觉系统记在 [design.md](../design.md)，两个语域的对照表在那一节的 §4.5。

---

## T605 redesign（已合入 main，PR #42）

- 分支 / worktree：`feat/redesign` → `../sass-redesign`
- 依赖：T108、T604

**做了**

- 配色从 `brand.primaryColor` 一个 hex 推导（`src/core/theme/brand-css.ts`），亮暗两套分别注入；对 11 个品牌色断言过 WCAG AA
- 表面深度统一成 `.sticker` / `.sticker-lg`：1px 描边 + 同色零模糊硬唇边；全部模糊投影移除
- 圆角刻度（控件 8 / 按钮 12 / 卡片 16）、Bricolage 作 display 字体、`Button` / `Card` / `Badge` 的 `tone`
- 营销面重做：左对齐首屏 + 真实 DOM 拼的产品 mock、横向色带 + 波浪、bento 特性区、独立贴纸卡

**没做**（当时明确排除）：产品面/后台的**布局**只继承了 token，结构未动。→ T606

---

## T606 redesign-app

- 分支 / worktree：`feat/redesign-app` → `../sass-redesign-app`
- 依赖：T605
- 范围：登录后产品面 + 后台（dashboard / settings / billing / billing-success / playground / example / admin 全部页 / auth 登录页 / 共享外壳）

**做**

- 新增 `.panel`：产品面/后台的平面，1px 描边、**零唇边**；`Card` 不传 `tone` 时用它（营销面一个 `<Card>` 都没用，零影响）
- 新增 `src/core/ui/page-header.tsx`（display 字体页头 + 发丝线）和 `src/core/ui/empty-state.tsx`（居中图标片 + 粗标题 + 弱描述 + 一个主操作），产品面各页统一用它们
- 侧边栏加可见的分组小标题（大写、留白抬高），折叠成图标列时 `hidden` 而不是透明占位
- 后台表格密度重做：表头大写小标题、行高收紧、空状态换 `EmptyState`；筛选器激活态从实心品牌块改成中性填充，实心色留给每一屏唯一的主操作
- 状态徽章上语义色，但**只标异常**（见 design.md §4.5）；给 `Badge` 加 `flat` 轴，产品面不带唇边
- 收尾 T605 遗留：`text-primary` 当文字用 → `--primary-text`/`--success`；`shadow-sm` / `shadow-md` 的残留（含下拉菜单、抽屉、图表的 tooltip）
- 内容区宽度：产品页 `max-w-5xl`，后台数据页 `max-w-6xl`

**不做**：blog 列表卡片与文章页、legal、404（→ T607）；任何 token 的推导规则；`src/core/` 下的非 UI 代码

**验收**

- [ ] `pnpm lint` / `pnpm typecheck` / `pnpm format:check` 全绿，`pnpm test` 688 项全过
- [ ] e2e：`ui-shell` / `landing` / `dashboard` / `admin` / `auth` / `example` 全过
- [ ] 375px 亮暗两套下 `/dashboard` 与 `/admin/metrics` 不横向溢出（本次新加的覆盖）
- [ ] 1440 / 375 × 亮暗截图逐张看过：dashboard、settings、billing、playground、admin 四页 + 用户详情、sign-in
- [ ] 界面上没有模糊投影：`grep -rn "shadow-\(sm\|md\|lg\|xl\)" src` 无命中
- [ ] 折叠态侧边栏（图标列）没有隐形点击层

---

## T607 redesign-rest

- 分支 / worktree：`feat/redesign-rest` → `../sass-redesign-rest`
- 依赖：T606

**做**

- 营销侧剩下的细节页布局：blog 列表卡片与文章页、legal、404
- 那几处还没换的 `text-primary` 当文字用：`src/core/blog/post-list.tsx`、`post-article.tsx`、`src/core/legal/legal-page.tsx`、`src/app/[locale]/not-found.tsx`
- 打开移动端抽屉看一次营销面的导航（T606 给菜单加了唇边、去掉了投影）

**不做**：产品面（T606 已完成）
