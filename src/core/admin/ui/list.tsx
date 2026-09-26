import { ChevronLeft, ChevronRight, InboxIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { EmptyState } from "@/core/ui/empty-state";

import { isAdmin } from "../roles";

// PageHeader 搬去了 core/ui/page-header —— 产品面（dashboard/settings/billing）也要用，
// 而从 core/admin 里 import 一个页头是反向依赖。这里不再 re-export：
// 两条 import 路径只会制造漂移。

type Query = Record<string, string | undefined>;

/** 只保留有值的查询参数，第 1 页不写 page。 */
function cleanQuery(query: Query) {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([key, value]) => value && !(key === "page" && value === "1"),
    ),
  ) as Record<string, string>;
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
    <nav aria-label={t("label")} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === current;
        return (
          <Link
            key={option.value ?? "all"}
            href={{ pathname, query: cleanQuery({ status: option.value }) }}
            aria-current={active ? "page" : undefined}
            className={cn(
              // 激活态是中性填充，不是实心品牌色：实心留给每一屏唯一的主操作。
              // 未激活用 ghost（透明底 + 弱文字）而不是 outline —— 暗色下
              // outline 的 `dark:bg-input/30`(≈0.22) 和 secondary(0.28) 差太近，
              // 选中态会看不出来。
              buttonVariants({
                variant: active ? "secondary" : "ghost",
                size: "sm",
              }),
              !active && "text-muted-foreground",
            )}
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
    // 平铺的品牌芯片，不是默认的实心品牌块：表格里每行一个饱和色块会跟页面
    // 唯一那个实心主操作抢注意力。
    <Badge variant="band" flat>
      {t("admin")}
    </Badge>
  ) : (
    <Badge variant="outline">{t("user")}</Badge>
  );
}

/**
 * 状态色只标异常：正常态（active）用中性填充，需要看一眼的才上语义色。
 * 每行都绿一遍等于没标。
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

/** 空列表时占满一行的提示。纵向留白交给 EmptyState，td 自己不补。 */
export function EmptyRow({
  colSpan,
  text,
  icon,
}: {
  colSpan: number;
  text: string;
  icon?: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState size="sm" icon={icon ?? <InboxIcon />} title={text} />
      </td>
    </tr>
  );
}
