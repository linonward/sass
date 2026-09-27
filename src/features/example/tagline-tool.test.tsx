import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import en from "../../../messages/en.json";
import { TaglineTool } from "./tagline-tool";

const generateTaglines = vi.fn();
vi.mock("./actions", () => ({
  generateTaglines: (...args: unknown[]) => generateTaglines(...args),
}));

function done(taglines: string[]) {
  return {
    status: "done",
    ok: true,
    taglines,
    nextRequestId: "req-1",
  };
}

function renderTool() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TaglineTool requestId="req-0" quickCost={1} aiCost={1} />
    </NextIntlClientProvider>,
  );
}

function submit() {
  // product 是 required + minLength 3，先填上才过得了原生校验。
  fireEvent.change(screen.getByLabelText(/product/i), {
    target: { value: "Acme Invoices" },
  });
  fireEvent.click(screen.getByRole("button", { name: /quick/i }));
}

afterEach(() => {
  generateTaglines.mockReset();
  vi.restoreAllMocks();
});

describe("TaglineTool", () => {
  // 这是给买家抄的示例：AI 生成重复 tagline 是很正常的事，key 冲突会在控制台刷警告。
  test("重复的 tagline 不触发 React 的 key 警告", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    generateTaglines.mockResolvedValue(done(["Same line", "Same line"]));
    renderTool();

    submit();
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );
    expect(error).not.toHaveBeenCalled();
  });

  test("提交后输入框保留 product，可以改一改再生成", async () => {
    generateTaglines.mockResolvedValue(done(["a", "b"]));
    renderTool();
    const input = screen.getByLabelText(/product/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "Acme Invoices" } });
    submit();
    await waitFor(() => expect(screen.getByText("a")).toBeDefined());

    // React 会重置表单里的非受控输入；受控的值不受影响（非受控写法要额外把
    // product 塞回 defaultValue 才活得下来）。
    expect(input.value).toBe("Acme Invoices");
  });
});
