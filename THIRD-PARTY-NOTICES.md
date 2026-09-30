# 第三方组件与许可

本文件列出模板用到的第三方组件及其许可。模板**自身的代码**不在这里，按根目录 [LICENSE](LICENSE) 的专有 EULA 授权。

- 统计时间：2026-09-27。本版在基线 `3c59e36` 上重跑同一套命令：两张分布表的数字与上一版（基线 `358d00d`）**没有变化**，变的是「直接依赖明细」里 react / react-dom / `@types/react` / `@types/react-dom` / typescript 五行 —— dependabot 在本文件上次更新之后把它们升上去了，原来那五行写的是升级前的版本。上一版生产依赖树数字比更早的版本小，主要是 `shadcn` 那条链移进 `devDependencies` 所致。
- 2026-09-28：「直接依赖明细」新增一行 `@vitest/coverage-v8`（5.0.2，dev，MIT）—— vitest 的覆盖率提供者，随 CI 覆盖率阈值一起加进来。当时写的是「其传递依赖都已在树里」，**这条不成立**：它的 `@bcoe/v8-coverage`、`ast-v8-to-istanbul`、`@vitest/istanbul-lib-coverage` / `@vitest/istanbul-lib-report` 等确实是新装进来的包，下面那条一并修正了数字。
- 2026-09-28：「直接依赖明细」新增一行 `stripe`（22.6.2，prod，MIT）—— Stripe 官方 Node SDK，Stripe 收款用（Creem 之外新增的服务商，见 README 的「支付（Creem / Stripe）」）。它没有传递依赖。两张分布表这次按同一台 macOS 重跑并更新：生产树只多这 1 个 MIT 包（540 → 541 条），全量树多 8 个 MIT 包（+1 是 stripe，其余 7 个是上面那条漏算的 `@vitest/coverage-v8` 的传递依赖），其余各行的包数没变。
- 统计方式：`pnpm licenses list`（全量）与 `pnpm licenses list --prod`（仅生产依赖），读的是仓库已安装的依赖和 `pnpm-lock.yaml` 锁定的版本。
- 依赖升级后数字会变，本文件不会自动跟着变 —— 改依赖时重跑上面的命令并按需更新。**「直接依赖明细」那一节已经不用靠人记**：`pnpm notices:check`（`scripts/check-notices.mjs`）会拿 `pnpm-lock.yaml` 逐条比对版本和依赖类型，CI 每个 PR 都跑，对不上就失败。
- 本文件是情况说明，**不是法律意见**；正式售卖前建议由律师过目（见 README 的「授权」一节）。

## 全量依赖树

含 `dependencies`、`devDependencies` 及其全部传递依赖，按实际安装的平台可选依赖计入：

| 许可（SPDX）              | 包数 |
| ------------------------- | ---- |
| MIT                       | 843  |
| Apache-2.0                | 89   |
| ISC                       | 35   |
| BSD-2-Clause              | 16   |
| BSD-3-Clause              | 12   |
| BlueOak-1.0.0             | 6    |
| MIT-0                     | 3    |
| MPL-2.0                   | 3    |
| CC0-1.0                   | 2    |
| LGPL-3.0-or-later         | 1    |
| Apache-2.0 AND MIT        | 1    |
| Python-2.0                | 1    |
| CC-BY-4.0                 | 1    |
| Unlicense                 | 1    |
| (AFL-2.1 OR BSD-3-Clause) | 1    |
| FSL-1.1-Apache-2.0        | 1    |
| 0BSD                      | 1    |
| (MIT OR CC0-1.0)          | 1    |
| **合计**                  | 1018 |

口径：1018 是「包名 × 许可」的条目数，落盘的是 1122 个「包名@版本」（同一个包有多个版本时会各占一行版本），去重到包名是 1014 个。

**没有 GPL、AGPL、SSPL 这类强 copyleft 许可。** 有 copyleft 性质的一共 4 个包：1 个 LGPL-3.0-or-later、3 个 MPL-2.0，逐个说明见下一节。其余全是宽松许可（MIT / Apache-2.0 / ISC / BSD / MIT-0 / 0BSD / BlueOak / Unlicense / CC0 / Python-2.0 / 二选一的双许可）。

## 生产依赖树

`pnpm licenses list --prod`：541 条，539 个包名。

| 许可（SPDX）              | 包数 |
| ------------------------- | ---- |
| MIT                       | 435  |
| Apache-2.0                | 60   |
| ISC                       | 18   |
| BSD-3-Clause              | 7    |
| BSD-2-Clause              | 7    |
| BlueOak-1.0.0             | 5    |
| Python-2.0                | 1    |
| CC-BY-4.0                 | 1    |
| Unlicense                 | 1    |
| (AFL-2.1 OR BSD-3-Clause) | 1    |
| CC0-1.0                   | 1    |
| MIT-0                     | 1    |
| FSL-1.1-Apache-2.0        | 1    |
| 0BSD                      | 1    |
| (MIT OR CC0-1.0)          | 1    |
| **合计**                  | 541  |

两点要注意：

- **`--prod` 既不统计 devDependencies，也不统计可选依赖**，所以这三个有 copyleft 性质的包都不在这张表里，但原因不同：sharp / libvips（LGPL）是 `next` 的**可选依赖**（真实部署会装上：Vercel 上 Next 用 sharp 做图片优化）；lightningcss（MPL）经 Tailwind 和 vitest 的 devDependencies 进来；axe-core（MPL）来自 ESLint 插件，只在 lint 时用。只看这张表会漏掉前两条，所以逐个说明放在下一节。
- 买家的 CI 若跑不带 `--prod` 的 `pnpm install`，装的是全量，两张表都适用。

## 需要单独说明的许可

### LGPL-3.0-or-later —— `@img/sharp-libvips-*`（1 个包）

依赖链：`next@16.3.6` →（可选依赖）`sharp@0.35.4` → `@img/sharp-darwin-arm64@0.35.4` → `@img/sharp-libvips-darwin-arm64@1.3.3`。

- **`sharp` 包本身是 Apache-2.0**；LGPL 的是它依赖的**预编译 libvips 二进制** `@img/sharp-libvips-*`。本机装的是 `-darwin-arm64`，已另外核对 npm registry 上的 `@img/sharp-libvips-linux-x64` / `-linux-arm64`，同样是 `LGPL-3.0-or-later`。
- 为什么在 SaaS / 自托管场景可接受：
  - LGPL 的 copyleft 只覆盖这个库**自身**，不覆盖调用它的应用。模板没有修改它，也没有把它静态链接进自己的代码 —— 它由 sharp 以独立动态库的方式调用。
  - LGPL 的义务落在**分发这个库的一方**：附上许可全文、并在被要求时提供该库的源码。SaaS 部署时二进制装在运营者自己的服务器上，不随产品分发给终端用户，这项义务不触发。
  - 买家如果确实要分发（例如打一个 Docker 镜像交付给客户），保持二进制原样即可：许可全文就在该包内，源码需求指向该包的发布地址。
  - 这段是通行实践的说明，不构成法律意见。

### MPL-2.0 —— `lightningcss`、`lightningcss-darwin-arm64`、`axe-core`（3 个包）

- `lightningcss` 经 devDependencies 进来，两条路径：`@tailwindcss/postcss` → `@tailwindcss/node`（构建时编译 CSS，Tailwind 4 的管线），以及 `vitest` → `vite`（测试与转译）。两个版本（1.32.0 / 1.33.0）分别来自这两条路径。
- `axe-core` ← `eslint-plugin-jsx-a11y`，只在 `pnpm lint` 时用。
- MPL-2.0 是**文件级** copyleft：只要求「被修改过的 MPL 文件」继续以 MPL 提供，不影响同一个项目里其他文件的许可，也不要求公开调用方的代码。模板没有修改这几个包，它们又都是构建 / lint 期工具，不进买家产品的产物。只有真去改这些包的源码（极少见）才需要把改动的那些文件按 MPL 公开。

### FSL-1.1-Apache-2.0 —— `sentry@0.44.1`（Sentry CLI，1 个包）

依赖链：`@sentry/nextjs@11.0.0` → `@sentry/bundler-plugins@11.0.0` → `sentry@0.44.1`。

- FSL **不是 OSI 认可的开源许可**，是 source-available：允许使用、复制、修改、再分发，唯独不允许拿它做**与之竞争的商业产品或服务**（该包 `LICENSE.md` 的 "Competing Use" 定义）；每个版本发布满两周年后自动转为 Apache-2.0。
- 本模板的用法完全落在允许范围：只在**构建时**上传 source map，而且只有买家配了 `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` 三项才会执行（见 `next.config.ts` 的 `canUploadSourceMaps`）。这属于许可里明列的 "your internal use and access"；模板不改它、不把它作为产品的一部分分发，也不提供与它竞争的服务。
- 不使用 Sentry 时这条链路不会执行。

### 其余需要点名但不构成义务的

| 许可                                                             | 包                                     | 说明                                                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-BY-4.0                                                        | `caniuse-lite`                         | 浏览器支持情况的数据集，构建时经 `browserslist` / `next` 读取，用来决定 CSS / JS 的兼容目标。CC-BY 要求署名，本条即为署名；数据不随买家产物分发。 |
| Python-2.0                                                       | `argparse`                             | PSF 许可（宽松），来自 `js-yaml`（构建期解析配置）。                                                                                              |
| (AFL-2.1 OR BSD-3-Clause)                                        | `json-schema`                          | 双许可，实际适用 BSD-3-Clause（来自 `@ai-sdk/provider`）。                                                                                        |
| Unlicense                                                        | `fast-sha256`                          | 公有领域声明（来自 `standardwebhooks`，Creem webhook 验签用）。                                                                                   |
| CC0-1.0                                                          | `language-subtag-registry`、`mdn-data` | 公有领域贡献（语言子标签数据、MDN 的 CSS 数据），无署名义务。                                                                                     |
| 0BSD / BlueOak-1.0.0 / MIT-0 / ISC / BSD-2-Clause / BSD-3-Clause | 见上表                                 | 均为宽松许可，要求保留版权与许可声明，无其他义务。                                                                                                |

## 直接依赖明细

`package.json` 里 46 个 `dependencies` + 32 个 `devDependencies`，共 78 个。版本是本次统计时锁定的版本。

### MIT（55）

| 包                                | 版本    | 依赖类型 |
| --------------------------------- | ------- | -------- |
| `@base-ui/react`                  | 1.8.0   | prod     |
| `@commitlint/cli`                 | 21.2.3  | dev      |
| `@commitlint/config-conventional` | 21.2.3  | dev      |
| `@content-collections/cli`        | 0.1.9   | dev      |
| `@content-collections/core`       | 0.15.3  | dev      |
| `@content-collections/next`       | 0.2.11  | dev      |
| `@neondatabase/serverless`        | 1.1.0   | prod     |
| `@react-email/ui`                 | 6.11.0  | dev      |
| `@sentry/nextjs`                  | 11.0.0  | prod     |
| `@t3-oss/env-nextjs`              | 0.13.11 | prod     |
| `@tailwindcss/postcss`            | 4.3.3   | dev      |
| `@tailwindcss/typography`         | 0.5.20  | dev      |
| `@testing-library/dom`            | 10.4.2  | dev      |
| `@testing-library/react`          | 16.3.3  | dev      |
| `@types/node`                     | 24.19.0 | dev      |
| `@types/pg`                       | 8.23.1  | dev      |
| `@types/react`                    | 19.3.0  | dev      |
| `@types/react-dom`                | 19.3.0  | dev      |
| `@types/ws`                       | 8.18.1  | dev      |
| `@upstash/ratelimit`              | 2.2.0   | prod     |
| `@upstash/redis`                  | 1.39.0  | prod     |
| `@vercel/analytics`               | 2.0.1   | prod     |
| `@vercel/otel`                    | 2.1.3   | prod     |
| `@vitejs/plugin-react`            | 6.1.1   | dev      |
| `@vitest/coverage-v8`             | 5.0.2   | dev      |
| `@waffo/pancake-ts`               | 0.25.0  | prod     |
| `auth`                            | 1.7.6   | dev      |
| `better-auth`                     | 1.7.6   | prod     |
| `cn`                              | 0.4.0   | prod     |
| `creem`                           | 1.13.0  | prod     |
| `drizzle-kit`                     | 0.31.11 | dev      |
| `eslint`                          | 9.39.5  | dev      |
| `eslint-config-next`              | 16.3.6  | dev      |
| `eslint-config-prettier`          | 10.1.8  | dev      |
| `husky`                           | 9.1.7   | dev      |
| `jsdom`                           | 30.1.1  | dev      |
| `lint-staged`                     | 17.6.0  | dev      |
| `next`                            | 16.3.6  | prod     |
| `next-intl`                       | 4.14.7  | prod     |
| `next-themes`                     | 0.4.6   | prod     |
| `pg`                              | 8.23.0  | prod     |
| `prettier`                        | 3.9.9   | dev      |
| `prettier-plugin-tailwindcss`     | 0.8.1   | dev      |
| `react`                           | 19.3.0  | prod     |
| `react-dom`                       | 19.3.0  | prod     |
| `react-email`                     | 6.11.0  | prod     |
| `resend`                          | 6.30.0  | prod     |
| `shadcn`                          | 4.21.0  | dev      |
| `sonner`                          | 2.0.8   | prod     |
| `stripe`                          | 22.6.2  | prod     |
| `tailwindcss`                     | 4.3.3   | dev      |
| `tw-animate-css`                  | 1.4.0   | prod     |
| `vitest`                          | 5.0.2   | dev      |
| `ws`                              | 8.22.0  | prod     |
| `zod`                             | 4.6.5   | prod     |

### Apache-2.0（21）

| 包                               | 版本     | 依赖类型 |
| -------------------------------- | -------- | -------- |
| `@ai-sdk/alibaba`                | 2.0.56   | prod     |
| `@ai-sdk/anthropic`              | 4.0.65   | prod     |
| `@ai-sdk/google`                 | 4.0.82   | prod     |
| `@ai-sdk/openai`                 | 4.0.78   | prod     |
| `@ai-sdk/provider`               | 4.0.18   | prod     |
| `@ai-sdk/react`                  | 4.0.119  | prod     |
| `@aws-sdk/client-s3`             | 3.1141.0 | prod     |
| `@aws-sdk/s3-request-presigner`  | 3.1141.0 | prod     |
| `@opentelemetry/api`             | 1.9.1    | prod     |
| `@opentelemetry/api-logs`        | 0.222.0  | prod     |
| `@opentelemetry/instrumentation` | 0.222.0  | prod     |
| `@opentelemetry/resources`       | 2.11.0   | prod     |
| `@opentelemetry/sdk-logs`        | 0.222.0  | prod     |
| `@opentelemetry/sdk-metrics`     | 2.11.0   | prod     |
| `@opentelemetry/sdk-trace-base`  | 2.11.0   | prod     |
| `@playwright/test`               | 1.63.0   | dev      |
| `@vercel/speed-insights`         | 2.0.0    | prod     |
| `ai`                             | 7.0.116  | prod     |
| `class-variance-authority`       | 0.7.1    | prod     |
| `drizzle-orm`                    | 0.45.3   | prod     |
| `typescript`                     | 6.0.3    | dev      |

### ISC（1）

| 包             | 版本   | 依赖类型 |
| -------------- | ------ | -------- |
| `lucide-react` | 1.48.0 | prod     |

### 没有 `license` 字段（1）

| 包                         | 版本  | 依赖类型 | 实际许可                                                                                                                                       |
| -------------------------- | ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `@content-collections/mdx` | 0.2.2 | prod     | `package.json` 里没有 `license` 字段，但包内附了 MIT 的 `LICENSE`（Copyright (c) 2024 Sebastian Sdorra），`pnpm licenses list` 也按 MIT 统计。 |

## 复现与维护

```bash
pnpm install --frozen-lockfile   # 保证装的是锁文件里的版本
pnpm notices:check               # 检查本文件有没有和锁文件漂移（CI 也跑这个）
pnpm licenses list               # 全量分布（本文件第一张表）
pnpm licenses list --prod        # 仅生产依赖（第二张表）
pnpm licenses list --json        # 机器可读，便于自己算分布
```

每个包的许可全文都随 `node_modules` 一起装到本地，路径是 `node_modules/<包名>/LICENSE*`。改动依赖后重跑上面的命令、核对这两张表的数字，再决定是否需要更新本节。

`pnpm notices:check` 管两件事：把「直接依赖明细」逐条按 `pnpm-lock.yaml` 校验（版本、prod / dev 类型、有没有多写或漏写），以及确认 `pnpm licenses list` 报出的许可都在本文件里出现过、且没有 GPL / AGPL / SSPL 这类强 copyleft。它**不比对两张分布表的包数**：那个数字按当前平台装上的可选依赖计（`@swc/core-*`、`@img/sharp-libvips-*`、`lightningcss-*` ……），在 macOS 上算出来的数字在 Linux CI 上必然对不上，所以包数只由脚本打印出来供人核对。改依赖时如果脚本报出没见过的许可，就在本节的两张表里补一行，并在「需要单独说明的许可」里交代它有没有义务。

买家侧的义务不受模板 EULA 影响：第三方组件由各自的作者按各自的许可直接授权给买家，见 [LICENSE](LICENSE) 第 7 节。
