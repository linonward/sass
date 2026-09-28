# 阶段 19：模板体验打磨

当前模板功能完备（阶段 1-16 全 done），但"下载就能用"的体感还有打磨空间。买家拿到模板后的第一个小时决定了会不会继续用。

## 依赖

T1704（CI dep audit）后环境干净。任务间无强依赖，可并行。

```
T1901 ─┐
T1902 ─┤  全部可并行
T1903 ─┘
```

## 任务

### T1901: 首次运行体验

- **topic**: `onboarding`
- **分支**: `feat/onboarding`
- **范围**: `src/core/onboarding/`（新建）+ `src/app/[locale]/(app)/onboarding/`
- **做什么**:
  - 注册后自动跳转 `/onboarding`（一个 3-5 步 checklist wizard）
  - 步骤：✅ 改品牌色 → ✅ 设站点名称 → ✅ 编辑 pricing → ✅ 写第一篇文章 → ✅ 部署到 Vercel
  - 每个步骤直接链接到对应的配置或页面；纯引导，不改任何现有流程
  - 利用 `siteConfig` 的 sentinel 检测占位值未改（`name === "Acme"` → 提示改名）
  - 完成 checklist 后不再自动跳转（记 `onboarding_complete` flag 到用户记录）
- **验证**: e2e：注册 → onboarding 自动弹出 → 逐条完成 → 标记完成 → 不再出现

### T1902: 第二个示例模块

- **topic**: `example-invoices`
- **分支**: `feat/example-invoices`
- **范围**: `src/features/invoices/`（新建，参考 `src/features/example/`）
- **做什么**:
  - 做一个简单的"发票列表"示例模块：展示如何用 Drizzle CRUD + RSC + Server Actions 做一个完整 CRUD 功能
  - 包含：列表页（分页）、新建/编辑表单、删除确认、按客户搜索
  - 数据库 schema：`invoices` 表（`id`、`user_id`、`customer_name`、`amount`、`status`、`created_at`）
  - 纯展示模板代码，标注了"delete me"注释区块
  - 加一个特性开关 `features.examples.invoices`（类似 `features.example`），方便关闭
- **验证**: e2e：创建发票 → 列表出现 → 编辑 → 删除；关掉开关后 404

### T1903: 模板使用视频 / 图文指南

- **topic**: `starter-media`
- **分支**: `docs/starter-media`
- **范围**: `docs/starter-guide.md` 扩展 + 可选视频
- **做什么**:
  - 扩展现有 `starter-guide.md`，加截图（关键步骤：Use this template → clone → env → dev → deploy）
  - 写一个 10 分钟即可走完的"从零到上线" checklist（markdown）
  - 如果要做视频：录一个无声 5 分钟 walkthrough（Loom 或 OBS），链接放 README
  - README 顶部加 "🚀 10 分钟上线" 快速入口（链接到 checklist）
- **验证**: 跟着 checklist 走一遍，确认一个不熟悉项目的的人能在 30 分钟内完成

## 完成后

- 买家注册后立即看到 onboarding checklist，知道下一步该做什么
- 第二个示例模块展示完整 CRUD（第一个示例只是 UI + AI 调用）
- README / 文档让第一次用的人 30 分钟内能上线
