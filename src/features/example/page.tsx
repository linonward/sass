import { randomUUID } from "node:crypto";

import { getTranslations } from "next-intl/server";

import { aiEnabled, aiModels, defaultAiModel } from "@/core/ai";
import { requirePageSession } from "@/core/auth/session";
import { creditsEnabled, getBalance } from "@/core/credits";
import { buildMetadata } from "@/core/seo/metadata";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

import { TaglineTool } from "./tagline-tool";
import { QUICK_COST } from "./taglines";

// 路由文件 src/app/[locale]/(app)/example/page.tsx 只是转发到这里，业务代码都在 src/features/example/。

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Example" });
  return buildMetadata({
    locale,
    path: "/example",
    title: t("title"),
    noIndex: true,
  });
}

export default async function ExamplePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Example" });
  const userId = (await requirePageSession(locale)).user.id;
  const balance = creditsEnabled ? await getBalance(userId) : 0;
  const aiCost = aiEnabled
    ? (aiModels.find((model) => model.id === defaultAiModel)?.creditCost ??
      null)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
          <CardDescription data-testid="example-balance">
            {creditsEnabled ? t("balance", { balance }) : t("creditsDisabled")}
          </CardDescription>
        </CardHeader>
        {creditsEnabled && (
          <CardContent>
            <TaglineTool
              requestId={randomUUID()}
              quickCost={QUICK_COST}
              aiCost={aiCost}
            />
          </CardContent>
        )}
      </Card>
    </div>
  );
}
