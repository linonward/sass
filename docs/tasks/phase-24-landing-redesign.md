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

**决定**

- 做成通用的「卖可下载文件」模块 `src/features/downloads/`（出厂关闭，官方站 `SITE_DOWNLOADS=1` 打开）：买家多一个现成示例，而不是一个用不上、得自己删的模板专用模块。
- 邮件里的链接指向站内 `/downloads`（需登录），不是免登录的签名链接：链接长期有效、转发出去也下不了；下载时现签 5 分钟的 R2 地址。
- 版本由 `pnpm downloads:publish` 发布（先传 R2、后写 `download_releases`），不做后台上传界面。

**`src/core` 的改动**（都是通用扩展点）

1. `site.config` 加 `downloads` 配置段；侧边栏图标加 `download`。
2. `src/core/billing/hooks.ts` 加一行 import 注册钩子（钩子本来就按这个方式扩展）。
3. `src/core/email/templates.ts` 登记 `download-ready` 模板（组件在模块目录里）。
4. `CheckoutStatus` 加可选 `nextSteps`：按套餐替换成功页的说明和主按钮。

**验收**

- [x] 付款（fake 服务商）后：成功页提示邮件已发、主按钮到下载页；收到 `download-ready` 邮件；下载页列出版本；下载接口对买家跳转、未登录 401（`e2e/downloads.spec.ts`，CI 主套件打开 `SITE_DOWNLOADS=1`）
- [x] 重复 webhook / 补发不重复授权、不重复发信；全额退款收回、部分退款不动；更新期外的版本和别人的授权拿不到（`downloads-db.test.ts`，真库）
- [x] 业务代码在 `src/features/downloads/`，`src/core` 只加上面四个通用点
- [ ] 上线前：用真实 R2 和 Waffo 测试环境走一遍（本地没有 R2 凭据，签名跳转只在单测里验证）

## T2406 landing-testimonials

- 分支：`feat/landing-testimonials`
- Worktree：`../sass-landing-testimonials`
- 依赖：T2403，已合入 `main`（2278751）；起点 c692f09。

在功能区与交付区之间增加配置驱动的用户故事墙。默认 6 条中英文示例评价，逐条标注，产品图片复用已有摄影；没有编造人数、评分、收益或访谈素材。

- [x] 支持 quote / image / video，作者头像、HTTPS 原始出处可选；视频需封面、尺寸和字幕，本地素材无需放宽 CSP。
- [x] `landing.sections` 控制顺序和开关；items 为空时，在计算波浪前过滤。
- [x] 3 / 2 / 1 列，品牌色高亮、硬唇边，亮暗主题；原生视频控件，preload=none，无自动播放。
- [x] `pnpm test`：136 个文件、1571 项通过；`pnpm typecheck` 与 `pnpm lint` 通过。
- [x] `E2E_PORT=3250 npx playwright test e2e/ui-shell.spec.ts e2e/landing.spec.ts`：43 passed、1 项按设计跳过。
- [x] 实际浏览器核对：1440px 桌面、375px 手机亮暗模式，图片加载与品牌色切换正常；页面无 console error / pageerror。

配置说明见 [用户故事配置](../testimonials.md)。没有新增依赖或环境变量。

T2406 合入前修正：同步 main 的购买卡片配置，解决合并冲突并避免任务编号重复；动态评价翻译 key 使用与既有配置区块一致的类型边界，中英文配置引用由测试校验。`tsc --noEmit --incremental false` 通过，避免增量缓存掩盖错误。

## T2407 landing-conversion

- 分支 / worktree：`feat/landing-conversion` → `../sass-landing-conversion`
- 依赖：T2404

**问题**

对照 shipfa.st：首页讲清楚了产品，但没有开口要单。首屏和结尾的主按钮都是「体验演示」，价格要滚到交付区才看得到；功能没有换算成买家省下的时间；FAQ 没回答「拿到什么、能不能退款、更新多久、还要花什么钱」。决定先于 T2405 上线，前几单手工交付（付款后 24 小时内邮件发下载方式）。

**做**

1. 首屏与结尾：`landing.purchasePlan` 有可买的套餐时，主按钮是「立即购买 · 价格」，跳到交付区块的购买卡片（先看条款再结账）；次按钮是 `landing.showcaseUrl`（真实案例站点，https，新标签页），不配时是 `/demo`。套餐被隐藏时退回原来的演示 + 交付入口。首屏按钮下加一行「一次性付款 · 含 1 年更新 · 付款后 24 小时内邮件交付」。
2. 新区块 `timesaved`（首屏之后）：`landing.timeSaved` 逐项列出模板里做好的活和估算工时，合计自动算（出厂 7 项、33 小时）；空数组隐藏区块。
3. FAQ 加 4 条：具体能拿到什么、还有其他费用吗、能获得多久的更新、可以退款吗。交付卡片条款补上「付款后 24 小时内通过邮件交付」。
4. 不做：倒计时、「仅剩 N 份」、划线原价、编造的用户数 —— 与诚实文案定位冲突，也有欧盟价格标示风险。

**验收**

- [x] 单测覆盖按钮取向（有套餐 / 隐藏 / showcaseUrl）、https 校验、工时合计、空列表隐藏、中英文 key 齐全
- [x] `e2e/ui-shell.spec.ts`、`e2e/landing.spec.ts` 通过（含 375px 不横向溢出）；品牌色断言改看新的主按钮

## T2408 seller-landing

- 分支 / worktree：`feat/seller-landing` → `../sass-seller-landing`
- 依赖：T2407，已合入 `main`；起点 `77040d0`。

**问题**

模板默认首页就是 OnwardKit 售卖站首页：Hero 写「Next.js SaaS starter」「Buy now」「下载链接邮件发送」，交付卡、省时清单、FAQ 都在卖模板本身。买家拿到包、换个名字上线，首页卖的是模板而不是他的产品（`../promo-image-studio` 就是这样）。售卖站和模板默认值也没法各自演进。

**决定**

- 售卖站专属内容不随包：放在 `seller/`（`site.json` + `messages/{en,zh}.json`），`release-package.sh` 的 `exclude_paths` 排除。
- 通用覆盖机制 `src/core/config/overlay.ts`：`SITE_OVERLAY_DIR` 指向目录，`site.json` 的 `landing` / `nav` 整段替换并用同一 schema 校验，messages 按 locale 深合并；目录不存在或校验失败直接报错。首页、顶栏、i18n request 用它；`next.config.ts` 在设了变量时把目录加进 `outputFileTracingIncludes`。
- 买家默认首页改成虚构的 AI 商品图工具 Acme：hero → features → testimonials → pricing → faq → cta，按钮去登录 / 定价；示例评价、FAQ、Metadata、页脚标语、`description`（新增 `SITE_DESCRIPTION` 覆盖）都按产品写。
- 原来写死的卖模板行为变成配置：`landing.demo`（按钮和顶栏去 `/demo`）、`landing.hero.colorSwitcher`、`landing.hero.stepIcons`、`landing.deliverables`（交付清单不再写死 4 项）。
- 售卖站部署设 `SITE_OVERLAY_DIR=seller`、`SITE_DESCRIPTION=The starter kit for your AI business.`，页面与改动前一致。

**验收**

- [x] 默认首页无 starter / template / OnwardKit 字样；`SITE_OVERLAY_DIR=seller` 时区块、按钮、文案与改动前一致（中英、1440 / 375，无横向溢出、无 console error）
- [x] 覆盖机制单测：无变量不变、整段替换并补默认值、非法字段带路径报错、目录不存在报错、messages 深合并
- [x] `SITE_OVERLAY_DIR=seller` 跑 `src/core/marketing`：中英所有区块文案都能解析
- [x] `pnpm test`（1689 passed，2 项按设计跳过：未设 `SITE_OVERLAY_DIR` 时的覆盖渲染）、`pnpm typecheck`、`pnpm lint`、`pnpm english:check`
- [x] `ui-shell`、`landing`、`i18n/locale` e2e 通过；品牌色预览 e2e 在 `colorSwitcher` 关闭时跳过，开关由单测覆盖
- [ ] 售卖站部署环境加 `SITE_OVERLAY_DIR=seller` 和 `SITE_DESCRIPTION`（合并后、下次部署前）

## T2409 seller-seo

- 分支 / worktree：`fix/seller-seo` → `../sass-seller-seo`
- 依赖：T2408，已合入 `main`；起点 `5b03dad`。

**问题**

2026-10-01 以 Googlebot UA 审计生产站 `sass.linonward.com`：robots、canonical、hreflang、SSR 正文、alt 都没问题，问题在首页之外。

- `/pricing` 还是模板默认产品的文案：「免费开始，需要更多时升级」、「每月 2,000 积分」、「终身更新」，meta description 也是。首页写的是 $199 一次性、一年更新加邮件支持，两边互相矛盾。T2408 的覆盖只换了首页和导航，没覆盖 `Landing.pricing` / `Billing.pricing`。
- `/blog` 只有模板自带的 `hello-world` 示例文章和两个标签页，全部在 sitemap 里，对售卖站是薄内容。
- 首页 title「Turn your AI product into a business | OnwardKit」里没有品类词，只有已经知道品牌的人能搜到。同类产品（NEXTY.DEV 等）的 title 都写了「Next.js SaaS Boilerplate」。

**做**

1. `seller/messages/{en,zh}.json` 覆盖 `/pricing`：标题、副标题、套餐名「OnwardKit template / OnwardKit 模板」、三条权益（完整源码、上手指南与示例、一年更新与邮件支持）、按钮「Buy {plan}」，以及与之一致的 meta description（不写价格，价格可由 `SITE_PRICE_LIFETIME` 改）。
2. 覆盖机制加 `blog: { noIndex }`（`src/core/config/overlay.ts`）：博客页面输出 `noindex`，并从 sitemap 和 llms.txt 去掉，保持「可索引 ⇔ 在 sitemap」。售卖站 `seller/site.json` 打开；买家默认不受影响。导航里的博客入口保留。
3. 首页 `Metadata.homeTitle` 改成「Next.js AI SaaS Starter with Payments & Credits」/「带收款和积分的 Next.js AI SaaS 模板」，H1 不变。这一条推翻了 T2402「title = Hero 主张」的做法：品牌词已经能搜到，title 用来接品类长尾词。

**验收**

- [x] `SITE_OVERLAY_DIR=seller SITE_HIDDEN_PLANS=free,pro` 本地：首页 / `/pricing` 中英 title、description 正确；`/pricing` 只有一张 $199 卡片，文案与首页交付卡一致；1440 / 375 无横向溢出
- [x] 同一环境：`/blog`、`/blog/hello-world`、`/blog/tags/guides` 输出 `noindex, nofollow`；sitemap 和 llms.txt 里没有 `/blog`
- [x] 单测：`blog.noIndex` 默认关、打开后生效、拼错字段报错；打开时博客 sitemap 为空；博客 sitemap 测试不再继承 shell 里的 `SITE_OVERLAY_DIR`
- [x] `pnpm test`（1719 passed，2 项按设计跳过）、`SITE_OVERLAY_DIR=seller` 跑 `src/core/{marketing,config,blog}`（174 passed）、`pnpm typecheck`、`pnpm lint`、`pnpm english:check`
- [x] `ui-shell`、`landing`、`seo` e2e：55 passed，3 项按设计跳过
- [ ] 合并部署后在生产复查，并在 Search Console 提交 sitemap、请求重新抓取首页和 `/pricing`

**不做**

- `Product` + `Offer` 结构化数据：价值低，等这三项生效后再看。示例评价不进结构化数据。
- 邮件里的套餐名走 `loadMessages`，不经过覆盖，仍显示「Lifetime」。另开任务。
