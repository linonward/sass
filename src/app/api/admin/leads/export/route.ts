import { NextResponse } from "next/server";

import { getAdminSession } from "@/core/admin/session";
import { getLeadExportData, parseLeadStatus } from "@/core/admin/leads-queries";
import { getDb } from "@/core/db";
import { logger } from "@/core/observability/logger";

const MAX_EXPORT_ROWS = 10_000;

/**
 * 把一行数据转成 CSV 的一个字段，安全处理：
 * - 包含逗号、引号或换行的字段用双引号包裹
 * - 首字符是 = + - @ 时前面加单引号防公式注入
 * - null / undefined → 空
 */
function csvField(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  // 防公式注入：前导字符前加单引号
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(",");
}

export async function GET(request: Request) {
  if (process.env.ACQUISITION_LEADS !== "true") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const session = await getAdminSession();
  if (!session) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = parseLeadStatus(searchParams.get("status"));
  const email = searchParams.get("email") ?? undefined;

  const db = getDb();
  const { rows, total, truncated } = await getLeadExportData(db, {
    status,
    email: email ?? undefined,
  });

  if (truncated) {
    logger.warn("admin.leads_export_truncated", {
      operator: session.user.id,
      status: status ?? "all",
      hasEmailFilter: !!email,
      total,
      limit: MAX_EXPORT_ROWS,
    });
    return new NextResponse(
      JSON.stringify({
        error: "too_many_rows",
        message: `Export limit is ${MAX_EXPORT_ROWS} rows. Narrow your filters to reduce the result set.`,
        total,
      }),
      {
        status: 422,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  logger.info("admin.leads_export", {
    operator: session.user.id,
    status: status ?? "all",
    hasEmailFilter: !!email,
    count: rows.length,
  });

  const headers = [
    "Email",
    "Status",
    "List",
    "Source",
    "Source Details",
    "Created",
    "Confirmed",
    "Registered User",
  ];

  const body = [
    headers,
    ...rows.map((r) => [
      r.email,
      r.status,
      r.listId,
      r.source,
      r.sourceDetails,
      r.createdAt,
      r.confirmedAt,
      r.userEmail,
    ]),
  ]
    .map(csvRow)
    .join("\n");

  const filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
