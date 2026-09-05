// POST /api/orders/[id]/serve — STAFF: WAITING → SERVED (PAID, completedAt,
// sold counter: sold += qty per product)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { errorResponse, fail, normalizeOrderId, unauthorized } from "@/app/api/_lib/http";
import { findOrderRow, serializeOrder } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const { id } = await params;
    const orderId = normalizeOrderId(id);
    const order = await findOrderRow(orderId);
    if (!order) fail(404, "Order not found");

    if (order.orderStatus === "SERVED") {
      fail(409, "Order has already been served", "ALREADY_SERVED", serializeOrder(order));
    }
    if (order.orderStatus === "ABORTED") {
      fail(409, "Order was already aborted", "ALREADY_ABORTED", serializeOrder(order));
    }
    if (order.orderStatus === "PENDING") {
      fail(409, "Order has not been scanned yet", "NOT_WAITING", serializeOrder(order));
    }

    const updated = await db.$transaction(async (tx) => {
      const served = await tx.order.update({
        where: { orderId },
        data: {
          orderStatus: "SERVED",
          paymentStatus: "PAID",
          completedAt: new Date(),
        },
        include: { items: true },
      });

      for (const item of served.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) continue; // deleted product — order keeps its snapshot
        await tx.product.update({
          where: { id: product.id },
          data: {
            sold: product.sold + item.quantity,
          },
        });
      }
      return served;
    });

    return NextResponse.json({ order: serializeOrder(updated) });
  } catch (err) {
    return errorResponse(err, "POST /api/orders/[id]/serve");
  }
}
