import { render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { trackEvents } from "./events";
import { track } from "./track";
import { createServerTracker } from "./track-server";
import { webAnalyticsFlags } from "./web-analytics";
import { WebAnalyticsScripts } from "./web-analytics-scripts";

vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => <script data-testid="analytics" />,
}));
vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: () => <script data-testid="speed-insights" />,
}));

const vercelTrack = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track: vercelTrack }));

function config(
  observability: boolean,
  flags: { analytics?: boolean; speedInsights?: boolean },
) {
  return {
    features: { observability } as never,
    observability: {
      logLevel: "info" as const,
      otel: false,
      sentry: false,
      sentryTracesSampleRate: 0.1,
      analytics: flags.analytics ?? false,
      speedInsights: flags.speedInsights ?? false,
    },
  };
}

afterEach(() => {
  vercelTrack.mockReset();
  delete window.va;
});

describe("webAnalyticsFlags", () => {
  test("features.observability is the master switch", () => {
    expect(
      webAnalyticsFlags(
        config(false, { analytics: true, speedInsights: true }),
      ),
    ).toEqual({ analytics: false, speedInsights: false });
    expect(
      webAnalyticsFlags(
        config(true, { analytics: true, speedInsights: false }),
      ),
    ).toEqual({ analytics: true, speedInsights: false });
  });

  test("reads the flags from site.config by default", () => {
    expect(webAnalyticsFlags()).toEqual({
      analytics: true,
      speedInsights: true,
    });
  });
});

describe("WebAnalyticsScripts", () => {
  test("renders no scripts when both are off", () => {
    const { container } = render(
      <WebAnalyticsScripts
        flags={{ analytics: false, speedInsights: false }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  test("renders Analytics and Speed Insights according to their own flags", () => {
    const { queryByTestId, rerender } = render(
      <WebAnalyticsScripts flags={{ analytics: true, speedInsights: false }} />,
    );
    expect(queryByTestId("analytics")).not.toBeNull();
    expect(queryByTestId("speed-insights")).toBeNull();

    rerender(
      <WebAnalyticsScripts flags={{ analytics: false, speedInsights: true }} />,
    );
    expect(queryByTestId("analytics")).toBeNull();
    expect(queryByTestId("speed-insights")).not.toBeNull();
  });
});

describe("track (client)", () => {
  test("is a no-op when <Analytics /> isn't mounted (window.va is missing)", () => {
    track(trackEvents.checkoutStarted, { plan: "pro" });
    expect(vercelTrack).not.toHaveBeenCalled();
  });

  test("forwards to @vercel/analytics once mounted", () => {
    window.va = vi.fn();
    track(trackEvents.checkoutStarted, { plan: "pro" });
    expect(vercelTrack).toHaveBeenCalledWith("checkout_started", {
      plan: "pro",
    });
  });

  test("doesn't throw analytics errors to the caller", () => {
    window.va = vi.fn();
    vercelTrack.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => track("custom_event")).not.toThrow();
  });
});

describe("createServerTracker", () => {
  test("sends nothing when off", async () => {
    const send = vi.fn();
    await createServerTracker({ enabled: false, send })(trackEvents.signUp);
    expect(send).not.toHaveBeenCalled();
  });

  test("when on, sends the event name, properties, and visitor headers", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const headers = new Headers({ "user-agent": "test" });
    await createServerTracker({ enabled: true, send })(
      trackEvents.purchase,
      { plan: "pro" },
      { headers },
    );
    expect(send).toHaveBeenCalledWith("purchase", { plan: "pro" }, { headers });
  });

  test("a failed send is only logged as warn, not thrown", async () => {
    const error = new Error("network");
    const send = vi.fn().mockRejectedValue(error);
    const logWarn = vi.fn();
    await expect(
      createServerTracker({ enabled: true, send, logWarn })(trackEvents.signUp),
    ).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith("analytics.track_failed", {
      error,
      event: "sign_up",
    });
  });
});
