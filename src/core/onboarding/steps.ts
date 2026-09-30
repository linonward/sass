import type { Plan } from "@/core/config/schema";
import type { PlaceholderIssue } from "@/core/config/sentinels";

/**
 * Factory brand color, identical to the initial brand.primaryColor in site.config.ts. Changing it
 * counts as having done this step.
 */
export const FACTORY_BRAND_COLOR = "#0f766e";

/**
 * The template's placeholder product IDs — the same convention as the checkout guard in
 * src/core/billing/checkout.ts.
 */
const PLACEHOLDER_PRODUCT = /^prod_placeholder/;

export type OnboardingStepId =
  "brandColor" | "siteName" | "pricing" | "blogPost" | "deploy";

/**
 * - `done`: confirmed as done from config or the environment;
 * - `todo`: confirmed as not done yet (`evidence` holds the unchanged factory values verbatim);
 * - `manual`: no reliable signal, so the UI offers a manual checkbox.
 *
 * Manual checks live only in the current page: the only persisted state is "whole checklist done"
 * (one boolean on the user record); spending a column on each step isn't worth it.
 */
export type OnboardingStepStatus = "done" | "todo" | "manual";

export type OnboardingStep = {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
  /** Clue for `todo`: the unchanged factory value verbatim, e.g. `name = "Acme"`. */
  evidence: readonly string[];
};

export type OnboardingInput = {
  /** siteConfig.brand.primaryColor. */
  brandColor: string;
  /** Factory placeholders still unchanged in siteConfig (src/core/config/sentinels). */
  placeholders: readonly PlaceholderIssue[];
  /**
   * siteConfig.billing.plans. Hidden plans are skipped: they can't be bought, so a placeholder
   * product ID left on one (e.g. `SITE_HIDDEN_PLANS=pro`) is not an unfinished step.
   */
  plans: readonly Pick<Plan, "providerProductId" | "hidden">[];
  /** features.blog: when off, the "write your first post" step doesn't appear. */
  blogEnabled: boolean;
  /** Whether we're running on Vercel: lets the deploy step be detected automatically. */
  onVercel: boolean;
};

/**
 * First-run checklist. Every step's status depends only on the inputs — a pure function, easy to
 * unit test.
 *
 * The two steps that can't be detected get `manual` instead of a guess:
 * - writing a post: the repo already ships demo posts (content/blog/), so there's no telling which
 *   one the buyer wrote;
 * - deploying: local development can't see Vercel, so only the buyer can check it off.
 */
export function onboardingSteps(input: OnboardingInput): OnboardingStep[] {
  const brandColorDone =
    input.brandColor.trim().toLowerCase() !== FACTORY_BRAND_COLOR;
  const placeholderPlans = input.plans.flatMap((plan) =>
    !plan.hidden &&
    plan.providerProductId &&
    PLACEHOLDER_PRODUCT.test(plan.providerProductId)
      ? [plan.providerProductId]
      : [],
  );

  return [
    {
      id: "brandColor",
      status: brandColorDone ? "done" : "todo",
      evidence: brandColorDone
        ? []
        : [`brand.primaryColor = "${input.brandColor}"`],
    },
    {
      id: "siteName",
      status: input.placeholders.length > 0 ? "todo" : "done",
      evidence: input.placeholders.map(
        (issue) => `${issue.path} = "${issue.placeholder}"`,
      ),
    },
    {
      id: "pricing",
      status: placeholderPlans.length > 0 ? "todo" : "done",
      evidence: placeholderPlans.map((id) => `providerProductId = "${id}"`),
    },
    ...(input.blogEnabled
      ? [
          {
            id: "blogPost",
            status: "manual",
            evidence: [],
          } satisfies OnboardingStep,
        ]
      : []),
    {
      id: "deploy",
      status: input.onVercel ? "done" : "manual",
      evidence: [],
    },
  ];
}
