---
name: env-sync
description: 同步 sass 的环境变量：飞书多维表格「sass 环境变量」是唯一来源，核对或把 Prod 列同步到 Vercel production、Local 列同步到 .env.local。用户说 同步 env / 同步环境变量 / env sync / 改生产变量 / 加环境变量 / 核对 env / sync env to vercel 时使用。
---

# env-sync

环境变量以飞书多维表格 [sass 环境变量](https://linonward.feishu.cn/base/Lk9Pb1ogSagQemszfgycPS6nnHc) 为准，方向永远是 **表格 → 环境**。脚本 `seller/env/sync.mjs`，规则详见 `seller/README.md`。

## 流程

1. **前置检查**（在要操作的 checkout 根目录）：
   - `lark-cli` 已以用户身份登录。
   - 同步 prod 需要 `.vercel/project.json`；worktree 里没有时从主 checkout 复制：`cp -R ../sass/.vercel .`。
2. **先核对**：`node seller/env/sync.mjs`。把输出（只有变量名）转述给用户：哪些 `differs` / `missing in target` 会被写入，哪些只是报告（空单元格、敏感变量无法比对、目标里有但表格没有的行）。
3. **要改值时，先改表格**：
   - 用户直接在飞书里改，或让你改：`lark-cli base +record-search` 按「变量名」找到记录，`+record-batch-update` 写 Local / CI / Prod 列。
   - 新变量：`+record-batch-create` 加一行（变量名、分组、说明、敏感、对应列的值），同时提醒在 `.env.example` 里给买家加一行。
4. **应用**（写生产前向用户确认要写入的变量名清单）：
   - `node seller/env/sync.mjs --apply prod [--only A,B]` → Vercel production；之后提醒用户重新部署（或 `vercel --prod`），新值才生效。
   - `node seller/env/sync.mjs --apply local` → 当前 checkout 的 `.env.local`。
   - 覆盖 Vercel 敏感变量需要表格里有真实值，并加 `--include-sensitive`；先向用户确认。
5. **收尾**：再跑一次 `node seller/env/sync.mjs`，确认目标项已变成 in sync，把结果告诉用户。

## 不要做

- 不要把变量值打印到对话、日志、PR 或提交里；需要比较时只比较、只输出变量名。
- 不要直接 `vercel env add` / 手改 `.env.local` 绕过表格；那样表格就不再是唯一来源。
- 不要改 `.github/workflows/ci.yml` 来"同步" CI 列：它随包交付，只做核对，改它走正常 PR。
- 脚本从不删除变量；用户要删时，让用户确认后手动 `vercel env rm <NAME> production`，并清空表格对应格子。
- 不要把拉下来的 production 值文件留在磁盘上；脚本自带的临时目录会自动删除，手动拉取的要删掉。
