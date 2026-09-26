# 视觉系统

状态：T605 落地（2026-09-26），T606 补上产品面/后台的第二个语域（§4.5），T607 把营销侧剩下的细节页（blog 卡片、文章页、法律页、404）收进同一套语言。这套东西不是风格偏好，是模板的一部分：买家换一个色就把整站换掉。

## 1. 视觉主题与氛围

营销面：暖调画布 + 暖墨文字，区块是**横向色带**用波浪分隔，不是留白里漂着的卡片。每个表面都是一张**贴纸**：1px 描边加一条零模糊的硬唇边，描边色和唇边色永远是同一个值。标题用有体量的 display 字体，正文用克制的无衬线，靠两者的对比制造层级，而不是靠加粗。

产品面/后台：同一套 token，但表面是平的（没有唇边）、单一画布、密度更高。两个语域的分工见 §4.5。

参考了 [creem.io](https://www.creem.io) 的结构语言（色带节奏、硬边深度、产品拼贴），但没有搬它的品牌身份：配色从一个配置色推导，字体、logo、文案都是本模板自己的。

## 2. 调色板与角色

**整站颜色由一个 hex 推导**：`site.config.ts` 的 `brand.primaryColor`。推导逻辑在 `src/core/theme/brand-css.ts`，注入到根布局的 `<style>` 里。

| token                  | 推导规则                             | `#4f46e5` 的结果 | 用途                      |
| ---------------------- | ------------------------------------ | ---------------- | ------------------------- |
| `--primary`            | **原样保留配置的 hex**               | `#4f46e5`        | 实心 CTA、强调            |
| `--primary-foreground` | 实测量两种文字色取对比度高的         | `#fcf9f7`        | 写在 `--primary` 上的文字 |
| `--primary-edge`       | 同色相，`L = fill.L − 0.22`          | `#21097c`        | 描边 + 硬唇边             |
| `--primary-text`       | 同色相 `L = 0.50`，压到画布上可读    | `#4f54bc`        | 浅底上的文字和图标        |
| `--primary-band`       | 同色相 `L = 0.93`，chroma ≤ 0.05     | `#e2e6ff`        | 整块色带背景              |
| `--background`         | 中性色，色相偏向品牌，chroma `0.006` | `#f4f4f9`        | 画布                      |
| `--band-tint`          | 同上，`L = 0.921`                    |                  | 浅色带（比画布深一档）    |

中性色阶（画布 / 卡片 / 文字 / 边框）的**色相跟着品牌走**，chroma 只有 0.006。几乎看不出来，但整页会隐隐和品牌色协调：绿色品牌得到偏暖的底，靛蓝品牌得到偏冷的底。

`--primary` 保持原始 hex 不粉彩化，两个原因：买家填的色就该原样出现在自己站上；而且 CTA 需要饱和色才立得住，浅色只负责大面积色带。`e2e/ui-shell.spec.ts` 断言主按钮背景**精确等于**配置值，这条也锁住了这个决定。

**语义色是固定的，不跟品牌走**（薄荷/琥珀/天蓝/红）。每个语义色四个 token：

| token                                                  | 用途                                             |
| ------------------------------------------------------ | ------------------------------------------------ |
| `--success` / `--warning` / `--info` / `--destructive` | 中调：文字、描边、图标，在画布上可读             |
| `--S-band`                                             | 粉彩填充：大面积色块、徽章底                     |
| `--S-edge`                                             | 给 band 表面做描边和唇边                         |
| `--S-foreground`                                       | 写在 band 上的文字（永远是暖墨，粉彩上不用白字） |

> `--destructive` 故意保持「能当文字用」的中调，没有做成粉彩：全仓有十几处 `text-destructive` 的错误提示，换成粉彩会让它们直接糊掉。粉彩那档单独叫 `--destructive-band`。

**深色模式**：画布 `L = 0.20`。抬升靠背景明度台阶，不用投影（暗压暗的投影看不见）。`--primary` 两套一致，品牌锚点不随主题变。

## 3. 排版

| 角色       | 字体                    | 变量             | 用法                          |
| ---------- | ----------------------- | ---------------- | ----------------------------- |
| Display    | **Bricolage Grotesque** | `--font-display` | h1 / h2 / 区块标题 / 价格数字 |
| 正文与界面 | Geist Sans              | `--font-sans`    | 其余全部                      |
| 等宽       | Geist Mono              | `--font-mono`    | 终端和结账台 mock             |

标题字体为什么是 Bricolage 而不是参考站的 Gasoek One：模板不该套另一个品牌的字体身份；而且 Bricolage 是可变字重（200–800），在小字号也撑得住（卡片标题、套餐名都要用它），不是只能看大标题的纯 display 面。

- H1 `clamp(2.25rem, 7vw, 4.25rem)`，weight 600，`line-height 0.98`，`tracking -0.02em`
- 区块标题 `.heading-display`，`text-3xl` → `sm:text-4xl`
- 价格和数字加 `data-numeric`（`font-variant-numeric: tabular-nums`），更新时不跳动
- 标题 `text-wrap: balance`，正文 `text-wrap: pretty`，正文宽度 ≤ 46–65ch
- **CJK**：拉丁面在前、系统 CJK 面在后；CJK 段不加负字距（收紧汉字会挤字形，像渲染 bug）

## 4. 组件样式

### 颜色策略只有一条：`--edge`

一个变量同时驱动 1px 描边和零模糊硬唇边。改 `--edge` 就换了整套表面的颜色。

```css
.sticker    { --edge: var(--border); border: 1px solid var(--edge); --tw-shadow: 0 2px 0 0 var(--edge); ... }
.sticker-lg { /* 同上，唇边 4px，大表面用 */ }
```

`--edge` 必须给默认值。不给的话它会落到 `@property` 的 `initial-value`（透明），唇边画不出来也看不出来，只会静默少一层深度。

唇边写进 `--tw-shadow` 而不是裸 `box-shadow`：`focus-visible:ring-3` 会用 `box-shadow` 整属性覆盖，只有走 `--tw-shadow` 才能在聚焦时存活。

### 各组件

| 组件       | 变体                                                                            | 状态                                                    |
| ---------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `Button`   | `variant` 6 种 × `size` 9 种（含 `marketing` 44px）× `tone` 5 种                | hover 下沉 1px、唇边收到 1px；active 再沉 1px、唇边归 0 |
| `Card`     | `tone` 5 种 → 贴纸；**不传 tone → `.panel`（产品面平面）**                      | 静态，不做 hover 抬升                                   |
| `Badge`    | 原 6 种 + `band` / `success` / `warning` / `info` / `destructive-band` × `flat` | 营销面胶囊 + 唇边；`flat` 去掉唇边（产品面用）          |
| `Input`    | 沿用                                                                            | 8px 圆角，实底，focus ring                              |
| `Textarea` | 沿用 `Input` 的样式串                                                           | 同上                                                    |

`tone` 在 `cva` 里必须声明在 `variant` **之后**：cva 按 variants 的键序输出 class，排在前面的话 `variant="outline"` 的 `border-border` 会盖掉 tone 的描边。

`Badge` 的 `flat` 同理必须声明在 `variant` 之后，并且靠 `compoundVariants` 给语义档补 `sticker`：默认 `flat: false`，营销页的渲染逐字节不变。

**`.panel` 必须声明在 `.sticker` 之前**：两者都写 `border: 1px solid var(...)`，同层同特异性时源码顺序决定胜负，排后面会把贴纸的描边颜色盖成中性色，只剩唇边是语义色 —— 而且完全静默。

## 4.5 两个语域

同一套 token，两种表面语言。**营销面说服人，产品面干活。**

|      | 营销面                       | 产品面 / 后台                                                           |
| ---- | ---------------------------- | ----------------------------------------------------------------------- |
| 表面 | `.sticker` / `.sticker-lg`   | `.panel`：1px 描边，**零唇边**                                          |
| 底色 | 横向色带 + 波浪分隔          | 单一画布；面板用 `--card`（亮色下与画布几乎同色，暗色下靠明度台阶抬起） |
| 标题 | display，clamp 2.25–4.25rem  | display，`text-2xl` / `sm:text-3xl`（`PageHeader`）                     |
| 节奏 | `py-14 sm:py-20`，靠色带     | `py-6 sm:py-8`，靠 1px 线和间距                                         |
| 容器 | `.container-marketing` 80rem | `max-w-5xl`（产品页）/ `max-w-6xl`（后台数据页）                        |
| 表格 | 不用                         | 不套面板，直接躺在画布上；表头大写小标题，行间 1px 线                   |

**唇边的不变式：`--edge` 是给「坐在表面之上的独立物件」的厚度。** 按钮是物件（会按下），营销页的粉彩徽章是物件（贴在色带上）。面板是表面本身，所以平。产品面因此没有一处唇边：按钮不传 `tone`，徽章传 `flat`。需要语义色描边时直接 utility 给 `border-[var(--x-edge)]`，平描边不算物件。

**状态色只标异常。** 后台表格里正常态（`paid` / `active`）用中性填充，需要看一眼的才上色：`warning` 给部分退款和欠费，`info` 给已退款，`destructive-band` 给失败和封禁，`outline` 给已取消/已过期。每行都绿一遍等于没标。

**表格不套面板。** 面板留给「成块的内容」（StatTile、MetricSection、Card、空状态）。表格套面板会在暗色下变成同色 + 一堆同强度细线，而且 375px 时会出现「面板不滚、表格滚」的双层滚动。

**营销侧的细节页也走这套**：blog 列表（浅色带页头、波浪过渡到画布，文章是贴纸卡片）、文章页与法律页（`max-w-3xl` 正文 + display 标题）、404 与错误页（display 标题 + 44px 营销 CTA）。这些页里的正文链接用 `--primary-text`，不用 `--primary` —— 后者保留配置原 hex，压在画布上暗色只有 2.88:1。

`src/app/[locale]/not-found.tsx` **自己渲染 `SiteHeader` / `SiteFooter`**：它挂在 `[locale]/` 下、不在 `(marketing)` 组里，穿不到那个 layout，而 404 也需要站内导航。`error.tsx` 是客户端边界，渲染不了服务端组件，所以只有 CTA 和标题归这套语域，没有 Header / Footer。

## 5. 布局

- 容器 `.container-marketing`：`max-width 80rem`，内边距 16 / 32 / 40px 三段
- 区块纵向留白 `py-14 sm:py-20`（比常见的 96–160px 紧），分隔靠色带和波浪，不靠留白
- 顶栏 `--header-height: 4.375rem`；区块的 `scroll-mt` 从这里推出来，锚点跳转才不会被顶栏盖住
- 网格：特性 3 列 + 跨度错落（bento）；定价按套餐数 2/3 列；FAQ 左标题右列表

## 6. 深度与抬升

**没有模糊投影，一处都没有。** 深度只有两个来源：

1. **贴纸表面**：1px 描边 + 同色零模糊唇边（2px 小、4px 大）。像模切贴纸。
2. **背景色台阶**：画布 → 卡片 → 弹层，相邻面明度差 ≥4%。暗色主题全靠这个，因为暗压暗的投影看不见。

嵌套圆角按 `外 = 内 + padding` 推，别让两层圆角看起来是随手定的。

## 7. Do's 和 Don'ts

- **彩色带上用暖墨，不用白字。** 白字只出现在品牌色实心按钮上（且由 `foregroundFor` 按对比度决定）。
- **不加模糊投影。** 深度只来自描边和唇边，需要更强的抬升就加厚唇边或退一档背景。
- **不用渐变，不用 `backdrop-filter`。** 顶栏是实底，玻璃感会击碎硬边的分层逻辑。
- **组件里不写死 hex。** 全部走 token；新颜色先加 token。
- **不切开 h1 的文本节点。** e2e 断言 h1 的可访问名精确等于 `Landing.hero.title`，拆成多个 span 会改变可访问名。
- **价格和标签不用省略号截断。** 长内容换行或压缩格式。
- **Tailwind class 名必须是字面量。** 扫描器读的是源文件文本，`` `[--edge:var(--${tone}-edge)]` `` 抽出来的是废片段，样式会静默消失。
- **文案里别写裸花括号。** next-intl 按 ICU 解析，`streamText({ model })` 会被当成占位符报错。`landing.test.tsx` 有一条测试兜这个。

## 8. 响应式

- 断点：`sm 640` / `md 768` / `lg 1024` / `xl 1280`
- 顶栏在 `md` 以下把导航收进抽屉（`MobileNav`），顶栏 CTA 在 `sm` 以下隐藏（375px 下四个控件挤一行太憋）
- 特性网格的跨度只在 `lg` 生效，窄屏退化成单列/双列等宽
- 首屏拼贴用负外边距叠压，**不用绝对定位**：绝对定位在窄屏上最容易把页面撑出横向滚动条
- 波浪 `h-10 sm:h-16`，SVG 画 200% 宽居中，避免窄屏把波峰压柴
- 触控目标 ≥40px；`html` 上 `touch-action: manipulation` 消除双击缩放延迟
- **375px 不横向溢出是 e2e 锁死的行为**（亮暗两套都测）

## 9. 给 agent 的速查

颜色（名: 值，以默认靛蓝品牌为例）：`primary #4f46e5` · `primary-edge #21097c` · `primary-text #4f54bc` · `primary-band #e2e6ff` · `background #f4f4f9` · `band-tint` · `card #f8f9fd` · `foreground(muted) #191614` · `muted #ebecf2` · `border #d7d9de` · `success #2b7440` / band `#d4f1d8` · `warning #825b00` / band `#f8e5c7` · `info #0e6a9b` / band `#d2ecff` · `destructive #984742` / band `#ffdfdc` · `footer #1a1715`

可直接粘的示例：

> 在 `{primary-band}` 色带上做一个区块，标题用 `.heading-display` 的 `text-4xl`，颜色 `{foreground}`，副文 `text-lg` 颜色 `{muted-foreground}`，宽度 ≤46ch。主 CTA 用 `buttonVariants({ size: "marketing", tone: "primary" })`，次要 CTA 加 `variant: "outline"` 和 `bg-background`。

> 加一张卡片：`bg-card sticker rounded-xl p-6`，`--edge` 默认是 `--border`；要换成语义色就加 `[--edge:var(--info-edge)] border-[var(--edge)]`。卡片标题用 `.heading-display text-lg`。

> 加一个语义徽章：`<Badge variant="info">`，它自带 `bg-info-band text-info` 加描边和唇边。

> 在产品面/后台加一块内容：`panel p-6`，标题 `.heading-display text-lg`。面板没有唇边；要语义色描边就加 `border-[var(--info-edge)]`。状态徽章加 `flat`：`<Badge variant="warning" flat>`。

> 产品面的页头用 `<PageHeader title description>`（`src/core/ui/page-header.tsx`）。它不 import `Link`，因为那会把服务端页面拖进客户端边界 —— 返回链接和右侧操作以 children 传进去。
