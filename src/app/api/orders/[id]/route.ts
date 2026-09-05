// GET /api/orders/[id] — STAFF: lookup of a REGISTERED order (internal).
// The customer site no longer creates orders here, so a 404 means the
// order has not been registered at the booth yet.
// PATCH /api/orders/[id] — ADMIN: edit order data (customer names, email,
//   payment method / status). Status itself is owned by /serve and /abort.
// DELETE /api/orders/[id] — ADMIN: permanently remove an order record.
//   A SERVED order's quantities are subtracted from the product sold
//   counters so reports stay accurate.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import type { Prisma } from "@prisma/client";
import { errorResponse, fail, normalizeOrderId, readJson, unauthorized } from "@/app/api/_lib/http";
import { findOrderRow, serializeOrder } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const VALID_PAYMENT_METHODS = ["GCASH", "BOOTH"] as const;
const VALID_PAYMENT_STATUSES = ["UNPAID", "PAID"] as const;

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const { id } = await params;
    const orderId = normalizeOrderId(id);
    const row = await findOrderRow(orderId);
    if (!row) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json({ order: serializeOrder(row) });
  } catch (err) {
    return errorResponse(err, "GET /api/orders/[id]");
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const { id } = await params;
    const orderId = normalizeOrderId(id);
    const order = await findOrderRow(orderId);
    if (!order) fail(404, "Order not found");

    const body = await readJson(req);
    if (!body) fail(400, "Invalid JSON body");

    const data: Prisma.OrderUpdateInput = {};

    if ("customerName" in body) {
      if (typeof body.customerName !== "string") fail(400, "customerName must be a string");
      data.customerName = body.customerName.trim().slice(0, 80);
    }
    if ("customerAlias" in body) {
      if (typeof body.customerAlias !== "string") fail(400, "customerAlias must be a string");
      data.customerAlias = body.customerAlias.trim().slice(0, 80);
    }
    if ("customerEmail" in body) {
      if (typeof body.customerEmail !== "string") fail(400, "customerEmail must be a string");
      data.customerEmail = body.customerEmail.trim().slice(0, 120);
    }
    if ("paymentMethod" in body) {
      if (typeof body.paymentMethod !== "string" || !VALID_PAYMENT_METHODS.includes(body.paymentMethod as (typeof VALID_PAYMENT_METHODS)[number])) {
        fail(400, "paymentMethod must be GCASH or BOOTH");
      }
      data.paymentMethod = body.paymentMethod;
    }
    if ("paymentStatus" in body) {
      if (typeof body.paymentStatus !== "string" || !VALID_PAYMENT_STATUSES.includes(body.paymentStatus as (typeof VALID_PAYMENT_STATUSES)[number])) {
        fail(400, "paymentStatus must be UNPAID or PAID");
      }
      data.paymentStatus = body.paymentStatus;
    }

    if (Object.keys(data).length === 0) {
      fail(400, "Nothing to update — provide customerName, customerAlias, customerEmail, paymentMethod or paymentStatus");
    }

    const updated = await db.order.update({
      where: { orderId },
      data,
      include: { items: true },
    });
    return NextResponse.json({ order: serializeOrder(updated) });
  } catch (err) {
    return errorResponse(err, "PATCH /api/orders/[id]");
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const { id } = await params;
    const orderId = normalizeOrderId(id);
    const order = await findOrderRow(orderId);
    if (!order) fail(404, "Order not found");

    // A SERVED order fed the product sold counters when it was served —
    // subtract its quantities again so deletion doesn't inflate reports.
    // (Revenue/number stats are derived from the Order rows themselves,
    // so removing the row already removes its contribution there.)
    await db.$transaction(async (tx) => {
      if (order.orderStatus === "SERVED") {
        for (const item of order.items) {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product) continue; // deleted product — order keeps its snapshot
          await tx.product.update({
            where: { id: product.id },
            data: { sold: Math.max(0, product.sold - item.quantity) },
          });
        }
      }
      // OrderItem rows cascade-delete with the order.
      await tx.order.delete({ where: { orderId } });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "DELETE /api/orders/[id]");
  }
}
