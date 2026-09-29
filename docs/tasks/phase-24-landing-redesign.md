# 阶段 24：Landing 重设计

## T2401 landing-redesign

- 分支：`feat/landing-redesign`
- Worktree：`../sass-landing-redesign`
- 依赖：T105、T605、T1803，均已合入 `main`；起点 `9cc1318`。

首页从通用模板功能列表改为「付款 → 积分 → AI 使用」的产品叙事，落实已确认的首屏、能力区、交付与 FAQ 三张视觉稿。模板购买方案与演示 SaaS 套餐分开，首页不编造模板售价、更新期限或支持承诺。

## 实现与验收

- [x] 中英首页：产品工作室首屏、三步流程、交替能力行、交付清单、FAQ、收尾 CTA。
- [x] 保留浅色／深色／跟随系统、语言切换与品牌色预览；品牌色复用 `brandCss`，不再用内联变量覆盖明暗主题。
- [x] 原生 Tab 可点击和键盘切换，所有产品数据标为示例，不调用模型；真正体验入口通向 `/demo`。
- [x] 默认首页使用 `delivery`；保留可配置 `pricing` 区块与 `/pricing` 的真实演示结账入口。
- [x] 图片独立于 UI，以 WebP 本地交付；保留自定义 Hero 图片配置。
- [x] 375px 中英文亮暗主题无横向溢出，品牌色和深浅模式联动有浏览器回归。
- [x] `pnpm test`：125 个文件，1470 项通过。
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。
- [x] 必须的 `ui-shell`、`landing` 加多语言 `locale` 回归通过（45 passed，1 项按设计跳过：手机不运行桌面导航测试）。

- [x] 定价购买回归：桌面 5 项通过，覆盖登录续接、延迟 webhook、超时、免费套餐和 token 所属校验。

## 视觉核对记录

用内置浏览器先检验，再用 `view_image` 对照原稿与实际截图。首屏按原图 1505×1045 核对，也检查默认 1280×720 和手机 375×812。全页截图拼接在本机出现缩放／重复，因此采用正常视口分段截图验收。

| 核对点       | 原稿要求                         | 实际修正或保留                                                   |
| ------------ | -------------------------------- | ---------------------------------------------------------------- |
| 首屏文案     | 三行中文标题，末句强调，两个入口 | 明确中文断句，保持完整可访问名；入口为演示与交付                 |
| 产品预览     | 香水图、生成状态、左下积分卡     | 修正图片固有高度；桌面积分卡叠放，状态文字避开卡片，历史页不叠卡 |
| 颜色与表面   | 青绿、浅色带、细边与硬唇边       | 沿用项目单一品牌色推导；不使用模糊投影、渐变或写死的界面色       |
| 能力区       | 收款、AI、记录三组交替布局       | 三行独立原生预览，AI 行品牌浅色背景；没有重复功能卡网格          |
| 交付和 FAQ   | 待公布方案、四项交付、首项展开   | 保持待定文案；原生 details 可展开收起                            |
| 主题模块     | 用户补充必须保留                 | 首屏六色预览；顶栏保留主题、语言和原博客入口，手机保留操作空间   |
| 图片与响应式 | 产品摄影嵌入原生工作室           | 同系列生成资产；手机单列，积分卡回到文档流                       |

首屏文案核对：标题、副标题、主次 CTA 与概念一致。额外保留博客、语言、主题控件与「换个颜色」提示，来自既有功能和用户明确要求。页脚保留配置导航，不能为复刻图片丢掉现有入口。画布与品牌色严格服从 `docs/design.md` 和配置 token，原稿图片中的轻微光照／渐变不引入 CSS。首屏复用同一香水照片到能力画廊；图片是重新生成的独立资产，不是截取整张 UI 图。主题与布局已按上述边界忠实核对。

## 素材

`public/landing/perfume.webp` 和 `skincare.webp` 由本次 Image Gen 生成，无外部摄影版权依赖。提示围绕「无文字、无 UI 的产品摄影：透明香水瓶、柠檬与薄荷石台；琥珀护肤瓶、浅色石台与干花」。用仓库已有 sharp 转为 WebP；没有新增依赖、环境变量或付费服务。

本地预览用独立测试数据库和忽略的 `.env.local`；不进入提交。截图保存在 Codex 可视化目录，不把 QA 产物提交到模板。

### 页脚反馈调整

根据浏览器评论，页脚改为「产品／法律」两组纵向链接，并显示分组标题。桌面两组位于品牌右侧，375px 下位于品牌下方并排显示；所有链接、主题和语言功能保留。再次运行 `pnpm test`（1470 passed）与要求的 `ui-shell`、`landing`（39 passed / 1 项预期跳过），并用内置浏览器核对桌面和手机布局。

### 预览切换高度修复

根据 History 切换时首屏跳动的反馈，预览标签页改用同一网格单元叠放，布局始终预留较高内容的空间；积分卡隐藏时也保留手机端占位。非活动面板使用 `invisible`、`aria-hidden` 和 `inert`，不占键盘焦点或可访问树。每个 Tab 对应独立的 panel ID。新增回归在中英文、桌面和手机端断言来回切换后首屏高度与下一区块位置完全不变。类型检查、1470 项单元测试、39 项页面回归通过，另有 1 项预期跳过；内置浏览器确认 History 外框保持稳定。

## T2402 landing-seo

- 分支：`fix/landing-seo`
- Worktree：`../sass-landing-seo`
- 依赖：T2401，已合入 `main`。

T2401 换了首页叙事，但首页的 title 和 description 还停在旧模板：`<title>` 只有站点名，描述是 24 个字符的 "Ship your SaaS in a day."，和新 H1 对不上。以 Googlebot UA 取中英首页渲染后 HTML 审计，地基（robots、canonical、hreflang、sitemap、SSR 正文、JSON-LD、首图预加载）没有问题，只补 on-page 这一层。

- [x] 首页 `generateMetadata` 使用 `Metadata.homeTitle`，标题为「Hero 主张 | 站点名」；description 改写为与 Hero 标题和副标题一致的一句话，中英各一份。买家改首页文案时在同一个 messages 文件里一起改。
- [x] `og:locale` 输出 `en_US` / `zh_CN`（映射在 `src/core/i18n/locales.ts`，没登记的语言原样输出）。
- [x] 不加 FAQPage 结构化数据（Google 自 2023 年起只对政府和健康类站点展示）；首页不展示价格，所以也不加 Offer / SoftwareApplication。
- [x] `pnpm test`（1492 passed）、`pnpm typecheck`、`pnpm lint` 通过；`seo`、`ui-shell`、`landing`、`locale` 回归 53 passed、1 项按设计跳过。

## T2403 onwardkit-brand

- 分支：`feat/onwardkit-brand`
- Worktree：`../sass-onwardkit-brand`
- 依赖：T2402，已合入 `main`；起点 `23b5aaf`。

对外产品名统一为 OnwardKit。README 使用产品定位与中英标语；分享卡默认描述和页脚标语同步。推广策略文档补充中英社交简介、首次介绍草稿和官方演示配置步骤。模板仍允许买家通过 SITE_NAME 换名，默认 Acme 哨兵值及升级标识不变。域名、法律主体与发信地址须使用实际部署信息。

- [x] `pnpm test`：128 个文件、1492 项通过。
- [x] `pnpm lint`、`pnpm typecheck` 通过。
- [x] `E2E_PORT=3220 npx playwright test e2e/ui-shell.spec.ts e2e/landing.spec.ts`：39 passed、1 项预期跳过。首次运行与文件改动重叠，两个桌面跳转断言超时；停止改动后完整重跑通过。
- [x] 内置浏览器核对桌面与 375px：OnwardKit 名称完整显示，语言、主题、品牌色预览保留。
- [x] 本地 `/opengraph-image` 为 1200×630，展示 OnwardKit 和新英文标语，无裁切。

预览通过忽略的 `.env.local` 设置 SITE_NAME，本地测试域名仅用于验收。线上环境未修改；上线时按推广文档设置实际站点身份并重新构建。

---

## T2404 onwardkit-pricing

- 分支 / worktree：`feat/onwardkit-pricing` → `../sass-onwardkit-pricing`
- 依赖：T2309（Waffo Pancake）、T2403，已合入 `main`

**问题**

这个仓库既是卖给买家的模板，也是 OnwardKit 自己的销售站点。OnwardKit 实际卖法是：Waffo Pancake 收款、只卖一次性（$99）、数字产品不退款、1 年更新 + 邮件支持。但首页的购买卡片还写着「即将公布 / 待确认」、没有购买按钮；法律页写死了 Creem；而直接改 `site.config.ts` 会改掉买家拿到的默认值，还会让依赖 `pro` 订阅套餐的一批模板测试失去覆盖。

**做**

1. 站点差异用环境变量覆盖，模板默认值与测试不动（延续 `SITE_NAME` 等的做法）：
   - `SITE_PRICE_<套餐>`：覆盖套餐标价（例如 `SITE_PRICE_LIFETIME=99`），非法值启动即报错；
   - `SITE_HIDDEN_PLANS`：逗号分隔，被隐藏的套餐不展示、不能新购，但仍在配置里（已有订阅照常续费、发积分）；
   - 支付商用已有的 `BILLING_PROVIDER=waffo`（在部署环境设，不改代码）。
2. 首页「交付」区块的购买卡片：价格取 `landing.purchasePlan` 指向的套餐（含覆盖后的价格），条款写「一次性付款 · 1 年更新 · 邮件支持 · 数字产品售出不退款」，加购买按钮（复用 `PlanButton` 的结账流程）；套餐不存在或被隐藏时退回「即将公布」。
3. 法律页按生效的支付商写名称（MoR / 非 MoR 的措辞随之变化），不再写死 Creem；退款页改为数字产品售出不退款（法律措辞请卖家审阅）。
4. FAQ「能否更换支付服务商」补上 Waffo Pancake。

**不做**

- 付款后的交付（下载链接邮件）：见 T2405。**T2405 合入前不要在生产环境设 `BILLING_PROVIDER=waffo` 和产品 ID**，否则能收款却交付不了。

**验收**

- [ ] 不设这几个环境变量时，站点和所有模板测试与改动前一致
- [ ] 设 `SITE_HIDDEN_PLANS=pro`、`SITE_PRICE_LIFETIME=99` 后：定价页不显示 pro、结账 pro 被拒、首页购买卡片显示 $99 且能发起结账
- [ ] 法律页随 `BILLING_PROVIDER` 显示正确的支付商
- [ ] `pnpm test`、`e2e/ui-shell.spec.ts`、`e2e/landing.spec.ts` 全绿（含 375px 不横向溢出）

---

## T2405 template-delivery

- 分支 / worktree：`feat/template-delivery` → `../sass-template-delivery`
- 依赖：T2404

**问题**

买家付款后要拿到 OnwardKit 模板。决定：付款成功后**邮件自动发下载链接**。

**做**（放在 `src/features/`，不进 `src/core/`）

1. 发行包存在私有存储里（R2 私有 bucket 或同等），按版本存放；下载走带时效的签名链接。
2. 付款成功（购买卡片对应的套餐）时记一条授权（用户、订单、购买时间、更新截止 = 购买 + 1 年），并经 T2305 的 outbox 发下载链接邮件（可靠补发）。
3. 买家能在站内重新获取链接（链接过期后不必找人工）；成功页写明「下载链接已发到邮箱」。
4. 1 年内的新版本：授权有效期内可以取到最新发行包 / 差量更新包。

**验收**

- [ ] 测试环境真实付款后收到邮件、链接可下载、过期后失效且能重新获取
- [ ] 重复 webhook / 补发不重复授权、不重复发信
- [ ] 业务代码全部在 `src/features/`，`src/core` 只加通用钩子（若需要，逐条说明）

## T2406 landing-testimonials

- 分支：`feat/landing-testimonials`
- Worktree：`../sass-landing-testimonials`
- 依赖：T2403，已合入 `main`（2278751）；起点 c692f09。

在功能区与交付区之间增加配置驱动的用户故事墙。默认 6 条中英文示例评价，逐条标注，产品图片复用已有摄影；没有编造人数、评分、收益或访谈素材。

- [x] 支持 quote / image / video，作者头像、HTTPS 原始出处可选；视频需封面、尺寸和字幕，本地素材无需放宽 CSP。
- [x] `landing.sections` 控制顺序和开关；items 为空时，在计算波浪前过滤。
- [x] 3 / 2 / 1 列，品牌色高亮、硬唇边，亮暗主题；原生视频控件，preload=none，无自动播放。
- [x] `pnpm test`：133 个文件、1556 项通过；`pnpm typecheck` 与 `pnpm lint` 通过。
- [x] `E2E_PORT=3240 npx playwright test e2e/ui-shell.spec.ts e2e/landing.spec.ts`：43 passed、1 项按设计跳过。
- [x] 实际浏览器核对：1440px 桌面、375px 手机亮暗模式，图片加载与品牌色切换正常；页面无 console error / pageerror。

配置说明见 [用户故事配置](../testimonials.md)。没有新增依赖或环境变量。
