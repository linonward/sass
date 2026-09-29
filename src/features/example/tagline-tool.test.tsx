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
  // product is required + minLength 3, so fill it in to pass native validation.
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
  // This is an example buyers copy: AI producing duplicate taglines is perfectly normal, and key
  // collisions would flood the console with warnings.
  test("duplicate taglines don't trigger React's key warning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    generateTaglines.mockResolvedValue(done(["Same line", "Same line"]));
    renderTool();

    submit();
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );
    expect(error).not.toHaveBeenCalled();
  });

  test("after submit the input keeps product, so it can be tweaked and regenerated", async () => {
    generateTaglines.mockResolvedValue(done(["a", "b"]));
    renderTool();
    const input = screen.getByLabelText(/product/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "Acme Invoices" } });
    submit();
    await waitFor(() => expect(screen.getByText("a")).toBeDefined());

    // React resets uncontrolled inputs in the form; controlled values are unaffected (an uncontrolled
    // input would need product stuffed back into defaultValue to survive).
    expect(input.value).toBe("Acme Invoices");
  });
});
