import { describe, expect, test } from "vitest";

import { FACTORY_BRAND_COLOR, onboardingSteps } from "./steps";

/**
 * Everything except the overridden fields counts as "already configured", so each test checks a
 * single rule.
 */
function input(overrides: Partial<Parameters<typeof onboardingSteps>[0]> = {}) {
  return {
    brandColor: "#4f46e5",
    placeholders: [],
    plans: [{ providerProductId: "prod_live_pro", hidden: false }],
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
  test("with all config changed and running on Vercel, only writing a post needs a manual check", () => {
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

  test("brand color still at the factory value is todo, with the original value as evidence", () => {
    const steps = onboardingSteps(input({ brandColor: FACTORY_BRAND_COLOR }));
    expect(statusOf(steps, "brandColor")).toBe("todo");
    expect(steps.find((step) => step.id === "brandColor")?.evidence).toEqual([
      `brand.primaryColor = "${FACTORY_BRAND_COLOR}"`,
    ]);
  });

  test("brand color counts as unchanged only if equal ignoring case and whitespace", () => {
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

  test("placeholders reported by the sentinels mean todo, and each one goes into evidence", () => {
    const steps = onboardingSteps(
      input({
        placeholders: [
          {
            path: "name",
            placeholder: "Acme",
            hint: "Change to your product name",
          },
          {
            path: "email.fromAddress",
            placeholder: "noreply@example.com",
            hint: "Change to your sender address",
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

  test("a placeholder product ID still in the plans means todo", () => {
    const steps = onboardingSteps(
      input({
        plans: [
          { providerProductId: "prod_placeholder_pro", hidden: false },
          { providerProductId: "prod_live_lifetime", hidden: false },
        ],
      }),
    );
    expect(statusOf(steps, "pricing")).toBe("todo");
    expect(steps.find((step) => step.id === "pricing")?.evidence).toEqual([
      'providerProductId = "prod_placeholder_pro"',
    ]);
  });

  test("a placeholder product ID on a hidden plan doesn't count (it can't be bought)", () => {
    const steps = onboardingSteps(
      input({
        plans: [
          { hidden: false },
          { providerProductId: "prod_placeholder_pro", hidden: true },
          { providerProductId: "prod_live_lifetime", hidden: false },
        ],
      }),
    );
    expect(statusOf(steps, "pricing")).toBe("done");
    expect(steps.find((step) => step.id === "pricing")?.evidence).toEqual([]);
  });

  test("no paid plans (no product IDs at all) counts as done", () => {
    expect(
      statusOf(
        onboardingSteps(input({ plans: [{ hidden: false }] })),
        "pricing",
      ),
    ).toBe("done");
  });

  test("off Vercel, the deploy step can only be checked manually", () => {
    expect(
      statusOf(onboardingSteps(input({ onVercel: false })), "deploy"),
    ).toBe("manual");
    expect(statusOf(onboardingSteps(input({ onVercel: true })), "deploy")).toBe(
      "done",
    );
  });

  test("with the blog module off, there is no write-a-post step", () => {
    const steps = onboardingSteps(input({ blogEnabled: false }));
    expect(steps.map((step) => step.id)).not.toContain("blogPost");
    expect(steps).toHaveLength(4);
  });

  test("automatically detected steps never have manual status", () => {
    const steps = onboardingSteps(
      input({ brandColor: FACTORY_BRAND_COLOR, onVercel: false }),
    );
    for (const step of steps) {
      if (step.id === "brandColor") expect(step.status).toBe("todo");
      if (step.id === "deploy") expect(step.status).toBe("manual");
    }
    // Manual steps have no evidence: the UI doesn't show "factory values you haven't changed" for
    // them.
    expect(
      steps
        .filter((step) => step.status === "manual")
        .flatMap((s) => s.evidence),
    ).toEqual([]);
  });
});
