import { useTranslations } from "next-intl";

import { Badge } from "@/core/ui/badge";

import { isAdmin } from "../roles";

// Generic list pieces (search, status filter, pagination, empty rows) live in
// `@/core/ui/list` so product pages can use them; only admin-specific badges stay here.

export function RoleBadge({ role }: { role: string | null }) {
  const t = useTranslations("Admin.roles");
  return isAdmin({ role }) ? (
    // A flat brand chip, not the default solid brand block: a saturated block on
    // every table row would compete with the page's one solid primary action.
    <Badge variant="band" flat>
      {t("admin")}
    </Badge>
  ) : (
    <Badge variant="outline">{t("user")}</Badge>
  );
}

/**
 * Status colour only marks exceptions: the normal state (active) is a neutral
 * fill, and only states worth a second look get a semantic colour. Green on
 * every row marks nothing.
 */
export function UserStatusBadge({ banned }: { banned: boolean | null }) {
  const t = useTranslations("Admin.status");
  return banned ? (
    <Badge variant="destructive-band" flat>
      {t("banned")}
    </Badge>
  ) : (
    <Badge variant="secondary">{t("active")}</Badge>
  );
}
