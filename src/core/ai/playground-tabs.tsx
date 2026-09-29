"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useId, useState, type ComponentProps } from "react";

import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/skeleton";

// Types only: no import survives compilation; the real loading happens in the import() inside
// dynamic() below.
import type { ImageStudio } from "./image-studio";
import type { Playground } from "./playground";
import type { VideoStudio } from "./video-studio";

export type PlaygroundTabId = "chat" | "image" | "video";

/**
 * Each tab's props are its content component's props: derived from the component itself, so a new
 * prop on the component flows through here.
 */
type TabProps = {
  chat: ComponentProps<typeof Playground>;
  image: ComponentProps<typeof ImageStudio>;
  video: ComponentProps<typeof VideoStudio>;
};

/**
 * A tab = its id + its content component's props.
 *
 * This used to be `content: ReactNode`, with the element built by the server page. It passes data
 * now because content has to load on demand: `dynamic()` can only live at the top level of a
 * client module — a dynamic import of a client component inside a server component is not
 * code-split, and `ssr: false` in a server component throws outright
 * (node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md).
 * Besides, only serializable data can cross the RSC boundary anyway, so the element has to be built
 * from data on the client.
 */
export type PlaygroundTab = {
  [Id in PlaygroundTabId]: { id: Id } & TabProps[Id];
}[PlaygroundTabId];

/**
 * Content components; a tab's chunk is fetched only when the tab is activated (tabs never opened
 * don't download their JS).
 *
 * All three pass `loading`: next/dynamic only wraps itself in a Suspense boundary when not SSR or
 * when loading is set, so a chunk that hasn't arrived yet on tab switch doesn't suspend the whole
 * tab bar with it.
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

/**
 * Placeholder until the chunk arrives, using the same skeleton as the list pages (bg-muted +
 * pulse).
 */
function TabLoading() {
  return <Skeleton className="h-64 w-full" />;
}

/**
 * Dispatches by id. The mapped type above already guarantees that id and props pair up, but TS
 * can't infer that relationship (it loses the pairing when expanding the union), so each id branch
 * passes props explicitly: a new tab that forgets a prop fails to compile here.
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
 * Playground tabs. The tab bar is hidden when there is only one tab.
 * A tab mounts the first time it's opened and is only hidden when switched away (keeping chat and
 * form state); tabs never opened don't load video or other resources.
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
              // The active state is marked by a border, not a shadow (the product surface has no
              // blurred shadows).
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
