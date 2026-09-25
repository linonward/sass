import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import siteConfig from "../../../site.config";
import en from "../../../messages/en.json";

const dir = path.resolve(__dirname, "../../../messages");

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("messages", () => {
  test("site.config 里的导航 key 都在 en.json 的 Nav 中", () => {
    const { header, footer } = siteConfig.nav;
    const used = [
      ...header.map((l) => l.key),
      ...footer.flatMap((g) => [g.key, ...g.links.map((l) => l.key)]),
    ];
    expect(Object.keys(en.Nav)).toEqual(expect.arrayContaining(used));
  });

  test("每个启用的语言都有对应的 messages 文件", () => {
    const files = readdirSync(dir).map((f) => path.basename(f, ".json"));
    expect(files).toEqual(expect.arrayContaining(siteConfig.locales));
  });

  test.each(readdirSync(dir).filter((f) => f !== "en.json"))(
    "%s 与 en.json 的 key 一致",
    (file) => {
      const other = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      expect(keys(other).sort()).toEqual(keys(en).sort());
    },
  );
});
