import { describe, expect, test } from "vitest";

import {
  placeholderAction,
  placeholderIssues,
  placeholderMessage,
} from "./sentinels";
import type { SiteConfig } from "./schema";

/** 只带哨兵关心的字段；其余用不到的字段留给类型断言。 */
const config = (over: Partial<SiteConfig> = {}) =>
  ({
    name: "Acme",
    domain: "example.com",
    legal: { companyName: "Acme Inc." },
    email: { fromAddress: "noreply@example.com" },
    ...over,
  }) as SiteConfig;

const customized = () =>
  config({
    name: "Linonward",
    domain: "linonward.com",
    legal: { companyName: "Linonward" } as SiteConfig["legal"],
    email: { fromAddress: "hello@linonward.com" } as SiteConfig["email"],
  });

describe("占位哨兵", () => {
  test("出厂配置四个字段全是占位值时全部报出来", () => {
    expect(placeholderIssues(config()).map((issue) => issue.path)).toEqual([
      "name",
      "domain",
      "legal.companyName",
      "email.fromAddress",
    ]);
  });

  test("只改了一部分时只报没改的", () => {
    const issues = placeholderIssues(
      config({ name: "Linonward", domain: "linonward.com" }),
    );
    expect(issues.map((issue) => issue.path)).toEqual([
      "legal.companyName",
      "email.fromAddress",
    ]);
  });

  test("全部改掉后没有 issue", () => {
    expect(placeholderIssues(customized())).toEqual([]);
  });

  test("每一行提示都带上字段、出厂值和改法", () => {
    const message = placeholderMessage(placeholderIssues(config()));
    expect(message).toContain('name 还是 "Acme"');
    expect(message).toContain("SITE_NAME");
    expect(message).toContain('domain 还是 "example.com"');
    expect(message).toContain("SITE_DOMAIN");
  });

  test("生产构建直接抛错", () => {
    const action = placeholderAction(placeholderIssues(config()), "production");
    expect(action.throwMessage).toContain("占位值");
    expect(action.warnMessage).toBeUndefined();
  });

  test("开发环境只警告不抛错", () => {
    const action = placeholderAction(
      placeholderIssues(config()),
      "development",
    );
    expect(action.throwMessage).toBeUndefined();
    expect(action.warnMessage).toContain("占位值");
  });

  test("测试等其他环境不吭声（每个测试文件都会 import site.config.ts）", () => {
    expect(placeholderAction(placeholderIssues(config()), "test")).toEqual({});
    expect(placeholderAction(placeholderIssues(config()), undefined)).toEqual(
      {},
    );
  });

  test("配好了就算在生产构建里也什么都不做", () => {
    expect(
      placeholderAction(placeholderIssues(customized()), "production"),
    ).toEqual({});
  });
});
