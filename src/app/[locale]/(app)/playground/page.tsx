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
} from "@/core/ai";
import { ImageStudio } from "@/core/ai/image-studio";
import { Playground } from "@/core/ai/playground";
import { PlaygroundTabs } from "@/core/ai/playground-tabs";
import { VideoStudio } from "@/core/ai/video-studio";
import { buildMetadata } from "@/core/seo/metadata";

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

/** AI 示例页，由 features.ai 控制。业务可以照着它写自己的 AI 功能页，或直接删掉。 */
export default async function PlaygroundPage({
  params,
}: PageProps<"/[locale]/playground">) {
  if (!aiEnabled) notFound();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Playground" });

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <PlaygroundTabs
        tabs={[
          ...(aiModels.length > 0
            ? [
                {
                  id: "chat" as const,
                  content: (
                    <Playground
                      models={aiModels}
                      defaultModel={defaultAiModel!}
                    />
                  ),
                },
              ]
            : []),
          ...(aiImageEnabled
            ? [
                {
                  id: "image" as const,
                  content: (
                    <ImageStudio
                      models={aiImageModels}
                      defaultModel={defaultAiImageModel!}
                    />
                  ),
                },
              ]
            : []),
          ...(aiVideoEnabled
            ? [
                {
                  id: "video" as const,
                  content: (
                    <VideoStudio
                      models={aiVideoModels}
                      defaultModel={defaultAiVideoModel!}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
