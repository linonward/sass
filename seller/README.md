# seller/：OnwardKit 售卖站专用内容（首页覆盖 + 环境变量同步）

这个目录只给 OnwardKit 官方售卖站用，**不随发行包交付**（`scripts/release-package.sh` 的 `exclude_paths` 排除了它）。

买家拿到的默认首页是 `site.config.ts` 的 `landing` / `nav` 和 `messages/*.json` 的 `Landing.*`：一个虚构的 AI 商品图工具 Acme。售卖站在部署环境里设：

```
SITE_OVERLAY_DIR=seller
SITE_DESCRIPTION=The starter kit for your AI business.
```

加载逻辑在 `src/core/config/overlay.ts`：

- `site.json` 的 `landing`、`nav` 整段替换 `site.config.ts` 的同名配置，用同一个 schema 校验，写错启动即报错。
- `messages/<locale>.json` 深合并到 `messages/<locale>.json` 上，只写要覆盖的 key。

改售卖站首页文案或区块，只改这里，不要改 `site.config.ts` / `messages/` 的默认值。本地预览：`SITE_OVERLAY_DIR=seller pnpm dev`。

## 环境变量：以飞书多维表格为准

所有环境变量（Local / CI / Prod 三列的值）统一在飞书多维表格 [sass 环境变量](https://linonward.feishu.cn/base/Lk9Pb1ogSagQemszfgycPS6nnHc) 里管理。**改值先改表，再同步**；不要直接改 Vercel 或 `.env.local` 后忘了回填。

```bash
node seller/env/sync.mjs                  # 核对三处，有差异退出码 1（只打印变量名，不打印值）
node seller/env/sync.mjs --apply local    # 表格 Local 列 → 本 checkout 的 .env.local（权限 600）
node seller/env/sync.mjs --apply prod     # 表格 Prod 列 → Vercel production，之后需要重新部署
node seller/env/sync.mjs --apply prod --only A,B          # 只动这几个
node seller/env/sync.mjs --apply prod --include-sensitive # 连 Vercel 敏感变量一起覆盖
node --test seller/env/lib.test.mjs       # 脚本自身的单测
```

规则：

- 空单元格跳过，只报告，**脚本从不删除变量**；删变量手动做。
- CI 列只核对：`ci.yml` 随包交付给买家、里面全是测试假值，改它走正常 PR。
- Vercel 的敏感变量读不出值，没法比对。表格里写着「（Vercel 敏感变量，无法读取）」的格子一律跳过；填了真实值后，用 `--include-sensitive` 才会覆盖。
- 写入 Vercel 时保持变量原来的存储类型（Config / Sensitive），新变量按敏感存。
- 需要 `lark-cli` 以你本人身份登录、当前 checkout 已 `vercel link`（worktree 里没有 `.vercel/`，可从主 checkout 复制）。
- 新增变量：代码里用到新变量时，同时在 `.env.example`（给买家）和表格里各加一行。
- 临时文件（表格导出、拉下来的 production 值）放在 `/tmp/env-sync-*`，脚本退出即删。
- Claude Code 里说「同步 env」会走 `.claude/skills/env-sync/SKILL.md`（同样不随包）。
