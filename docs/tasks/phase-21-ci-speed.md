# 阶段 21：CI 提速

一次 PR 的 CI 墙钟约 10 分钟，其中 **e2e 四套合计占了 6 分钟**，而它们彼此完全独立 —— 各跑各的端口、各拷各的临时副本、各起各的服务器。它们现在被串在同一个 job 里依次执行，纯粹是历史结构，不是依赖关系。

依据：`gh run view` 拉最近四轮 run 的分步耗时，四轮高度一致（下表），瓶颈稳定；以及一次性读全四份 playwright config + 三个 `serve.ts` 得到的构建/端口/共享状态关系。

| 阶段                                                                                         |     耗时 |
| -------------------------------------------------------------------------------------------- | -------: |
| 冷启动（Set up job + Initialize containers + checkout + pnpm/node setup）                    |     ~38s |
| `pnpm install --frozen-lockfile`                                                             |    6–11s |
| 静态检查（audit / lint / format / notices / release-package / typecheck / migrations:check） |     ~38s |
| `pnpm db:migrate`                                                                            |      ~1s |
| `pnpm test --coverage`                                                                       |   51–67s |
| `pnpm build`                                                                                 |   37–47s |
| `playwright install --with-deps chromium`                                                    |      22s |
| `test:e2e`（主套件）                                                                         | 143–170s |
| `test:e2e:acquisition`                                                                       |  82–100s |
| `test:e2e:flags`                                                                             |   56–67s |
| `test:e2e:invoices`                                                                          |   46–53s |

## 批次

只有一个任务。拆完墙钟由最长的那条腿决定，约 4.7 分钟。

---

## T2101 ci-split

- 分支 / worktree：`chore/ci-split` → `../sass-ci-split`
- 依赖：—

**问题**

`.github/workflows/ci.yml` 是一个 job 串行跑完 20 个 step。e2e 四套之间没有依赖，却排在同一条时间线上，把 6 分钟加成进了关键路径。

两个约束决定了改法：

- **仓库是 PUBLIC**，Actions 分钟数不计费 —— 所以只算墙钟账，不需要为「多起几个 runner」做取舍。（如果哪天转私有，这条结论要重算。）
- **`ci` 这个 check 名必须留着**：`README.md` 的「### 5. GitHub」和 `docs/workflow.md` 的「GitHub 仓库设置」都让买家把 `ci` 配成 `main` 的必需检查。拆完若没有名为 `ci` 的检查，照文档配置的买家 PR 会被永久卡在一个再也不会出现的检查上。所以末尾要有一个汇总闸门，id 就叫 `ci`。

**做**

- 拆成 `static`（只读文件的检查，不起 postgres）、`unit`（postgres + `db:migrate` + `test --coverage`）、`e2e`（**matrix 四条腿**）、`ci`（汇总闸门）。
- **共享 env 提到 workflow 顶层 `env:`**：GitHub Actions 没有 YAML anchor，16 个变量若在四个 job 里各抄一遍，改一个要改四处。`static` 也会拿到指向空端口的 `DATABASE_URL`，无害 —— 它那组检查全是只读文件的（`check-notices.mjs` / `check-migrations.mjs` / `release-package.sh` 都不连库，已逐条确认）。
- **`pnpm build` 只在主套件腿跑**：主套件 webServer 是 `pnpm start`，跑预构建的 `.next`；另外三套的 `serve.ts` 会把仓库拷到临时目录、打补丁改 `site.config.ts`，再自己 `pnpm build`（`if (process.env.CI)` 那两行），根部的 `.next` 它们根本不读。给这三腿省掉根部构建，各约 45s。
- **`db:migrate` 改由每条碰库的腿各跑一次**（原来整条流水线只跑一次、四套 e2e 共用）。`services:` 是 job 级的，拆开后每腿拿到全新 postgres 容器 —— 这比原来更安全，原来后三套是跑在主套件弄脏过的库上的。
- **产物按腿上传**：旧版只传根部的 `playwright-report/`，而三个子套件用的是 `reporter: "list"`、**不产 html 报告**，失败时的 trace 落在各自的 `test-results/<suite>/` —— 也就是说子套件失败时 CI 从来没给过现场。matrix 每腿按自己的路径传，顺带把这个缺口补上。
- `timeout-minutes` 按腿收紧（static 10 / unit 10 / e2e 15 / 闸门 5）。原来整条 20 分钟，拆分后不该留一条腿能挂 20 分钟。
- 闸门用 `always()` 跑起来、在 step 里失败，**不用 `if:` 让 job 被 skip** —— 被 skip 的必需检查会挡住 PR。

**不做**

- **不给主套件 shard**（Playwright `--shard` + blob reporter + merge job）：能把关键路径再压到 ~3.9 分钟，代价是 e2e 失败时的报告链路多一层合并。收益递减，先不做；真需要时单开一张卡。
- **不缓存 Playwright 浏览器**：省的是每腿 ~15–20s，而关键路径只受主套件腿影响，净收益小，且 `--with-deps` 里那部分 apt 依赖本来就没法跟着缓存。
- **不动 `e2e/*/serve.ts`**：它们自带的构建是「补丁副本」语义的一部分，不是冗余。
- 不删 `pnpm audit`、不改覆盖率阈值、不动任何业务代码。

**验收**

- [ ] 拆完后把旧流水线 16 条 `run` 命令逐一映射到新结构，确认**没有任何检查被漏掉**，top 层 16 个 env 变量值逐一相同（用 `yaml` 解析两份 ci.yml 对拍，脚本输出贴进 PR）
- [ ] `pnpm format:check` 绿（ci.yml 在 prettier 管辖内）
- [ ] PR 上跑完整 CI：墙钟降到 ~4.7 分钟，六条 check 全绿，贴 before/after 的分步耗时对比
- [ ] **闸门变异校验**：故意让一条 e2e 腿失败一次，确认 `ci` 闸门真的变红，再恢复。闸门在失败时静默放行比没有闸门更糟 —— 这条必须实测，不能只看表达式
- [ ] 确认 `needs.*.result` 在含 matrix job 时的真实形状（第一次运行的日志会打出来）：官方文档没写明 `needs.<job_id>.result` 对 matrix 是标量还是集合，闸门用的是对两种解释都成立的 `contains(needs.*.result, 'failure')`，但结论要以实测为准
- [ ] 顺带确认子套件失败时 artifact 里确实有 trace

**风险**

现在四套是**依次**跑在同一个库上（主套件从干净库开始，后三套跑在主套件弄脏过的库上）。拆开后四条腿各自跑在**全新的库**上 —— 主套件的体验不变，但后三套不再继承主套件的遗留数据。若其中某套偷偷依赖了前一套留下的行，这次才会暴露。第一次 CI 跑完若某条子腿变红，先怀疑这个，而不是配置写错。

## 明确不修 / 待定

- **`README.md:607` 与 `docs/workflow.md:115` 说「`ci` 为必需检查」，但仓库当前并没有配**：经典分支保护未开启，ruleset 只有 `deletion` + `non_fast_forward`。那两处是**给买家的配置指引**（照做即可），不是对本仓库现状的描述，所以本阶段不改；但本仓库自己确实少了一道平台级的闸门 —— 目前靠流程约束。要补的话是单独一件事（改 GitHub 设置，不是改代码），不落卡。
- **`docs/tasks/phase-1-landing.md` 里的 step 顺序**（install → lint → typecheck → test → build）是当时的记录，属历史日志，不回改。
- 若将来转私有仓库，「并行多起 runner 不花钱」的前提消失，需要重算拆分的性价比。
