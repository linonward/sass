import { Link, Text } from "react-email";

import en from "../../../../messages/en.json";
import { emailBrand as brand } from "../brand";
import { DetailRows } from "../components/detail-rows";
import { EmailButton } from "../components/email-button";
import { EmailLayout, emailStyles } from "../components/email-layout";
import { emailTranslator, type EmailT } from "../translator";

export type StatusIncidentProps = {
  /** Component display name (its label in `site.config.ts`). */
  component: string;
  /**
   * Impact level. Resolution notices keep the level from when the incident happened, so this is
   * never "resolved".
   */
  status: "operational" | "degraded" | "outage";
  message: string;
  /** When it was resolved (ISO); null while still ongoing. */
  resolvedAt: string | null;
  /** Status page URL. */
  url: string;
  /** Signed unsubscribe URL. */
  withdrawUrl: string;
};

type Props = StatusIncidentProps & { t: EmailT; locale: string };

export function statusIncidentSubject(t: EmailT, props: StatusIncidentProps) {
  return props.resolvedAt
    ? t("statusIncident.subjectResolved", { component: props.component })
    : t("statusIncident.subject", { component: props.component });
}

/** Incident notice, sent to subscribers when a component has a problem, an update, or recovers. */
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
