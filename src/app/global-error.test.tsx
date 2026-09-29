import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { registerSentry } from "@/core/observability/sentry";

import GlobalError from "./global-error";

/**
 * The outermost boundary: when `[locale]/layout.tsx` **itself** fails, this replaces the whole
 * document (no boundary below the root layout can catch it, including [locale]/error.tsx).
 *
 * Deliberately not wrapped in NextIntlClientProvider — that's exactly how it runs in production
 * (this file replaces the very layout that provides it), so the tests also lock in "it doesn't
 * depend on next-intl": if anyone ever uses useTranslations here, this whole file goes red.
 *
 * The copy is hard-coded English, so the assertions use literals rather than messages/*.json: by
 * design this file doesn't follow the locale (see the comments in it), and asserting against
 * messages would hide that.
 */
function renderBoundary(
  error: Error & { digest?: string },
  retry: () => void = () => {},
) {
  return render(<GlobalError error={error} retry={retry} />);
}

afterEach(() => {
  // Reporters live on globalThis; without unregistering they leak into later tests.
  registerSentry(undefined);
});

describe("global error boundary (global-error.tsx)", () => {
  test("brings its own <html lang> and full document, and renders the title, description and retry button", () => {
    renderBoundary(new Error("boom"));

    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" }),
    ).toBeDefined();
    expect(
      screen.getByText("An unexpected error occurred. Please try again."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    // Once the root layout is replaced, [locale]/layout's <html lang> is gone, so it must set it itself.
    expect(document.documentElement.lang).toBe("en");
  });

  test("clicking retry calls retry", () => {
    const retry = vi.fn();
    renderBoundary(new Error("boom"), retry);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("writes the title into <title>: it replaces the whole document, so a metadata export isn't available", () => {
    renderBoundary(new Error("boom"));

    expect(document.title).toBe("Something went wrong");
  });

  test("reports the error (console + registered reporters)", () => {
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
