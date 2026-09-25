"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/core/lib/utils";

/** Playground 的标签页。只有一个标签时不显示标签栏。 */
export function PlaygroundTabs({
  tabs,
}: {
  tabs: { id: "chat" | "image" | "video"; content: ReactNode }[];
}) {
  const t = useTranslations("Playground.tabs");
  const [active, setActive] = useState(tabs[0]!.id);
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
            onClick={() => setActive(tab.id)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              active === tab.id
                ? "bg-background shadow-sm"
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
          {tab.content}
        </div>
      ))}
    </div>
  );
}
