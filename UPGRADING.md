# 升级到模板的新版本

业务项目是从这个模板复制出来的仓库，模板之后的更新（修 bug、新模块、依赖升级）要合进来。两条路：

- **差量更新包**（推荐）：卖家发布新版本时会给你一个 `sass-template-update-<旧版本>-to-<新版本>.zip`，里面只有这两个版本之间**随包交付的文件**的变动。应用脚本逐文件三路合并：你没动过的直接取新版，两边都改过的自动合、合不上就留下冲突标记等你处理。这条路不需要模板仓库的访问权，也不需要和它有共同的 Git 历史。
- **`git merge`**（可选）：把模板仓库加成 `upstream`，直接合并它的 `main`。只有从 GitHub「Use this template」起步、与模板有共同 Git 历史的项目成立；代价和限制见[用 git merge 合并](#用-git-merge-合并可选)。

两条路都建立在同一件事上：业务代码守住目录边界。

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

## 用差量更新包升级（推荐）

### 更新包里有什么

一个 zip，解压后是：

| 路径                | 是什么                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `update.json`       | 机器可读的变动清单：`from` / `to` 版本、每个文件的变动类型（`added` / `modified` / `deleted`）与权限位 |
| `new/`              | 新版本的文件                                                                                           |
| `base/`             | 变动文件在**上一版**里的样子 —— 三路合并的基线，平时不用看                                             |
| `new/template.json` | 新版本的版本基线，应用成功后由脚本接手（见下）                                                         |

包里没有模板作者的内部文档，也没有卖家的域名和测试凭据：更新包和发行包用的是同一份排除清单、同一套自检。

### 版本连续性：`template.json`

发行包（和每个更新包）里都带着一份 `template.json`：版本号、对应的提交、构建时间，以及**每个随包文件的 sha256**。两个作用：

- **校验起点**：应用脚本拿你的 `template.json` 的 `version` 和更新包的 `from` 比对，对不上就拒绝并提示补齐中间版本。所以更新包要**按顺序应用**（先 `v1.0.0 → v1.1.0`，再 `v1.1.0 → v1.2.0`）。
- **判断迁移有没有被动过**：脚本拿清单里的哈希和 `drizzle/` 下的现状比，就能知道哪些迁移是你新增的、你改的、你删的。

版本号是卖家在其仓库上打的 tag；还没有 tag 的版本用 `package.json` 的版本加提交短号（例如 `0.1.0-9806e3b`）。

### 步骤

```bash
# 0. 先提交或备份当前改动 —— 脚本直接改工作区，不碰 git 历史
git status

# 1. 应用更新包（zip 或解压后的目录都行）
scripts/apply-template-update.sh ~/Downloads/sass-template-update-v1.0.0-to-v1.1.0.zip

# 2. 按脚本打印的结果处理冲突与迁移（见下两节）；脚本非零退出时不要跳过

# 3. 依赖与验证
pnpm install
pnpm test
pnpm db:migrate      # 这次更新带新迁移时才需要

# 4. 自己提交（脚本不碰 git 历史，提交信息你定）
git add -A && git commit -m "chore: apply template update"
```

> 仓库里还没有 `scripts/apply-template-update.sh`？它是随某次更新才进包的。第一次更新时先把包里的 `new/scripts/apply-template-update.sh` 复制到你的 `scripts/` 目录，再照上面的步骤跑。

脚本对每个变动文件做的事：

| 你的文件 | 模板 | 结果                                       |
| -------- | ---- | ------------------------------------------ |
| 没动过   | 改了 | 直接取新版                                 |
| 改了     | 改了 | 三路合并；合得上自动合，合不上留下冲突标记 |
| 删了     | 改了 | 跳过，不替你恢复（清单里会列出来）         |
| 在       | 删了 | 只提示，不替你删                           |

全部干净时，脚本把 `template.json` 更新到新版本 —— 下一次更新就从这里接上。

### 冲突：脚本留下的标记

两边都改了同一处时，文件里会留下：

```
<<<<<<< 你现在的版本
你的内容
=======
模板新版的内容
>>>>>>> 模板新版
```

脚本会列出所有冲突文件并以非零退出。模板的新版在更新包的 `new/<路径>` 下，你的原版在 `base/<路径>` 下，可以直接对着看。

解决完冲突之后，把解决过的路径告诉脚本，用同一个更新包重跑一次：已经应用过的文件会跳过，所以重复跑是安全的。

```bash
scripts/apply-template-update.sh --resolved site.config.ts --resolved messages/en.json \
  ~/Downloads/sass-template-update-v1.0.0-to-v1.1.0.zip
```

**没处理完的冲突不会让版本基线推进**：这次没落地的改动，靠不推进的基线下次还能补上。在冲突和迁移处理干净之前，下一个更新包会被版本校验挡住 —— 这是故意的。

### 迁移冲突

`drizzle/` 是唯一不能机械合并的目录：迁移的文件名（编号）在全库唯一，快照链还要闭合。所以规则是**你自上个版本以来动过迁移、模板这次又带了迁移变动，脚本就整块停下**，`drizzle/` 下一个文件都不动，并打印处理步骤：

1. 你自己的迁移保留原编号，模板的迁移文件按原名放进 `drizzle/`。
2. 编号撞车时保留模板那条的编号，重新生成你自己的那一条：
   ```bash
   pnpm db:generate --name <你原来那条的名字>
   ```
   生成的迁移只应包含你自己的表。
3. 验证：
   ```bash
   pnpm migrations:check   # 编号连续、when 严格递增、快照链闭合
   pnpm db:migrate         # 先在一个 Neon 分支或本地库上验证
   ```
4. 处理完加 `--migrations-done`，用同一个更新包重跑一次，基线才会推进：
   ```bash
   scripts/apply-template-update.sh --migrations-done ~/Downloads/sass-template-update-v1.0.0-to-v1.1.0.zip
   ```

已经跑在生产库上的迁移不要删掉重建：先在 Neon 分支上执行 `pnpm db:migrate` 确认结果（分支是写时复制的，不会影响主线）再决定怎么处理。

## 用 git merge 合并（可选）

这条路只对**与模板有共同 Git 历史**的项目成立 —— 从 GitHub「Use this template」建仓库、或从模板仓库 fork 出来的项目。购买后拿到 zip 的项目没有这层历史，走[差量更新包](#用差量更新包升级推荐)。

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

### 为什么不是 `git merge --allow-unrelated-histories`

zip 起步的项目与模板没有共同历史，直接 `git merge upstream/main` 会被 git 拒绝（`refusing to merge unrelated histories`），`--allow-unrelated-histories` 就是关掉这道保险的开关。它能让合并跑起来，但**不是完整的升级方案**：

- **模板的每一处改动都拿空树当共同祖先**，git 无从判断「买家改的」和「模板改的」。结果不是「谁改了什么」的合并，而是：两边内容不同的文件**一律成为 add/add 冲突**，买家改过的每一个文件都得人工逐个决定（实测里连 `package.json` 都是这么冲的）；模板删掉的文件不会从买家那边删掉（空祖先下表达不出「删除」），买家删掉、模板还留着的文件会被重新加回来。
- **模板的整棵树都会落进你的仓库**，包括模板作者的内部文档和全部历史。实测：一个只有 2 个跟踪文件的 zip 起步仓库，跑一次 `git merge --allow-unrelated-histories upstream/main` 之后变成 718 个文件。

合并完你还得自己把混进来的内部文档再删一遍，而删掉的那些文件会在下一次合并时再次出现。差量更新包正是为了避开这些：它只带两个版本之间随包交付的文件，用**上一版的真实内容**当合并基线，而不是空树。

### 看冲突范围：`scripts/core-drift.sh`

```bash
scripts/core-drift.sh                  # 默认比较 upstream main
scripts/core-drift.sh origin main      # 指定其他远程和分支
CORE_PATHS="src/core src/app/api" scripts/core-drift.sh
```

输出三部分，都相对于本项目与上游的分叉点：本项目改过的套件文件（含未提交的改动）、上游改过的套件文件、两边都改过的文件。第三部分就是合并时最可能冲突的地方。第一部分为空时，直接合并即可。

## 常见冲突

**`pnpm-lock.yaml`**：不要手工合并。先解决 `package.json` 的冲突，然后：

```bash
git checkout --theirs pnpm-lock.yaml     # 走差量更新包时：删掉它，下面这行会重新生成
pnpm install --no-frozen-lockfile
git add pnpm-lock.yaml
```

**迁移冲突**（`drizzle/meta/_journal.json`、`drizzle/meta/*_snapshot.json`）：两边各自新增了迁移，编号撞了。以上游为准，重新生成本项目的迁移（走差量更新包时脚本会自己停下并打印同一套步骤，见[迁移冲突](#迁移冲突)）：

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

**`<Card>` 的默认外观**（模板改版后，见 `docs/design.md` §4.5）：不传 `tone` 时不再是原来那圈 `ring`，而是 `.panel`——1px `--border` 描边、和画布几乎同色的平面。业务页面里的 `<Card>` 会因此多出一根描边（改动很小，但确实会冲突）。`tone` 的行为没变，仍然是营销面的贴纸。

**`src/core/ui/page-header.tsx`、`empty-state.tsx`**（模板新增，见 `docs/design.md` §4.5）：产品面/后台的页头和空状态。业务页面如果自己写了 `text-2xl font-semibold tracking-tight` 的标题块，可以换成 `<PageHeader>` 跟上语域；不换也不会坏。

**界面上没有模糊投影**（模板改版后，见 `docs/design.md` §6）：`shadow-sm/md/lg` 在 `src/` 里一处都不该有。加新的浮动层时用 `.sticker`（物件：1px 描边 + 零模糊唇边）或退一档背景，不要加投影。
