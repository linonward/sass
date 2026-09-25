import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";

import { isAdmin } from "../roles";

type Query = Record<string, string | undefined>;

/** 只保留有值的查询参数，第 1 页不写 page。 */
function cleanQuery(query: Query) {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([key, value]) => value && !(key === "page" && value === "1"),
    ),
  ) as Record<string, string>;
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** 状态筛选：一排链接，服务端按 ?status= 过滤。 */
export function StatusFilter<T extends string>({
  pathname,
  statuses,
  current,
  label,
}: {
  pathname: string;
  statuses: readonly T[];
  current: T | undefined;
  label: (status: T) => string;
}) {
  const t = useTranslations("Admin.filter");
  const options: { value: T | undefined; label: string }[] = [
    { value: undefined, label: t("all") },
    ...statuses.map((status) => ({ value: status, label: label(status) })),
  ];

  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = option.value === current;
        return (
          <Link
            key={option.value ?? "all"}
            href={{ pathname, query: cleanQuery({ status: option.value }) }}
            aria-current={active ? "page" : undefined}
            className={buttonVariants({
              variant: active ? "default" : "outline",
              size: "sm",
            })}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 上一页 / 下一页，保留其他查询参数。 */
export function Pagination({
  pathname,
  query,
  page,
  totalPages,
  total,
}: {
  pathname: string;
  query: Query;
  page: number;
  totalPages: number;
  total: number;
}) {
  const t = useTranslations("Admin.pagination");
  const link = (target: number) => ({
    pathname,
    query: cleanQuery({ ...query, page: String(target) }),
  });
  const disabled = "pointer-events-none opacity-50";

  return (
    <nav
      aria-label={t("label")}
      className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span>{t("summary", { page, totalPages, total })}</span>
      <div className="flex gap-2">
        <Link
          href={link(page - 1)}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            page <= 1 && disabled,
          )}
        >
          <ChevronLeft />
          {t("previous")}
        </Link>
        <Link
          href={link(page + 1)}
          aria-disabled={page >= totalPages}
          tabIndex={page >= totalPages ? -1 : undefined}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            page >= totalPages && disabled,
          )}
        >
          {t("next")}
          <ChevronRight />
        </Link>
      </div>
    </nav>
  );
}

export function RoleBadge({ role }: { role: string | null }) {
  const t = useTranslations("Admin.roles");
  return isAdmin({ role }) ? (
    <Badge>{t("admin")}</Badge>
  ) : (
    <Badge variant="outline">{t("user")}</Badge>
  );
}

export function UserStatusBadge({ banned }: { banned: boolean | null }) {
  const t = useTranslations("Admin.status");
  return banned ? (
    <Badge variant="destructive">{t("banned")}</Badge>
  ) : (
    <Badge variant="secondary">{t("active")}</Badge>
  );
}

/** 空列表时占满一行的提示。 */
export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="text-muted-foreground py-10 text-center text-sm"
      >
        {text}
      </td>
    </tr>
  );
}
