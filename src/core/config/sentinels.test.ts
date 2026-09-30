import { describe, expect, test } from "vitest";

import {
  firstPlaceholderWarning,
  placeholderAction,
  placeholderIssues,
  placeholderMessage,
} from "./sentinels";
import type { SiteConfig } from "./schema";

/** Only the fields the sentinel cares about; the unused rest is left to the type assertion. */
const config = (over: Partial<SiteConfig> = {}) =>
  ({
    name: "Acme",
    domain: "example.com",
    legal: { companyName: "Acme Inc." },
    email: { fromAddress: "noreply@example.com" },
    ...over,
  }) as SiteConfig;

// The "customized" values are a neutral set. The seller's brand and domain must **not** appear
// here: this file ships to buyers with the template, and `scripts/release-package.sh` would block
// the whole package on a seller-domain match (CI runs that self-check on every PR) — otherwise
// we'd be shipping the seller's contact details to buyers.
const customized = () =>
  config({
    name: "Example Corp",
    domain: "example.org",
    legal: { companyName: "Example Corp" } as SiteConfig["legal"],
    email: { fromAddress: "hello@example.org" } as SiteConfig["email"],
  });

describe("placeholder sentinel", () => {
  test("reports all four fields when all are still shipped placeholders", () => {
    expect(placeholderIssues(config()).map((issue) => issue.path)).toEqual([
      "name",
      "domain",
      "legal.companyName",
      "email.fromAddress",
    ]);
  });

  test("reports only the unchanged fields after a partial change", () => {
    const issues = placeholderIssues(
      config({ name: "Example Corp", domain: "example.org" }),
    );
    expect(issues.map((issue) => issue.path)).toEqual([
      "legal.companyName",
      "email.fromAddress",
    ]);
  });

  test("reports no issues once everything is changed", () => {
    expect(placeholderIssues(customized())).toEqual([]);
  });

  test("each message line includes the field, shipped value, and fix", () => {
    const message = placeholderMessage(placeholderIssues(config()));
    expect(message).toContain('name is still "Acme"');
    expect(message).toContain("SITE_NAME");
    expect(message).toContain('domain is still "example.com"');
    expect(message).toContain("SITE_DOMAIN");
  });

  test("production build throws", () => {
    const action = placeholderAction(placeholderIssues(config()), "production");
    expect(action.throwMessage).toContain("placeholder values");
    expect(action.warnMessage).toBeUndefined();
  });

  test("development warns without throwing", () => {
    const action = placeholderAction(
      placeholderIssues(config()),
      "development",
    );
    expect(action.throwMessage).toBeUndefined();
    expect(action.warnMessage).toContain("placeholder values");
  });

  test("test and other environments stay quiet (every test file imports site.config.ts)", () => {
    expect(placeholderAction(placeholderIssues(config()), "test")).toEqual({});
    expect(placeholderAction(placeholderIssues(config()), undefined)).toEqual(
      {},
    );
  });

  test("does nothing once configured, even in a production build", () => {
    expect(
      placeholderAction(placeholderIssues(customized()), "production"),
    ).toEqual({});
  });
});

describe("firstPlaceholderWarning", () => {
  test("is true once, then false for anything sharing the same environment", () => {
    const env: Record<string, string | undefined> = {};
    expect(firstPlaceholderWarning(env)).toBe(true);
    expect(firstPlaceholderWarning(env)).toBe(false);
    // A child process inherits the environment, so it stays quiet too.
    expect(firstPlaceholderWarning({ ...env })).toBe(false);
  });

  test("a fresh environment warns again", () => {
    expect(firstPlaceholderWarning({})).toBe(true);
  });
});
