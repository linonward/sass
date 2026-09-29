import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FeatureFlag, FlagsProvider, useFlag } from "./components";

function Probe({ name }: { name: string }) {
  return <span data-testid="probe">{String(useFlag(name))}</span>;
}

/** Renders a client component that reads a flag, optionally wrapped in a provider. */
function probe(name: string, values?: Record<string, boolean>) {
  cleanup(); // A single test queries several times, so unmount the previous render first
  const content = <Probe name={name} />;
  render(
    values ? <FlagsProvider values={values}>{content}</FlagsProvider> : content,
  );
  return screen.getByTestId("probe").textContent;
}

describe("useFlag", () => {
  test("returns provider values as-is; flags missing from the snapshot are false", () => {
    expect(probe("beta-dashboard", { "beta-dashboard": true })).toBe("true");
    expect(probe("beta-preview", { "beta-dashboard": true })).toBe("false");
  });

  test("with the master switch off the snapshot is empty (resolveFlags returns {}), so every read is false", () => {
    expect(probe("beta-dashboard", {})).toBe("false");
  });

  test("returns false without a provider instead of throwing", () => {
    expect(probe("beta-dashboard")).toBe("false");
  });
});

describe("FeatureFlag", () => {
  test("renders children when on", () => {
    render(
      <FlagsProvider values={{ "beta-dashboard": true }}>
        <FeatureFlag name="beta-dashboard" fallback={<span>old</span>}>
          <span>new</span>
        </FeatureFlag>
      </FlagsProvider>,
    );
    expect(screen.getByText("new")).toBeDefined();
    expect(screen.queryByText("old")).toBeNull();
  });

  test("renders fallback when off (also without a provider)", () => {
    render(
      <FeatureFlag name="beta-dashboard" fallback={<span>old</span>}>
        <span>new</span>
      </FeatureFlag>,
    );
    expect(screen.queryByText("new")).toBeNull();
    expect(screen.getByText("old")).toBeDefined();
  });

  test("renders nothing when off with no fallback", () => {
    render(
      <FlagsProvider values={{}}>
        <div data-testid="host">
          <FeatureFlag name="beta-dashboard">
            <span>new</span>
          </FeatureFlag>
        </div>
      </FlagsProvider>,
    );
    expect(screen.getByTestId("host").innerHTML).toBe("");
  });
});
