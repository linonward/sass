import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  aiEnabled,
  aiImageEnabled,
  aiImageModels,
  aiModels,
  aiVideoEnabled,
  aiVideoModels,
  defaultAiImageModel,
  defaultAiModel,
  defaultAiVideoModel,
  listGenerations,
  listPendingVideos,
} from "@/core/ai";
import { GenerationsProvider } from "@/core/ai/generations-context";
import { PlaygroundTabs } from "@/core/ai/playground-tabs";
import { requirePageSession } from "@/core/auth/session";
import { buildMetadata } from "@/core/seo/metadata";
import { PageHeader } from "@/core/ui/page-header";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/playground">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Playground" });
  return buildMetadata({
    locale,
    path: "/playground",
    title: t("metaTitle"),
    noIndex: true,
  });
}

/** AI example page, gated by features.ai. Model your own AI pages on it, or just delete it. */
export default async function PlaygroundPage({
  params,
}: PageProps<"/[locale]/playground">) {
  if (!aiEnabled) notFound();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Playground" });
  const userId = (await requirePageSession(locale)).user.id;
  // Generation history shared by the image and video tabs: query it once here and hand it to
  // GenerationsProvider.
  const mediaEnabled = aiImageEnabled || aiVideoEnabled;
  const [generations, pendingVideos] = mediaEnabled
    ? await Promise.all([listGenerations(userId), listPendingVideos(userId)])
    : [[], []];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <GenerationsProvider
        initialGenerations={generations}
        initialPendingVideos={pendingVideos}
      >
        {/* Pass data only: the content components are imported on demand inside PlaygroundTabs (client). */}
        <PlaygroundTabs
          tabs={[
            ...(aiModels.length > 0
              ? [
                  {
                    id: "chat" as const,
                    models: aiModels,
                    defaultModel: defaultAiModel!,
                  },
                ]
              : []),
            ...(aiImageEnabled
              ? [
                  {
                    id: "image" as const,
                    models: aiImageModels,
                    defaultModel: defaultAiImageModel!,
                  },
                ]
              : []),
            ...(aiVideoEnabled
              ? [
                  {
                    id: "video" as const,
                    models: aiVideoModels,
                    defaultModel: defaultAiVideoModel!,
                  },
                ]
              : []),
          ]}
        />
      </GenerationsProvider>
    </div>
  );
}
