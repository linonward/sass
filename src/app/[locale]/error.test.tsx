import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import { registerSentry } from "@/core/observability/sentry";

import messages from "../../../messages/en.json";
// 别把默认导出叫 `Error`：会盖住全局 Error 构造器，之后 `new Error("boom")` 调用的是
// 这个组件本体，React 报 "Invalid hook call"（useTranslations 在渲染外被调用）。
import ErrorBoundary from "./error";

/**
 * `[locale]/error.tsx` 这一层边界（[locale] 的 layout 之下、page/嵌套 layout 之上）。
 *
 * 为什么直接渲染组件而不是走 e2e 制造真崩溃：能故意抛错的测试钩子会以生产可见的形态
 * 留在模板里，买家买到的就是一个「访问某路径就 500」的开关；而 CI 的 e2e 跑的是生产
 * 构建（NODE_ENV=production），按环境变量分流的钩子在那里根本不可达。这里锁的是边界
 * 自身的行为（文案、Error ID、retry 回调、标题、上报），框架是否真的把它接上由审计时
 * 的生产构建探针人工验证（见 PR 说明）。
 */
function renderBoundary(
  error: Error & { digest?: string },
  retry: () => void = () => {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ErrorBoundary error={error} retry={retry} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  // 上报器存在 globalThis 上，不注销会串到后面的用例。
  registerSentry(undefined);
});

describe("[locale] 段错误边界（error.tsx）", () => {
  test("渲染本地化的标题、说明与重试按钮", () => {
    renderBoundary(new Error("boom"));

    expect(
      screen.getByRole("heading", { level: 1, name: messages.Error.title }),
    ).toBeDefined();
    expect(screen.getByText(messages.Error.description)).toBeDefined();
    expect(
      screen.getByRole("button", { name: messages.Error.retry }),
    ).toBeDefined();
  });

  test("有 digest 时显示 Error ID，客户报障时能对上服务端日志", () => {
    renderBoundary(Object.assign(new Error("boom"), { digest: "abc123" }));

    expect(
      screen.getByText(messages.Error.id.replace("{digest}", "abc123")),
    ).toBeDefined();
  });

  test("没有 digest 时不显示 Error ID（客户端错误没有这个字段）", () => {
    renderBoundary(new Error("boom"));

    expect(screen.queryByText(/Error ID:/)).toBeNull();
  });

  test("点重试按钮触发 retry（不是刷新页面）", () => {
    const retry = vi.fn();
    renderBoundary(new Error("boom"), retry);

    fireEvent.click(screen.getByRole("button", { name: messages.Error.retry }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("把标题写进 <title>：client 边界用不了 metadata 导出，出错时标题不能停在被替换掉的那页", () => {
    renderBoundary(new Error("boom"));

    expect(document.title).toBe(messages.Error.title);
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
