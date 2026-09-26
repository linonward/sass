import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

/**
 * 这个文件守的是一条具体的、量级很大的性能不变量，不是风格问题。
 *
 * 客户端组件会经 `core/i18n/navigation.ts` 引用 `routing.ts`，而 `site.config.ts` 走
 * `defineConfig()` 的 zod 校验。所以只要 `routing.ts` 读了 `site.config.ts`，整个 zod
 * 和配置 schema 就会被拖进**每一个页面**的客户端 bundle —— 实测过：92 KB gzip，
 * 23/25 条路由中招，连 privacy / terms / refund 三条静态法律页都背上了。
 *
 * 修法是把语言清单放进一个不 import 任何东西的叶子模块（`./locales.ts`）。这两个断言
 * 就是防止它被改回去。改坏了的话，构建产物里能查出来，但那要等到构建之后；
 * 这里让它在单测阶段就红。
 */
describe("i18n 语言清单的叶子模块", () => {
  it("locales.ts 不 import 任何东西（它是叶子，任何依赖都可能把 zod 带进来）", () => {
    const source = read("./locales.ts");
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it("routing.ts 从 ./locales 读，不 import site.config", () => {
    const source = read("./routing.ts");
    // 只匹配真正的 import 语句：注释里提到 site.config.ts 是说明原因，不该被判违规。
    // import 了配置就会把 zod 和整个 schema 拖进客户端 bundle。
    expect(source).not.toMatch(/^\s*import\s[^;]*site\.config/m);
    expect(source).toMatch(/from "\.\/locales"/);
  });
});
