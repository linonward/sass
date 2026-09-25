# 阶段 5：内容与运营

阶段完成后：可以做内容营销和日常运营；模板达到 v1。

---

## T501 blog

- 分支 / worktree：`feat/blog` → `../sass-blog`
- 依赖：T104、T106

**做**

- 用 content-collections 管理 MDX 文章，放在 `content/blog/<locale>/*.mdx`
- frontmatter schema：`title`、`description`、`date`、`tags`、`cover`、`draft`
- 页面：
  - `/blog`：列表页，每页 12 篇
  - `/blog/[slug]`：文章页
  - `/blog/tags/[tag]`：标签页
- RSS：`/blog/rss.xml`
- SEO：文章加入 sitemap，文章页有 Article JSON-LD，每篇文章有自己的 OG 图
- `draft: true` 的文章不出现在生产环境
- 由 `features.blog` 控制是否启用

**不做**：CMS、评论、搜索

**验收**

- [ ] 新增一个 `.mdx` 文件，列表页、sitemap、RSS 都会出现这篇文章
- [ ] 草稿文章在生产环境访问返回 404

**测试**：e2e 覆盖列表页和文章页；Vitest 对 sitemap 和 RSS 输出做快照

---

## T502 admin

- 分支 / worktree：`feat/admin` → `../sass-admin`
- 依赖：T203、T302、T303

**做**

- 启用 Better Auth 的 admin 插件，并补上所需的 schema 迁移
- 首个管理员：用户用 `ADMIN_EMAILS` 里列出的邮箱登录时，自动获得 admin 角色
- `/admin` 路由组：服务端校验 admin 角色，非管理员返回 404
- 页面（都在服务端分页）：
  - 用户：搜索、查看详情、封禁 / 解封
  - 订单和订阅：列表，可按状态筛选
  - 积分调整：必须填写原因，写入一条 `adjust` 流水，流水中记录操作管理员的 ID
- 由 `features.admin` 控制是否启用

**不做**：数据看板和图表、模拟用户登录（impersonate）

**验收**

- [ ] 非管理员访问 `/admin` 返回 404
- [ ] 调整积分后，余额和流水都正确，能看到是谁操作的

**测试**：e2e 覆盖管理员和普通用户的访问控制；Vitest 验证积分调整

---

## T503 starter-guide

- 分支 / worktree：`docs/starter-guide` → `../sass-starter-guide`
- 依赖：阶段 1–5 全部

**做**

- README 快速开始，覆盖从 fork 到上线的完整路径：使用模板 → 修改 `site.config.ts` → 填写 `.env` → `db:migrate` → 部署到 Vercel → 走一遍上线清单
- `UPGRADING.md`：说明目录边界（见 plan.md），以及合并上游的步骤：`git remote add upstream`、`git fetch upstream`、`git merge upstream/main`
- `scripts/core-drift.sh`：列出业务项目中 `src/core` 相对上游的改动，方便在合并前了解冲突范围
- 示例业务模块 `src/features/example`：一个扣积分的 AI 小工具，演示业务代码如何调用 `runAI`、`deductCredits`、`dashboard.nav`
- 给模板打 `v1.0.0` 标签

**不做**：文档站

**验收**

- [ ] 只看 README，就能从一个全新的 fork 走到线上可收款；按时间记录每一步的耗时，总耗时 ≤ 1 天
- [ ] 删除 `src/features/example` 后，项目仍能构建通过

**测试**：人工完整走一遍 fork 流程，把卡住的地方补进 README
