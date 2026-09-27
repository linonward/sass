import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FeatureFlag, FlagsProvider, useFlag } from "./components";

function Probe({ name }: { name: string }) {
  return <span data-testid="probe">{String(useFlag(name))}</span>;
}

/** 渲染一个读 flag 的客户端组件，可选地套一层 provider。 */
function probe(name: string, values?: Record<string, boolean>) {
  cleanup(); // 同一个 test 里会查好几次，先卸掉上一次的
  const content = <Probe name={name} />;
  render(
    values ? <FlagsProvider values={values}>{content}</FlagsProvider> : content,
  );
  return screen.getByTestId("probe").textContent;
}

describe("useFlag", () => {
  test("provider 里的值原样返回，快照里没有的 flag 是 false", () => {
    expect(probe("beta-dashboard", { "beta-dashboard": true })).toBe("true");
    expect(probe("beta-preview", { "beta-dashboard": true })).toBe("false");
  });

  test("总开关关着时快照是空的（resolveFlags 返回 {}），读到的都是 false", () => {
    expect(probe("beta-dashboard", {})).toBe("false");
  });

  test("没有 provider 时返回 false，不抛错", () => {
    expect(probe("beta-dashboard")).toBe("false");
  });
});

describe("FeatureFlag", () => {
  test("开着时渲染 children", () => {
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

  test("关着时渲染 fallback（没有 provider 时也是）", () => {
    render(
      <FeatureFlag name="beta-dashboard" fallback={<span>old</span>}>
        <span>new</span>
      </FeatureFlag>,
    );
    expect(screen.queryByText("new")).toBeNull();
    expect(screen.getByText("old")).toBeDefined();
  });

  test("关着且没有 fallback 时什么都不渲染", () => {
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
