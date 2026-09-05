// GET /api/dashboard?day= — STAFF: aggregate DashboardStats
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { errorResponse, unauthorized } from "@/app/api/_lib/http";
import { computeDashboard, parseDayFilter } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const day = parseDayFilter(new URL(req.url).searchParams.get("day"));
    const stats = await computeDashboard(day);
    return NextResponse.json(stats);
  } catch (err) {
    return errorResponse(err, "GET /api/dashboard");
  }
}
