import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import siteConfig from "../../../site.config";
import { deepMerge, withOverlay, withOverlayMessages } from "./overlay";

function overlayDir(files: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), "site-overlay-"));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(
      target,
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return dir;
}

const env = (dir?: string) => ({ SITE_OVERLAY_DIR: dir });

describe("site overlay", () => {
  test("without SITE_OVERLAY_DIR, config and messages are unchanged", () => {
    expect(withOverlay(siteConfig, env())).toEqual(siteConfig);
    const messages = { Landing: { hero: { title: "Hi" } } };
    expect(withOverlayMessages("en", messages, env())).toBe(messages);
  });

  test("site.json replaces landing and nav, filling schema defaults", () => {
    const dir = overlayDir({
      "site.json": {
        landing: { sections: ["hero", "delivery"], purchasePlan: "lifetime" },
        nav: { header: [{ key: "delivery", href: "/#delivery" }] },
      },
    });
    const config = withOverlay(siteConfig, env(dir));
    expect(config.landing.sections).toEqual(["hero", "delivery"]);
    expect(config.landing.purchasePlan).toBe("lifetime");
    expect(config.landing.demo).toBe(false);
    expect(config.landing.hero.stepIcons).toHaveLength(3);
    expect(config.nav.header).toEqual([
      { key: "delivery", href: "/#delivery" },
    ]);
    expect(config.nav.footer).toEqual([]);
    // Everything else stays as in site.config.ts.
    expect(config.billing).toBe(siteConfig.billing);
  });

  test("a site.json with only nav keeps the default landing", () => {
    const dir = overlayDir({ "site.json": { nav: { header: [] } } });
    expect(withOverlay(siteConfig, env(dir)).landing).toBe(siteConfig.landing);
  });

  test("an invalid site.json fails with the field path", () => {
    const dir = overlayDir({
      "site.json": { landing: { sections: ["hero", "blog"] } },
    });
    expect(() => withOverlay(siteConfig, env(dir))).toThrow(
      /landing\.sections/,
    );
    const unknown = overlayDir({ "site.json": { billing: {} } });
    expect(() => withOverlay(siteConfig, env(unknown))).toThrow(/billing/);
  });

  test("a directory that doesn't exist fails instead of falling back", () => {
    const missing = path.join(tmpdir(), "site-overlay-missing-dir");
    expect(() => withOverlay(siteConfig, env(missing))).toThrow(
      /does not exist/,
    );
  });

  test("messages are deep-merged per locale", () => {
    const dir = overlayDir({
      "messages/en.json": {
        Landing: { hero: { title: "Sell it" }, delivery: { offer: "Kit" } },
      },
    });
    const base = {
      Landing: { hero: { title: "Hi", subtitle: "Sub" } },
      Nav: { faq: "FAQ" },
    };
    expect(withOverlayMessages("en", base, env(dir))).toEqual({
      Landing: {
        hero: { title: "Sell it", subtitle: "Sub" },
        delivery: { offer: "Kit" },
      },
      Nav: { faq: "FAQ" },
    });
    // No file for this locale: messages pass through untouched.
    expect(withOverlayMessages("zh", base, env(dir))).toBe(base);
  });

  test("deepMerge replaces arrays and leaves the inputs untouched", () => {
    const base = { a: { list: [1, 2], keep: true } };
    const merged = deepMerge(base, { a: { list: [3] } });
    expect(merged).toEqual({ a: { list: [3], keep: true } });
    expect(base).toEqual({ a: { list: [1, 2], keep: true } });
  });
});
