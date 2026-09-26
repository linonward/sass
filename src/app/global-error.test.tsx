import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { registerSentry } from "@/core/observability/sentry";

import GlobalError from "./global-error";

/**
 * 最外层边界：`[locale]/layout.tsx` **自身**出错时由它替换整个文档（root layout 之下的
 * 边界都接不到，包括 [locale]/error.tsx）。
 *
 * 这里刻意不包 NextIntlClientProvider —— 这正是生产环境的样子（这个文件替换的就是提供
 * provider 的那个 layout），所以用例同时锁住「它不依赖 next-intl」：谁哪天在这里用
 * useTranslations，这一整个文件都会红。
 *
 * 文案是写死的英文，所以断言也用字面量而不是 messages/*.json：这个文件按设计不跟着
 * 语言走（见文件里的注释），拿 messages 断言会掩盖这一点。
 */
function renderBoundary(
  error: Error & { digest?: string },
  retry: () => void = () => {},
) {
  return render(<GlobalError error={error} retry={retry} />);
}

afterEach(() => {
  // 上报器存在 globalThis 上，不注销会串到后面的用例。
  registerSentry(undefined);
});

describe("全局错误边界（global-error.tsx）", () => {
  test("自带 <html lang> 与完整文档，渲染标题、说明与重试按钮", () => {
    renderBoundary(new Error("boom"));

    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" }),
    ).toBeDefined();
    expect(
      screen.getByText("An unexpected error occurred. Please try again."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    // 换掉 root layout 后拿不到 [locale]/layout 的 <html lang>，这个属性得自己给。
    expect(document.documentElement.lang).toBe("en");
  });

  test("点重试按钮触发 retry", () => {
    const retry = vi.fn();
    renderBoundary(new Error("boom"), retry);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("把标题写进 <title>：它替换整个文档，metadata 导出在这里不可用", () => {
    renderBoundary(new Error("boom"));

    expect(document.title).toBe("Something went wrong");
  });

  test("上报错误（console + 已注册的上报器）", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const captureException = vi.fn();
    registerSentry({
      captureException,
      setUser: vi.fn(),
      withScope: vi.fn(),
    });
    const error = new Error("boom");

    renderBoundary(error);

    expect(consoleError).toHaveBeenCalledWith(error);
    expect(captureException).toHaveBeenCalledWith(error);
    consoleError.mockRestore();
  });
});
