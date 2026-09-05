// POST /api/orders/[id]/abort — STAFF: PENDING|WAITING → ABORTED (reason stored)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { errorResponse, fail, normalizeOrderId, readJson, unauthorized } from "@/app/api/_lib/http";
import { findOrderRow, serializeOrder } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

const MAX_REASON_LENGTH = 120;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const { id } = await params;
    const orderId = normalizeOrderId(id);
    const order = await findOrderRow(orderId);
    if (!order) fail(404, "Order not found");

    // reason: optional, trimmed, max 120 chars
    let abortReason: string | null = null;
    const body = await readJson(req);
    if (body && body.reason !== null && body.reason !== undefined) {
      if (typeof body.reason !== "string") fail(400, "reason must be a string");
      abortReason = body.reason.trim().slice(0, MAX_REASON_LENGTH) || null;
    }

    if (order.orderStatus === "SERVED") {
      fail(409, "A served order cannot be aborted", "CANNOT_ABORT_SERVED", serializeOrder(order));
    }
    if (order.orderStatus === "ABORTED") {
      fail(409, "Order was already aborted", "ALREADY_ABORTED", serializeOrder(order));
    }

    const updated = await db.order.update({
      where: { orderId },
      data: { orderStatus: "ABORTED", abortReason },
      include: { items: true },
    });

    return NextResponse.json({ order: serializeOrder(updated) });
  } catch (err) {
    return errorResponse(err, "POST /api/orders/[id]/abort");
  }
}
