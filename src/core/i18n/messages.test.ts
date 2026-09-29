import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { suiteNav } from "@/core/dashboard/nav";

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
  test("every nav key in site.config is in en.json Nav", () => {
    const { header, footer } = siteConfig.nav;
    const used = [
      ...header.map((l) => l.key),
      ...footer.flatMap((g) => [g.key, ...g.links.map((l) => l.key)]),
    ];
    expect(Object.keys(en.Nav)).toEqual(expect.arrayContaining(used));
  });

  test("every dashboard menu item key is in en.json Dashboard.nav", () => {
    const used = [
      ...suiteNav.map((item) => item.key),
      ...siteConfig.dashboard.nav.map((item) => item.key),
    ];
    expect(Object.keys(en.Dashboard.nav)).toEqual(expect.arrayContaining(used));
  });

  test("every enabled locale has a messages file", () => {
    const files = readdirSync(dir).map((f) => path.basename(f, ".json"));
    expect(files).toEqual(expect.arrayContaining(siteConfig.locales));
  });

  test.each(readdirSync(dir).filter((f) => f !== "en.json"))(
    "%s has the same keys as en.json",
    (file) => {
      const other = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      expect(keys(other).sort()).toEqual(keys(en).sort());
    },
  );
});
