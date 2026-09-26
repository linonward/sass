"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/core/lib/utils";

/**
 * Playground 的标签页。只有一个标签时不显示标签栏。
 * 标签第一次打开时才挂载，之后切走只隐藏（保留对话和表单状态）；没打开过的标签不加载视频等资源。
 */
export function PlaygroundTabs({
  tabs,
}: {
  tabs: { id: "chat" | "image" | "video"; content: ReactNode }[];
}) {
  const t = useTranslations("Playground.tabs");
  const [active, setActive] = useState(tabs[0]!.id);
  const [opened, setOpened] = useState(() => new Set([tabs[0]!.id]));
  const baseId = useId();
  if (tabs.length === 1) return <>{tabs[0]!.content}</>;

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
          {opened.has(tab.id) ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
