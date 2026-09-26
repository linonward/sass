# 合并模板的更新

业务项目是从这个模板复制出来的仓库，模板之后的更新（修 bug、新模块、依赖升级）靠 `git merge` 合并进来。能不能顺利合并，取决于业务代码有没有守住目录边界。

## 目录边界

| 路径                                            | 归属 | 说明                                                |
| ----------------------------------------------- | ---- | --------------------------------------------------- |
| `src/core/**`                                   | 模板 | 业务项目尽量不改；改了，合并上游时就要自己解决冲突  |
| `src/app/[locale]/(marketing)/**`、`(admin)/**` | 模板 | 落地页、定价、法律页、博客、后台的路由              |
| `src/app/api/**`                                | 模板 | 登录、支付、上传、AI 的接口                         |
| `drizzle/`                                      | 两边 | 迁移文件，两边都会新增，见下文"迁移冲突"            |
| `src/app/[locale]/(app)/**`                     | 业务 | 登录后的业务页面（模板自带的 dashboard 等页面除外） |
| `src/features/**`                               | 业务 | 业务逻辑、组件、表（`src/features/*/schema.ts`）    |
| `site.config.ts`                                | 业务 | 品牌、域名、功能开关、套餐、限流阈值、侧边栏菜单    |
| `messages/**`、`content/**`、`public/**`        | 业务 | 文案、法律页正文、博客文章、图片                    |

写业务时：

- 新功能放在 `src/features/<name>/`，路由文件放在 `src/app/[locale]/(app)/<name>/page.tsx`，只转发到 feature 里的页面（参考 `src/features/example/`）。
- 需要的东西从 `src/core` 导入（`runAI`、`deductCredits`、`getSession`、`buildMetadata`、`@/core/ui/*` 等），不要复制一份再改。
- 侧边栏菜单写在 `site.config.ts` 的 `dashboard.nav`，这些路径自动需要登录。
- 真的需要改 `src/core` 时，改动尽量小，并在提交信息里写清楚原因。能做成配置项或钩子的，优先提给模板仓库。

## 合并步骤

第一次，添加模板仓库为 `upstream`：

```bash
git remote add upstream https://github.com/linonward/sass.git
```

之后每次合并：

```bash
git checkout -b chore/merge-upstream
git fetch upstream
scripts/core-drift.sh            # 先看冲突范围，见下文
git merge upstream/main
pnpm install
pnpm db:generate                  # 检查迁移是否需要重新生成，见下文
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

合并完用一个 PR 提交，跑过 CI 再合入 `main`。部署时 Vercel 会先执行 `pnpm db:migrate`（见 `vercel.json`）。

模板的 README 和 `.env.example` 会记录新增的环境变量和外部服务，合并后对照检查一遍 Vercel 上的环境变量。

## 看冲突范围：`scripts/core-drift.sh`

```bash
scripts/core-drift.sh                  # 默认比较 upstream main
scripts/core-drift.sh origin main      # 指定其他远程和分支
CORE_PATHS="src/core src/app/api" scripts/core-drift.sh
```

输出三部分，都相对于本项目与上游的分叉点：本项目改过的套件文件（含未提交的改动）、上游改过的套件文件、两边都改过的文件。第三部分就是合并时最可能冲突的地方。第一部分为空时，直接合并即可。

## 常见冲突

**`pnpm-lock.yaml`**：不要手工合并。先解决 `package.json` 的冲突，然后：

```bash
git checkout --theirs pnpm-lock.yaml
pnpm install --no-frozen-lockfile
git add pnpm-lock.yaml
```

**迁移冲突**（`drizzle/meta/_journal.json`、`drizzle/meta/*_snapshot.json`）：两边各自新增了迁移，编号撞了。以上游为准，重新生成本项目的迁移：

```bash
git checkout --theirs drizzle/meta/_journal.json drizzle/meta/<冲突的快照>.json
git rm drizzle/<本项目那条冲突的迁移>.sql     # 例如 0012_projects.sql
pnpm db:generate --name <原来的名字>           # 生成新编号的迁移，内容只含本项目的表
git add drizzle
```

如果本项目那条迁移已经在生产数据库执行过，不要删除重建：先在一个 Neon 分支上执行 `pnpm db:migrate` 确认结果，再决定怎么处理。

**`src/core/db/schema/auth.ts`**：这个文件由 `pnpm auth:generate` 生成。冲突时取上游的版本，再运行 `pnpm auth:generate` 和 `pnpm db:generate`。

**`site.config.ts`、`messages/en.json`**：通常是上游加了新字段或新文案，保留本项目的值，同时加上上游新增的 key。`pnpm test` 会检查 messages 的 key 是否齐全，`defineConfig()` 会指出配置里缺的字段。

**快照测试**（`*.snap`）：改了域名、路由或文章后，运行 `pnpm test -u` 更新快照，检查一下 diff 再提交。

**`<Card>` 的默认外观**（T606 起）：不传 `tone` 时不再是原来那圈 `ring`，而是 `.panel`——1px `--border` 描边、和画布几乎同色的平面。业务页面里的 `<Card>` 会因此多出一根描边（改动很小，但确实会冲突）。`tone` 的行为没变，仍然是营销面的贴纸。

**`src/core/ui/page-header.tsx`、`empty-state.tsx`**（T606 新增）：产品面/后台的页头和空状态。业务页面如果自己写了 `text-2xl font-semibold tracking-tight` 的标题块，可以换成 `<PageHeader>` 跟上语域；不换也不会坏。

**界面上没有模糊投影**（T605 起）：`shadow-sm/md/lg` 在 `src/` 里一处都不该有。加新的浮动层时用 `.sticker`（物件：1px 描边 + 零模糊唇边）或退一档背景，不要加投影。
