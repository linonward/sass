"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useId, useState, type ComponentProps } from "react";

import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/skeleton";

// 只取类型：编译后不剩 import，真正的加载在下面 dynamic() 的 import() 里。
import type { ImageStudio } from "./image-studio";
import type { Playground } from "./playground";
import type { VideoStudio } from "./video-studio";

export type PlaygroundTabId = "chat" | "image" | "video";

/** 每个标签的 props 就是它内容组件的 props：从组件自己推导，组件加了 prop 这里跟着走。 */
type TabProps = {
  chat: ComponentProps<typeof Playground>;
  image: ComponentProps<typeof ImageStudio>;
  video: ComponentProps<typeof VideoStudio>;
};

/**
 * 一个标签 = 它的 id + 内容组件的 props。
 *
 * 以前这里是 `content: ReactNode`，元素由服务端页面构造。改成传数据是因为内容要按需加载：
 * `dynamic()` 只能写在客户端模块的顶层 —— 服务端组件里对客户端组件的动态 import 不做代码
 * 分割，`ssr: false` 在服务端组件里更是直接报错
 * （node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md）。
 * 而且能过 RSC 边界的本来就只有可序列化的数据，元素也得在客户端用数据现造。
 */
export type PlaygroundTab = {
  [Id in PlaygroundTabId]: { id: Id } & TabProps[Id];
}[PlaygroundTabId];

/**
 * 内容组件，标签激活时才拉对应的 chunk（没打开过的标签不下载它的 JS）。
 *
 * 三个都传了 `loading`：next/dynamic 只有在非 SSR 或有 loading 时才会自己套一层 Suspense，
 * 切标签时 chunk 还没到，不至于把整个标签栏一起挂起。
 */
const ChatTab = dynamic(
  () => import("./playground").then((mod) => mod.Playground),
  { loading: TabLoading },
);
const ImageTab = dynamic(
  () => import("./image-studio").then((mod) => mod.ImageStudio),
  { loading: TabLoading },
);
const VideoTab = dynamic(
  () => import("./video-studio").then((mod) => mod.VideoStudio),
  { loading: TabLoading },
);

/** chunk 到达前的占位，和列表页的骨架同一套（bg-muted + pulse）。 */
function TabLoading() {
  return <Skeleton className="h-64 w-full" />;
}

/**
 * 按 id 分发。上面的映射类型已经保证「id 和 props 配对」，但 TS 推不出这层关系
 * （展开联合类型时对不上号），所以按 id 分支显式传：新增一个标签忘了传 prop 这里会报错。
 */
function TabContent({ tab }: { tab: PlaygroundTab }) {
  switch (tab.id) {
    case "chat":
      return <ChatTab models={tab.models} defaultModel={tab.defaultModel} />;
    case "image":
      return <ImageTab models={tab.models} defaultModel={tab.defaultModel} />;
    case "video":
      return <VideoTab models={tab.models} defaultModel={tab.defaultModel} />;
  }
}

/**
 * Playground 的标签页。只有一个标签时不显示标签栏。
 * 标签第一次打开时才挂载，之后切走只隐藏（保留对话和表单状态）；没打开过的标签不加载视频等资源。
 */
export function PlaygroundTabs({ tabs }: { tabs: PlaygroundTab[] }) {
  const t = useTranslations("Playground.tabs");
  const [active, setActive] = useState(tabs[0]!.id);
  const [opened, setOpened] = useState(() => new Set([tabs[0]!.id]));
  const baseId = useId();
  if (tabs.length === 1) return <TabContent tab={tabs[0]!} />;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="bg-muted inline-flex w-fit rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-${tab.id}-tab`}
            aria-selected={active === tab.id}
            aria-controls={`${baseId}-${tab.id}`}
            onClick={() => {
              setActive(tab.id);
              setOpened((set) =>
                set.has(tab.id) ? set : new Set(set).add(tab.id),
              );
            }}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              // 激活态靠描边分，不加投影（产品语域没有模糊投影）。
              active === tab.id
                ? "bg-background border-border border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab.id)}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-${tab.id}`}
          aria-labelledby={`${baseId}-${tab.id}-tab`}
          hidden={active !== tab.id}
        >
          {opened.has(tab.id) ? <TabContent tab={tab} /> : null}
        </div>
      ))}
    </div>
  );
}
