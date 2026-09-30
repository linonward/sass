---
name: env-sync
description: 同步 sass 的环境变量：飞书多维表格「sass 环境变量」是唯一来源，核对或把 Prod 列同步到 Vercel production、Local 列同步到 .env.local。用户说 同步 env / 同步环境变量 / env sync / 改生产变量 / 加环境变量 / 核对 env / sync env to vercel 时使用。
---

# env-sync

**飞书多维表格是 key 和 value 的唯一来源。** 有哪些变量、每个变量在 Local / CI / Prod 的值，都以飞书多维表格 [sass 环境变量](https://linonward.feishu.cn/base/Lk9Pb1ogSagQemszfgycPS6nnHc) 为准，方向永远是 **表格 → 环境**。**改值先改表，再同步。**

脚本在本 skill 的 `scripts/` 下，从仓库根目录运行（它按自己的位置找到仓库根）：

```bash
node .claude/skills/env-sync/scripts/sync.mjs                  # 核对三处，有差异退出码 1（只打印变量名，不打印值）
node .claude/skills/env-sync/scripts/sync.mjs --apply local    # 表格 Local 列 → 本 checkout 的 .env.local（权限 600）
node .claude/skills/env-sync/scripts/sync.mjs --apply prod     # 表格 Prod 列 → Vercel production，之后需要重新部署
  --only A,B                # 只动这几个变量
node --test .claude/skills/env-sync/scripts/lib.test.mjs       # 脚本自身的单测
```

## 脚本的规则

- **只要有差异就提示**：每次运行（核对和任何 `--apply`）都先打印完整差异报告，每项差异带 ⚠️、一致的带 ✅，然后才执行写入。覆盖：
  - key：`.env.example` 有、表格没有（代码用到了但表格没管，去表格补一行）；表格有、`.env.example` 没有（如 Neon 集成注入的 `DATABASE_URL_UNPOOLED`、只在 CI 用的 `POSTGRES_PASSWORD`，确认是否该补进 `.env.example` 或删行）。
  - 值：`.env.local`、`ci.yml`、Vercel production 与表格的每一处不同（缺失、不同、目标有而表格空、目标有而表格无此行）。
- 核对模式有任何差异就退出码 1。转述结果时把所有 ⚠️ 行原样告诉用户，不要省略。
- **表格覆盖目标**：`--apply` 时，表格里有值的变量一律以表格为准写入；值已相同的跳过。
- 空单元格跳过、只报告，**脚本从不删除变量**。
- CI 列只核对：`.github/workflows/ci.yml` 随包交付给买家、里面全是测试值，改它走正常 PR。
- Vercel 敏感变量读不出值：只要表格里有值，核对时就总显示为 `differs`（核对不会全绿），`--apply prod` 每次都用表格的值重写一遍。
- 写 Vercel 时存储类型（Config / Sensitive）也按表格「敏感」勾选。敏感变量以后读不回来、只能每次重写，非敏感的就别勾。值经 stdin 传入，不进 argv。
- 临时文件（表格导出、拉下来的 production 值）在 `/tmp/env-sync-*`，脚本退出即删。

## 流程

1. **前置检查**（在要操作的 checkout 根目录）：
   - `lark-cli` 已以用户身份登录。
   - 同步 prod 需要 `.vercel/project.json`；worktree 里没有时从主 checkout 复制：`cp -R ../sass/.vercel .`。
2. **先核对**：跑核对命令，把输出（只有变量名）转述给用户：把每条 ⚠️ 都告诉用户，并说明哪些会被 `--apply` 写入（缺失、与表格不同），哪些不会（表格空、表格无此行、key 差异）。
3. **要改值时，先改表格**：
   - 用户直接在飞书里改，或让你改：`lark-cli base +record-search --keyword <NAME> --search-field 变量名 --field-id 变量名 --format json` 找记录（默认输出 markdown、不能配 `--jq`；关键词是子串匹配，要从结果里挑变量名完全相等的那条），再用 `+record-batch-update` 写 Local / CI / Prod 列。
   - 新变量：在表格里加一行（`+record-batch-create`：变量名、分组、说明、敏感、各列的值）。代码里要读它、买家也需要配置的，同时在 `.env.example` 里加 key（带英文注释）。
4. **应用**（写生产前向用户确认要写入的变量名清单）：
   - `--apply prod [--only A,B]` → Vercel production；之后提醒用户重新部署（或 `vercel --prod`），新值才生效。
   - `--apply local` → 当前 checkout 的 `.env.local`（每次写后权限设为 600）。
5. **收尾**（飞书写入是异步生效的，改完表格等几秒再核对，否则可能读到旧值）：再跑一次核对，确认目标项已变成 in sync，把结果告诉用户。

## 不要做

- 不要把变量值打印到对话、日志、PR 或提交里；需要比较时只比较、只输出变量名。
- 不要直接 `vercel env add` / 手改 `.env.local` 绕过表格；那样表格就不再是唯一来源。
- 不要改 `ci.yml` 来"同步" CI 列。
- 用户要删变量时，确认后手动 `vercel env rm <NAME> production`，并清空表格对应格子。
- 不要把手动拉下来的 production 值文件留在磁盘上。
