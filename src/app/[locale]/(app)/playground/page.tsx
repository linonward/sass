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

/** AI 示例页，由 features.ai 控制。业务可以照着它写自己的 AI 功能页，或直接删掉。 */
export default async function PlaygroundPage({
  params,
}: PageProps<"/[locale]/playground">) {
  if (!aiEnabled) notFound();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Playground" });
  const userId = (await requirePageSession(locale)).user.id;
  // 图片页和视频页共用的生成记录：这里查一次，交给 GenerationsProvider。
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
        {/* 只传数据：内容组件在 PlaygroundTabs（客户端）里按需 import。 */}
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
