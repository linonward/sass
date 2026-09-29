"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/core/ui/badge";

import { FeatureFlag, useFlag } from "./components";

/**
 * Feature flag example on the Dashboard: three flags demonstrate a percentage rollout, adminOnly,
 * and "defined but off". Like the upload example it is living documentation; delete the whole thing
 * when you wire up your own app.
 *
 * Each block carries `data-testid="flag-<name>"`, which e2e uses to assert who can see it.
 */
export function FlagExample() {
  const t = useTranslations("Dashboard.flags");
  // useFlag: use it when you want to control rendering yourself (not just show/hide); <FeatureFlag>
  // is its declarative wrapper.
  const soon = useFlag("beta-soon");

  return (
    <section
      className="panel flex flex-col gap-3 p-6"
      data-testid="flag-example"
    >
      <div className="space-y-1">
        <h2 className="heading-display text-lg">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <div className="flex flex-col gap-2">
        {/* 50% rollout: users in the bucket and admins see the new layout; everyone else sees the fallback (old layout). */}
        <FeatureFlag
          name="beta-dashboard"
          fallback={
            <FlagRow
              testId="flag-beta-dashboard-off"
              text={t("dashboardOff")}
            />
          }
        >
          <FlagRow
            testId="flag-beta-dashboard"
            text={t("dashboardOn")}
            tag={t("beta")}
          />
        </FeatureFlag>
        {/* Admins only: rollout 0 + adminOnly; regular and signed-out users can't see it. */}
        <FeatureFlag name="beta-preview">
          <FlagRow
            testId="flag-beta-preview"
            text={t("preview")}
            tag={t("beta")}
          />
        </FeatureFlag>
        {/* Defined in config but enabled: false — false for everyone, so this shows the "off" copy. */}
        <FlagRow
          testId="flag-beta-soon"
          dataState={soon ? "on" : "off"}
          text={soon ? t("soonOn") : t("soonOff")}
        />
      </div>
    </section>
  );
}

/** One line of explanation. `tag` is a flat brand chip (the product surface has no lip edge). */
function FlagRow({
  testId,
  dataState,
  text,
  tag,
}: {
  testId: string;
  dataState?: "on" | "off";
  text: string;
  tag?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-state={dataState}
      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      {tag && (
        <Badge variant="band" flat>
          {tag}
        </Badge>
      )}
      <span>{text}</span>
    </div>
  );
}
