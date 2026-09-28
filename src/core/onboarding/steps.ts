import type { PlaceholderIssue } from "@/core/config/sentinels";

/** 出厂品牌色，和 site.config.ts 里 brand.primaryColor 的初值一致。改了就算做过这一步。 */
export const FACTORY_BRAND_COLOR = "#0f766e";

/** 模板里的占位产品 ID，和 src/core/billing/checkout.ts 的结账守卫是同一个约定。 */
const PLACEHOLDER_PRODUCT = /^prod_placeholder/;

export type OnboardingStepId =
  "brandColor" | "siteName" | "pricing" | "blogPost" | "deploy";

/**
 * - `done`：从配置或环境就能确认已经做过；
 * - `todo`：确认还没做（`evidence` 里是还没改的出厂值原文）；
 * - `manual`：没有可靠的信号，界面上给一个手动勾选。
 *
 * 手动勾选只活在当前页面里：持久化的只有「整份清单完成」（用户记录上的一个布尔值），
 * 多花一列去记每一步不值当。
 */
export type OnboardingStepStatus = "done" | "todo" | "manual";

export type OnboardingStep = {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
  /** `todo` 时的线索：还没改的出厂值原文，例如 `name = "Acme"`。 */
  evidence: readonly string[];
};

export type OnboardingInput = {
  /** siteConfig.brand.primaryColor。 */
  brandColor: string;
  /** siteConfig 里还没改的出厂占位值（src/core/config/sentinels）。 */
  placeholders: readonly PlaceholderIssue[];
  /** siteConfig.billing.plans 里配了的服务商产品 ID。 */
  planProductIds: readonly string[];
  /** features.blog：关掉时「写第一篇文章」这一步不出现。 */
  blogEnabled: boolean;
  /** 是否跑在 Vercel 上：部署这一步能自动判定。 */
  onVercel: boolean;
};

/**
 * 首次运行清单。每一步的判定都只依赖入参，纯函数，方便单测。
 *
 * 判定不了的两步给 `manual`，而不是猜一个：
 * - 写文章：仓库里本来就带着演示文章（content/blog/），分不出哪篇是买家写的；
 * - 部署：本地开发时看不见 Vercel，只能靠买家自己勾。
 */
export function onboardingSteps(input: OnboardingInput): OnboardingStep[] {
  const brandColorDone =
    input.brandColor.trim().toLowerCase() !== FACTORY_BRAND_COLOR;
  const placeholderPlans = input.planProductIds.filter((id) =>
    PLACEHOLDER_PRODUCT.test(id),
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
