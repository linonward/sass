# 阶段 22：Ubuntu 26 的 runner 迁移

GitHub 通知 `ubuntu-latest` 于 **2026-10-19** 起迁移到 Ubuntu 26（[actions/runner-images#14748](https://github.com/actions/runner-images/issues/14748)）。本阶段把这件事从「到时再说」变成一条实测结论加一处修复 —— 实测证明**当前代码在 Ubuntu 26 上会整条 CI 变红**，而根因不在多数人第一反应的 Playwright 上。

依据：一次性探针分支 `chore/ubuntu-26-probe`（draft PR #154，验完即删）。它只改 `runs-on: ubuntu-26.04` 先跑一轮复现，再插桩定位，最后带上候选修复跑第二轮 —— 两轮都在 26.04 上跑完了七条检查。

## 批次

- 只有 T2201 一张卡，改的是 `e2e/*/serve.ts` 的四处安装参数，不碰 `ci.yml`（阶段 21 刚拆完 job 结构，本卡与它无交集）。

---

## T2201 ubuntu-26-e2e

- 分支 / worktree：`fix/ubuntu-26-e2e` → `../sass-ubuntu-26`
- 依赖：—

**问题**

`e2e/{acquisition,flags,invoices,i18n}/serve.ts` 把仓库拷到 `os.tmpdir()` 下，再在副本里 `pnpm install --offline`。这套在 ubuntu-24.04 上是对的：副本解析到的默认 store 就是工作区那个被根 `pnpm install` 填满的 store，`--offline` 直接硬链接，几秒钟。

**为什么**

pnpm 的默认 store 必须与项目在**同一个文件系统**上（硬链接的前提）。两个镜像的差别只有这一处：

|                          | Ubuntu 24.04（今天的 `ubuntu-latest`） | Ubuntu 26.04                                         |
| ------------------------ | -------------------------------------- | ---------------------------------------------------- |
| `/tmp`                   | 在 `/` 上（ext4）                      | **独立 tmpfs**                                       |
| 工作区 store             | `/home/runner/setup-pnpm/…/store/v11`  | 同左（两轮日志里逐字相同）                           |
| 副本里 `pnpm store path` | 同一个 store                           | **`/tmp/.pnpm-store/v11`**（另起一个新建的空 store） |
| 副本 `pnpm install`      | 成功                                   | `ERR_PNPM_NO_OFFLINE_TARBALL`                        |

`df -T` 的直接证据：`tmpfs … /tmp` 与 `/dev/root ext4 … /`。store 一旦因为跨设备而另起炉灶，`--offline` 就把它当成唯一来源，撞上第一个缺的包即报错 —— 四条腿报的包**互不相同**（jsesc / esquery / path-exists / @better-auth/mongo-adapter，插桩那一轮是 express），这正是「空 store，撞上谁算谁」的识别特征。24.04 的历史 run 里这个错误出现过 **0 次**。

**做**

四处 `--offline` → `--prefer-offline`：`acquisition/serve.ts:72`、`flags/serve.ts:40`、`invoices/serve.ts:31`、`i18n/serve.ts:58`，每处补一句注释说明为什么不能改回去。

`--prefer-offline` 的语义正是这里要的：store 里有的照旧硬链接、不下载，缺的才联网补。store 完整时（24.04）行为与 `--offline` 一致；store 是空的时候（26.04）退化成一次正常安装，而不是直接失败。

**不做**

- **不改 `runs-on`**：既不用 `ubuntu-24.04` 拖延（10-19 之后 24.04 会被逐步下线，钉死只是把同一件事推后），也不用 `ubuntu-26.04` 抢先（现在就钉等于放弃 24.04 上的验证）。`ubuntu-latest` 保持原样，让迁移自己发生 —— 修的是代码，不是日程。
- **不改成把工作区 store 显式传给副本**（`--store-dir` 指到工作区的 store）：同样能修好，但要在四个 `serve.ts` 里各引一个会漂移的路径，而且没实测过；`--prefer-offline` 是在探针上验过的那个。
- **不碰 Playwright**：`pnpm exec playwright install --with-deps chromium` 在 26.04 上 20 秒装好、成功。我最初的预判正是它会在 26.04 上挂掉，被实测推翻 —— 记在这里免得下次再往那个方向查。
- **不在本卡处理 `static` / `unit`**：它们在 26.04 上本来就绿，只有碰 `/tmp` 临时副本的 e2e 会挂。

**验收**

- [ ] Ubuntu 26.04 上七条检查全绿 —— 已在探针分支上验过（[run 36499871852](https://github.com/linonward/sass/actions/runs/36499871852)：`static` / `unit` / `e2e`×4 / `ci` 全 success），各 e2e 腿耗时与 24.04 基线同量级（main 157s 对 187s）
- [ ] 本 PR 的 CI 在 `ubuntu-latest`（24.04）上四条 e2e 腿仍绿、耗时无劣化 —— 这是「store 完整时 `--prefer-offline` 与 `--offline` 等价」的回归验证
- [ ] `pnpm format:check` 绿

---

## 明确不修 / 待定

- **时间线是硬的**：这个修复要在 **2026-10-19** 之前进 `main`，否则模板自己的 CI 会先红一轮。仓库里 `--offline` 只出现在这四处，改完就没有别的落点。
- **买家侧**：`e2e/**` 不在 `UPGRADING.md` 的「业务」栏目里，合一次上游就自动带上这个修复；只有已经 fork 出去、又不再合并上游的买家需要照上面那四处自己改。
- **这条经验值得记**：26.04 与 24.04 的日志里，缓存 key（`node-cache-Linux-x64-pnpm-*`，不含 Ubuntu 版本）、store 路径、根 install 的 `reused 1124, downloaded 0` 三项**逐字相同** —— 一口气排除掉三个假设之后，剩下的分叉（副本里的 `pnpm store path`）才是答案。以后查同类问题先用这个顺序。
