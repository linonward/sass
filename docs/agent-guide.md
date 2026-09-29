# 给 AI 编码助手的项目指引

写给在这个项目里写业务代码的 AI 编码助手（Claude Code、Cursor、Codex 之类），也写给指挥它们的你。内容是这个模板的几条「踩了会在下一次升级时还债」的线：目录边界、怎么加一个业务页面、数据库迁移、测试、升级。

本文件随买家分发包一起交付，也会随模板的差量更新一起更新 —— 所以**别直接改它**，你自己的项目规则写在 `AGENTS.md` 里（见下一节）。

## 让助手读到这份指引

前提：已经按 [docs/starter-guide.md](starter-guide.md) 第 1–4 步建好基线提交、装好依赖、写好 `.env.local` 并执行过 `pnpm db:migrate`（先 `git init` 再 `pnpm install`，git 钩子才装得上）。

编码助手打开仓库时自动加载的是根目录的 `AGENTS.md`（Cursor、Codex 等）或 `CLAUDE.md`（Claude Code），不会自己去翻 `docs/`。分发包里**没有**这两个文件：它们属于你的项目，模板不提供、差量更新也不会碰。在仓库根目录建一次：

```bash
cat > AGENTS.md <<'EOF'
# AGENTS.md

写代码前先读 docs/agent-guide.md（目录边界、加页面的步骤、迁移、测试、升级）。
EOF
printf '@AGENTS.md\n' > CLAUDE.md
git add AGENTS.md CLAUDE.md && git commit -m "docs: point coding agents to the agent guide"
```

之后你自己的规则（产品是做什么的、命名习惯、哪些页面不要动）都往 `AGENTS.md` 里加。

**`pnpm dev` 会往 `AGENTS.md` 里追加一段英文**（跑 e2e 也会：Playwright 启动的就是 `pnpm dev`）。 Next.js 的开发服务器检测到自己跑在 AI 编码助手里时，会在 `AGENTS.md` 末尾写入一段以 `<!-- BEGIN:nextjs-agent-rules -->` 开头、标题为「This is NOT the Next.js you know」的说明（提醒助手按 `node_modules/next/dist/docs/` 里的文档写代码，而不是凭训练数据）。这是 Next.js 自己的行为（`node_modules/next/dist/server/lib/generate-agent-files.js`），不是文件被改坏了：

- 你上面写的内容不会被覆盖，它只维护那两个标记之间的一段；
- 删掉它，下次 `pnpm dev` 还会写回来 —— 直接和你的改动一起提交，工作区就干净了；
- 如果 `AGENTS.md` 和 `CLAUDE.md` 都不存在，它会两个都新建（`CLAUDE.md` 里只有 `@AGENTS.md`）；这时补上指向本文件的那一行即可。

那段提醒是对的：这个项目用的 Next.js 版本与很多模型的训练数据有出入（例如中间件文件叫 `src/proxy.ts`，路由参数 `params` 是 Promise），写 Next.js 相关代码前先查 `node_modules/next/dist/docs/`。

## 硬规则

1. **不改 `src/core/`。** 需要的东西从 `@/core/...` 导入；缺能力时先找配置项（`site.config.ts`），找不到再改，改动要小并在提交信息里写原因。
2. **业务代码放 `src/features/<name>/`**，路由文件放 `src/app/[locale]/(app)/<name>/page.tsx` 且只做转发。
3. **改了表结构就 `pnpm db:generate`，生成的 SQL 不手改**，提交前跑 `pnpm migrations:check`。
4. **文案进 `messages/`，`en.json` 和 `zh.json` 的 key 必须一一对应**（`pnpm test` 会查）。
5. **界面遵守 `docs/design.md`**：颜色从配置色推导，没有模糊投影（不写 `shadow-sm/md/lg`），组件用 `@/core/ui/*`。
6. **交付前至少跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`**；改了页面再跑对应的 e2e（见[测试](#测试)）。
7. **提交信息用 Conventional Commits**（`feat: …` / `fix: …`），`git commit` 时钩子会检查。

## 目录边界

模板以后发新版本时，买家用差量更新包升级（[UPGRADING.md](../UPGRADING.md)）。更新包只含**模板自己的文件**，应用脚本对每个文件做三路合并：你没动过的文件直接换成新版，你动过、模板这次也动了的文件要合并，合不上就留下冲突标记等你手工处理。所以目录边界的意义很具体：**你在模板文件上改的每一行，都是以后每次升级时可能要解的冲突；你新建的文件，更新包永远不会碰。**

| 路径                                              | 归属 | 对升级的影响                                                                         |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| `src/core/**`                                     | 模板 | 升级改得最多的地方。改一行，以后每次模板动到这个文件都要手工合                       |
| `src/app/[locale]/(marketing)/**`、`(admin)/**`   | 模板 | 落地页、定价、法律页、博客、后台；同上                                               |
| `src/app/api/**`                                  | 模板 | 登录、支付、上传、AI、webhook 的接口；同上                                           |
| `drizzle/`                                        | 两边 | 两边都会新增迁移，编号可能撞车；升级脚本在这里会停下让你处理（见[数据库](#数据库)）  |
| `src/features/<你的模块>/`                        | 业务 | 你新建的目录，升级不会碰                                                             |
| `src/app/[locale]/(app)/<你的页面>/`              | 业务 | 同上；模板自带的 `dashboard`、`billing`、`settings` 等页面仍归模板                   |
| `site.config.ts`、`messages/*.json`               | 业务 | 模板也会往里加新字段 / 新文案。改值、加自己的 key 都行，别删模板的 key、别重排       |
| `content/**`、`public/**`                         | 业务 | 法律页正文、博客、图片；随便改                                                       |
| `src/features/example/`、`src/features/invoices/` | 模板 | 示例模块。要么原样留着，要么整个删掉（删法见各自文件里的清单），别在上面改成你的业务 |

最后一行值得多说一句：想从示例起步，**复制**到一个新名字（`src/features/projects/`）再改，而不是就地改示例。就地改的话，模板以后修示例时你会收到一堆和业务无关的冲突；删掉的文件则会被升级脚本跳过，不会被塞回来。

## 加一个业务页面

以一个登录后可见、出现在侧边栏里的「Projects」页为例，业务名 `projects`。整个过程**不改 `src/core/` 的任何文件**。

### 1. feature 模块

`src/features/projects/page.tsx`：页面本体。套件的能力都从 `@/core` 导入。

```tsx
import { getTranslations } from "next-intl/server";

import { requirePageSession } from "@/core/auth/session";
import { buildMetadata } from "@/core/seo/metadata";
import { EmptyState } from "@/core/ui/empty-state";
import { PageHeader } from "@/core/ui/page-header";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Projects" });
  return buildMetadata({
    locale,
    path: "/projects",
    title: t("title"),
    noIndex: true,
  });
}

export default async function ProjectsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Projects" });
  // (app) 的 layout 已经挡住了未登录访问；这里取 session 是为了拿当前用户。
  const { user } = await requirePageSession(locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description", { email: user.email })}
      />
      <EmptyState
        titleAs="h2"
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    </div>
  );
}
```

纯逻辑（计算、校验、格式化）放同目录的普通模块里（如 `src/features/projects/projects.ts`），单测才好写。要看完整一点的写法：`src/features/example/`（调 AI、扣积分）和 `src/features/invoices/`（表 + 列表 + Server Actions 的 CRUD）。

### 2. 路由文件

`src/app/[locale]/(app)/projects/page.tsx` 只有一行转发：

```tsx
export { default, generateMetadata } from "@/features/projects/page";
```

放在 `(app)` 下的页面自动需要登录（未登录会跳到 `/sign-in`）。

### 3. 侧边栏菜单

`site.config.ts` 的 `dashboard.nav` 里加一项：

```ts
dashboard: {
  nav: [
    // …保留已有的项
    { key: "projects", href: "/projects", icon: "layers" },
  ],
},
```

- `key` 对应文案 `Dashboard.nav.<key>`；`href` 必须是站内路径；
- `icon` 只能从 `src/core/config/schema.ts` 的 `dashboardIcons` 里选（`home`、`settings`、`layers`、`sparkles`、`fileText`、`chart`、`users`、`creditCard`、`key`、`flag`、`receipt`），写别的会在启动时报配置错误；
- 这些项显示在侧边栏的 **Product** 组（文案 `Dashboard.businessNav`），Dashboard / Billing / Settings 这些套件自带的项在另一组；
- 列在这里的路径，未登录访问时跳登录页会带上回跳地址（`/sign-in?callbackURL=%2Fprojects`）。

### 4. 文案

`messages/en.json` 和 `messages/zh.json` **都要改，key 必须一致**。下面是示意结构（注释只为说明，真正的 JSON 里不能写注释）：

```jsonc
// messages/en.json
{
  "Dashboard": {
    "nav": {
      // …已有的 key 保留
      "projects": "Projects",
    },
  },
  // 顶层新增一个命名空间，名字和 getTranslations 的 namespace 对上
  "Projects": {
    "title": "Projects",
    "description": "Everything you're working on, {email}.",
    "emptyTitle": "No projects yet",
    "emptyDescription": "Projects you create will show up here.",
  },
}
```

`zh.json` 同样的结构，填中文。新增一门语言见 [docs/i18n.md](i18n.md)。

验证：

```bash
pnpm test src/core/i18n/messages.test.ts   # en/zh key 一致、侧边栏 key 都有文案
pnpm typecheck                              # 路由类型和 site.config 字段
pnpm dev                                    # 登录后侧边栏出现 Projects，点进去能打开
```

### 5. 单测

单测放在被测文件旁边，命名 `*.test.ts` / `*.test.tsx`（`vitest.config.mts` 只收 `src/**` 下的这两种）。比如 feature 里有一个纯函数：

```ts
// src/features/projects/projects.ts
export function slugify(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}
```

```ts
// src/features/projects/projects.test.ts
import { describe, expect, test } from "vitest";

import { slugify } from "./projects";

describe("slugify", () => {
  test("转小写、空白换成连字符", () => {
    expect(slugify("My First Project")).toBe("my-first-project");
  });
});
```

```bash
pnpm test src/features/projects   # 只跑这个模块
pnpm test                         # 全量
```

组件测试的写法参考 `src/features/example/tagline-tool.test.tsx`。

### 6. e2e

`e2e/projects.spec.ts`，登录用 `e2e/auth-helpers.ts` 里的现成函数，文案直接从 `messages/en.json` 读（改文案不用改测试）：

```ts
import { expect, test } from "@playwright/test";

import messages from "../messages/en.json";
import { signIn, uniqueEmail, useRandomIp } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await useRandomIp(page); // 每个用例换一个 IP，免得撞上登录限流
});

test("未登录访问跳登录页，登录后回到 Projects", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fprojects/);
  await signIn(page, uniqueEmail("projects"));
  await expect(page).toHaveURL("/projects");
  await expect(
    page.getByRole("heading", { name: messages.Projects.title, level: 1 }),
  ).toBeVisible();
});
```

怎么跑见下一节。

## 数据库

业务的表写在 `src/features/<name>/schema.ts`（`drizzle.config.ts` 会自动收录这个路径，不用在 `src/core` 里登记）。写法照抄 `src/features/invoices/schema.ts`：主键、`user_id` 外键带 `onDelete: "cascade"`，钱用整数存最小货币单位；所有读写都带 `user_id` 条件。

顺序固定：

```bash
# 1. 改 src/features/<name>/schema.ts
pnpm db:generate --name <name>   # 2. 生成迁移：drizzle/<编号>_<name>.sql + drizzle/meta/ 下的快照
pnpm migrations:check            # 3. 离线检查：编号连续、when 严格递增、快照链闭合
pnpm db:migrate                  # 4. 应用到 DATABASE_URL 指向的库（先本地，再线上）
```

- 生成的 SQL 和 `drizzle/meta/` **不要手改**，要改就改 schema 再生成一条新迁移。
- 已经在生产库执行过的迁移不要删掉重建。
- 数据库单测读 `DATABASE_URL_TEST`：没设时整组跳过、退出码仍然是 0。`.env.example` 里这一行默认启用，且和 `DATABASE_URL` 指向**同一个库** —— 照抄 `.env.local` 的话，测试数据会写进你的开发库；想分开就建一个单独的库（例如 `.../postgres_test`）再改这一行。
- **升级时编号撞车**（你加了 `0024_projects`，模板的新版本也带来一条 `0024_…`）：升级脚本会在 `drizzle/` 整块停下、一个文件都不动，并打印处理步骤 —— 保留模板那条的编号，用 `pnpm db:generate --name <你原来的名字>` 重新生成你自己的那一条。完整步骤在 [UPGRADING.md 的迁移冲突](../UPGRADING.md#迁移冲突)。

## 测试

| 命令                                     | 什么时候跑                                      |
| ---------------------------------------- | ----------------------------------------------- |
| `pnpm lint`                              | 每次提交前（钩子只查暂存的文件）                |
| `pnpm typecheck`                         | 改了路由、`site.config.ts`、类型之后            |
| `pnpm test`                              | 每次提交前                                      |
| `pnpm migrations:check`                  | 动了 `drizzle/` 之后                            |
| `npx playwright test e2e/<name>.spec.ts` | 改了页面之后（完整命令见下）                    |
| `pnpm build`                             | 上线前；占位值没改、文案 key 缺失都会在这里拦下 |

### 跑 e2e

第一次先装浏览器：

```bash
pnpm exec playwright install chromium
```

前提：本地 Postgres 在跑、已经 `pnpm db:migrate`、`.env.local` 里有 `DATABASE_URL`（Playwright 会自动读 `.env.local`，不用写进命令）。

**只跑自己的用例**（最小可用命令）：

```bash
EMAIL_TRANSPORT=file E2E_PORT=3100 npx playwright test e2e/projects.spec.ts --project=desktop
```

- `EMAIL_TRANSPORT=file` 是必须的：登录验证码要写到 `.tmp/emails/`，`signIn()` 从那里读。本地默认是 `console`，验证码只打到终端，用例会卡在输验证码那一步。
- `E2E_PORT` 换一个不是 3000 的端口：你开着 `pnpm dev` 时，Playwright 会直接复用那个服务器，测的可能不是当前代码。
- 去掉 `--project=desktop` 会再按手机尺寸（`mobile`）跑一遍。
- 跑完 `AGENTS.md` 多出一段英文是正常的，见[让助手读到这份指引](#让助手读到这份指引)。
- 每次运行会额外起一个多语言副本站点（`e2e/i18n/serve.ts`：把仓库复制到临时目录、装依赖、启动），第一次要多等一两分钟。它用 `git ls-files` 列文件，所以仓库要先 `git init`。

**跑全量**（改了共享的东西，或者提交前想跑一遍完整的）。模板自带的用例依赖下面这整组变量，**整组照抄**：

```bash
EMAIL_TRANSPORT=file E2E_PORT=3100 \
  ADMIN_EMAILS=e2e-admin-desktop@example.com,e2e-admin-mobile@example.com,e2e-admin-acquisition-desktop@example.com,e2e-admin-acquisition-mobile@example.com,e2e-admin-status-desktop@example.com,e2e-admin-status-mobile@example.com,e2e-admin-flags-desktop@example.com,e2e-admin-flags-mobile@example.com \
  BILLING_PROVIDER=fake BILLING_SUCCESS_TIMEOUT_MS=8000 \
  CREEM_PRODUCT_ID_PRO=prod_ci_fake_pro CREEM_PRODUCT_ID_LIFETIME=prod_ci_fake_lifetime \
  SITE_NAME="CI Site" SITE_DOMAIN=ci.example.test \
  SITE_LEGAL_NAME="CI Legal Entity" SITE_EMAIL_FROM=noreply@ci.example.test \
  npx playwright test
```

这组值和 `.github/workflows/ci.yml` 顶部的 `env:` 是同一份。少设一条不一定报错，更常见的是整块用例**静默跳过**（例如不设 `BILLING_PROVIDER=fake`，结账那条链路就不跑，汇总照样全绿）；只设一半则会让断言自相矛盾地红。`ci.yml` 里另外三条 `ALLOW_*` 只有按生产构建跑（`pnpm build` 之后 `CI=1 npx playwright test`）时才需要补上。

另外三个套件各带自己的配置：`pnpm test:e2e:acquisition`、`pnpm test:e2e:flags`、`pnpm test:e2e:invoices`，同样认上面这组变量。

**所有页面一起报 `SyntaxError: Unexpected non-whitespace character after JSON`**：`.next/dev/` 里的缓存被中断的 dev server 写坏了，不是代码问题，`rm -rf .next` 重来。

## 升级

卖家发布新版本时会给你一个 `sass-template-update-<旧版本>-to-<新版本>.zip`。步骤：

```bash
git status                                            # 0. 工作区要干净：先提交手上的改动
scripts/apply-template-update.sh ~/Downloads/sass-template-update-<旧>-to-<新>.zip
# 1. 脚本非零退出 = 有冲突或迁移要处理，按它打印的清单逐个解决，别跳过
pnpm install && pnpm test                             # 2. 依赖与验证（动了表再加 pnpm db:generate）
git add -A && git commit -m "chore: upgrade template to <新版本>"   # 3. 你自己提交
```

- 根目录的 `template.json` 记录你手里是哪个版本，**别手改**；它不对时脚本会拒绝应用，提示先补中间版本。
- 助手在帮你升级时：**不要替用户解决语义冲突后顺手提交**，冲突文件列出来让人看；解决完用 `--resolved <路径>` 重跑一次，基线才会推进。
- 冲突标记、`--resolved`、`--migrations-done` 的用法和常见冲突（`pnpm-lock.yaml`、`site.config.ts`、`messages/en.json`）都在 [UPGRADING.md](../UPGRADING.md)。

## 还有哪些文档

| 想做的事                           | 看哪里                                    |
| ---------------------------------- | ----------------------------------------- |
| 从零到上线、改成自己的站点         | [docs/starter-guide.md](starter-guide.md) |
| 所有配置项、上线清单、各模块的开关 | [README.md](../README.md)                 |
| 界面：颜色、表面、组件的用法       | [docs/design.md](design.md)               |
| 加一门语言                         | [docs/i18n.md](i18n.md)                   |
| 支付服务商                         | [docs/billing.md](billing.md)             |
| 升级、冲突处理                     | [UPGRADING.md](../UPGRADING.md)           |
