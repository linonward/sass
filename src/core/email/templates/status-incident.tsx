import { Link, Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { DetailRows } from "../components/detail-rows";
import { EmailButton } from "../components/email-button";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { emailTranslator, type EmailT } from "../translator";

export type StatusIncidentProps = {
  /** 组件的展示名（`site.config.ts` 里的 label）。 */
  component: string;
  /** 影响级别。恢复通知保留事发时的级别，所以这里不是「已恢复」。 */
  status: "operational" | "degraded" | "outage";
  message: string;
  /** 已恢复的时间（ISO）；仍在进行中为 null。 */
  resolvedAt: string | null;
  /** 状态页地址。 */
  url: string;
  /** 带签名的退订地址。 */
  withdrawUrl: string;
};

type Props = StatusIncidentProps & { t: EmailT; locale: string };

export function statusIncidentSubject(t: EmailT, props: StatusIncidentProps) {
  return props.resolvedAt
    ? t("statusIncident.subjectResolved", { component: props.component })
    : t("statusIncident.subject", { component: props.component });
}

/** 事件通知：一个组件出问题、更新或恢复时发给订阅者。 */
export default function StatusIncidentEmail({
  t,
  locale,
  component,
  status,
  message,
  resolvedAt,
  url,
  withdrawUrl,
}: Props) {
  const resolved = Boolean(resolvedAt);
  return (
    <EmailLayout
      t={t}
      locale={locale}
      preview={t(
        resolved ? "statusIncident.previewResolved" : "statusIncident.preview",
        { component },
      )}
    >
      <Text style={emailStyles.heading}>
        {t(
          resolved
            ? "statusIncident.headingResolved"
            : "statusIncident.heading",
          { component },
        )}
      </Text>
      <DetailRows
        rows={[
          [t("statusIncident.component"), component],
          [t("statusIncident.status"), t(`statusIncident.level.${status}`)],
        ]}
      />
      <Text style={emailStyles.text}>{message}</Text>
      <EmailButton href={url}>{t("statusIncident.cta")}</EmailButton>
      <Text style={emailStyles.muted}>
        {t("statusIncident.unsubscribe")}{" "}
        <Link href={withdrawUrl} style={{ color: brand.muted }}>
          {t("statusIncident.unsubscribeLink")}
        </Link>
      </Text>
    </EmailLayout>
  );
}

StatusIncidentEmail.PreviewProps = {
  t: emailTranslator("en", en),
  locale: "en",
  component: "API",
  status: "degraded",
  message: "Elevated error rates on the REST API.",
  resolvedAt: null,
  url: `${brand.siteUrl}/status`,
  withdrawUrl: `${brand.siteUrl}/status/unsubscribe`,
} satisfies Props;
