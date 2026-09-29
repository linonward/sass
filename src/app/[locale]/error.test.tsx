import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

import { registerSentry } from "@/core/observability/sentry";

import messages from "../../../messages/en.json";
// Don't name the default import `Error`: it would shadow the global Error constructor, so
// `new Error("boom")` would call this component and React would report "Invalid hook call"
// (useTranslations called outside rendering).
import ErrorBoundary from "./error";

/**
 * The `[locale]/error.tsx` boundary (below the [locale] layout, above pages and nested layouts).
 *
 * Why render the component directly instead of causing a real crash in e2e: a test hook that can
 * throw on purpose would stay in the template in a production-visible form, and buyers would get a
 * "visit this path to get a 500" switch; and CI's e2e runs a production build (NODE_ENV=production),
 * where a hook gated on an environment variable is unreachable anyway. This locks the boundary's
 * own behavior (copy, Error ID, retry callback, title, reporting); whether the framework actually
 * wires it up was verified manually with a production-build probe during review.
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
  // Reporters live on globalThis; without unregistering they leak into later tests.
  registerSentry(undefined);
});

describe("[locale] segment error boundary (error.tsx)", () => {
  test("renders the localized title, description and retry button", () => {
    renderBoundary(new Error("boom"));

    expect(
      screen.getByRole("heading", { level: 1, name: messages.Error.title }),
    ).toBeDefined();
    expect(screen.getByText(messages.Error.description)).toBeDefined();
    expect(
      screen.getByRole("button", { name: messages.Error.retry }),
    ).toBeDefined();
  });

  test("shows the Error ID when there's a digest, so a user's report can be matched to server logs", () => {
    renderBoundary(Object.assign(new Error("boom"), { digest: "abc123" }));

    expect(
      screen.getByText(messages.Error.id.replace("{digest}", "abc123")),
    ).toBeDefined();
  });

  test("hides the Error ID without a digest (client errors don't have one)", () => {
    renderBoundary(new Error("boom"));

    expect(screen.queryByText(/Error ID:/)).toBeNull();
  });

  test("clicking retry calls retry (instead of reloading the page)", () => {
    const retry = vi.fn();
    renderBoundary(new Error("boom"), retry);

    fireEvent.click(screen.getByRole("button", { name: messages.Error.retry }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("writes the title into <title>: a client boundary can't export metadata, and the title mustn't stay on the replaced page", () => {
    renderBoundary(new Error("boom"));

    expect(document.title).toBe(messages.Error.title);
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
