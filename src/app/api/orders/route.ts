// GET /api/orders?status=&q=&day= — STAFF: order list, newest first.
// (Order creation is now STAFF-only via POST /api/orders/register — the
// standalone customer site creates orders offline and hands over a QR.)
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { errorResponse, unauthorized } from "@/app/api/_lib/http";
import { listOrders, parseDayFilter } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    const day = parseDayFilter(url.searchParams.get("day"));

    const orders = await listOrders({ status, q, day });
    return NextResponse.json({ orders });
  } catch (err) {
    return errorResponse(err, "GET /api/orders");
  }
}
