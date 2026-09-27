"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/core/ui/badge";

import { FeatureFlag, useFlag } from "./components";

/**
 * Dashboard 上的 feature flag 示例：三个 flag 分别演示百分比灰度、adminOnly 和「定义在但关着」。
 * 和 upload 示例一样是活文档，接自己的业务时整段删掉。
 *
 * 每块都带 `data-testid="flag-<名字>"`，e2e 用它断言「谁看得见」。
 */
export function FlagExample() {
  const t = useTranslations("Dashboard.flags");
  // useFlag：想要自己控制渲染（不只是显示/隐藏）时用它；<FeatureFlag> 是它的声明式封装。
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
        {/* 灰度 50%：在桶里的人和 admin 看到新布局，其他人看到 fallback（老布局）。 */}
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
        {/* 只给 admin：rollout 0 + adminOnly，普通用户和未登录用户都看不到。 */}
        <FeatureFlag name="beta-preview">
          <FlagRow
            testId="flag-beta-preview"
            text={t("preview")}
            tag={t("beta")}
          />
        </FeatureFlag>
        {/* 定义在配置里但 enabled: false —— 对所有人都是 false，这里走的是「没开」的文案。 */}
        <FlagRow
          testId="flag-beta-soon"
          dataState={soon ? "on" : "off"}
          text={soon ? t("soonOn") : t("soonOff")}
        />
      </div>
    </section>
  );
}

/** 一行说明。`tag` 是平铺的品牌芯片（产品面不贴唇边）。 */
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
