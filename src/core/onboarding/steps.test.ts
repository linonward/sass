import { describe, expect, test } from "vitest";

import { FACTORY_BRAND_COLOR, onboardingSteps } from "./steps";

/** 除了指定字段，其余都按「已经配置好」算，单个用例只验证一个判定。 */
function input(overrides: Partial<Parameters<typeof onboardingSteps>[0]> = {}) {
  return {
    brandColor: "#4f46e5",
    placeholders: [],
    planProductIds: ["prod_live_pro"],
    blogEnabled: true,
    onVercel: true,
    ...overrides,
  };
}

function statusOf(
  steps: ReturnType<typeof onboardingSteps>,
  id: ReturnType<typeof onboardingSteps>[number]["id"],
) {
  return steps.find((step) => step.id === id)?.status;
}

describe("onboardingSteps", () => {
  test("配置都改好、跑在 Vercel 上时，只剩写文章要手动勾", () => {
    const steps = onboardingSteps(input());
    expect(steps.map((step) => step.id)).toEqual([
      "brandColor",
      "siteName",
      "pricing",
      "blogPost",
      "deploy",
    ]);
    expect(steps.map((step) => step.status)).toEqual([
      "done",
      "done",
      "done",
      "manual",
      "done",
    ]);
  });

  test("品牌色还是出厂值时算未完成，并给出原文", () => {
    const steps = onboardingSteps(input({ brandColor: FACTORY_BRAND_COLOR }));
    expect(statusOf(steps, "brandColor")).toBe("todo");
    expect(steps.find((step) => step.id === "brandColor")?.evidence).toEqual([
      `brand.primaryColor = "${FACTORY_BRAND_COLOR}"`,
    ]);
  });

  test("品牌色比大小写、去空格后相同才算没改", () => {
    expect(
      statusOf(
        onboardingSteps(input({ brandColor: "  #0F766E " })),
        "brandColor",
      ),
    ).toBe("todo");
    expect(
      statusOf(onboardingSteps(input({ brandColor: "#0f766d" })), "brandColor"),
    ).toBe("done");
  });

  test("哨兵报告了占位值就算未完成，每一条都进 evidence", () => {
    const steps = onboardingSteps(
      input({
        placeholders: [
          { path: "name", placeholder: "Acme", hint: "改成你的产品名" },
          {
            path: "email.fromAddress",
            placeholder: "noreply@example.com",
            hint: "改成你的发件地址",
          },
        ],
      }),
    );
    expect(statusOf(steps, "siteName")).toBe("todo");
    expect(steps.find((step) => step.id === "siteName")?.evidence).toEqual([
      'name = "Acme"',
      'email.fromAddress = "noreply@example.com"',
    ]);
  });

  test("套餐里还有占位产品 ID 时算未完成", () => {
    const steps = onboardingSteps(
      input({ planProductIds: ["prod_placeholder_pro", "prod_live_lifetime"] }),
    );
    expect(statusOf(steps, "pricing")).toBe("todo");
    expect(steps.find((step) => step.id === "pricing")?.evidence).toEqual([
      'providerProductId = "prod_placeholder_pro"',
    ]);
  });

  test("没有付费套餐（一个产品 ID 都没有）算已完成", () => {
    expect(
      statusOf(onboardingSteps(input({ planProductIds: [] })), "pricing"),
    ).toBe("done");
  });

  test("不在 Vercel 上时部署只能手动勾", () => {
    expect(
      statusOf(onboardingSteps(input({ onVercel: false })), "deploy"),
    ).toBe("manual");
    expect(statusOf(onboardingSteps(input({ onVercel: true })), "deploy")).toBe(
      "done",
    );
  });

  test("关掉博客模块后没有写文章这一步", () => {
    const steps = onboardingSteps(input({ blogEnabled: false }));
    expect(steps.map((step) => step.id)).not.toContain("blogPost");
    expect(steps).toHaveLength(4);
  });

  test("自动判定的步骤不会带 manual 状态", () => {
    const steps = onboardingSteps(
      input({ brandColor: FACTORY_BRAND_COLOR, onVercel: false }),
    );
    for (const step of steps) {
      if (step.id === "brandColor") expect(step.status).toBe("todo");
      if (step.id === "deploy") expect(step.status).toBe("manual");
    }
    // 手动步骤没有 evidence：界面不给它显示「还没改的出厂值」。
    expect(
      steps
        .filter((step) => step.status === "manual")
        .flatMap((s) => s.evidence),
    ).toEqual([]);
  });
});
