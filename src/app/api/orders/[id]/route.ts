// GET /api/orders/[id] — STAFF: lookup of a REGISTERED order (internal).
// The customer site no longer creates orders here, so a 404 means the
// order has not been registered at the booth yet.
// PATCH /api/orders/[id] — ADMIN: edit order data (customer names, email,
//   payment method / status, and per-line size + custom answers via `items`).
//   Changing a size re-prices that line at the CURRENT menu price and
//   re-totals the order. Status itself is owned by /serve and /abort.
// DELETE /api/orders/[id] — ADMIN: permanently remove an order record.
//   A SERVED order's quantities are subtracted from the product sold
//   counters so reports stay accurate.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import type { Prisma } from "@prisma/client";
import { errorResponse, fail, normalizeOrderId, readJson, unauthorized } from "@/app/api/_lib/http";
import { findOrderRow, parseOrderAnswers, parseProductFields, parseProductSizes, serializeOrder } from "@/app/api/_lib/service";

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

    if (Object.keys(data).length === 0 && !("items" in body)) {
      fail(400, "Nothing to update — provide customerName, customerAlias, customerEmail, paymentMethod, paymentStatus or items");
    }

    // Per-line size + custom answers. Normalization mirrors the register
    // pipeline (canonicalize, fall back, never block a save): sizes resolve
    // against the CURRENT menu, answers against the CURRENT field defs.
    // A changed size re-prices its line and re-totals the whole order.
    if ("items" in body) {
      if (!Array.isArray(body.items)) fail(400, "items must be an array");
      if (body.items.length === 0) fail(400, "items must not be empty");
      const byId = new Map(order.items.map((it) => [it.id, it]));
      const updates = new Map<string, { size: string | null; answers: string; price: number; subtotal: number }>();
      for (const entry of body.items as unknown[]) {
        if (!entry || typeof entry !== "object") fail(400, "items entries must be objects");
        const rec = entry as Record<string, unknown>;
        if (typeof rec.id !== "string" || !byId.has(rec.id)) {
          fail(400, "items entries need the id of a line in this order");
        }
        const line = byId.get(rec.id as string)!;
        const product = await db.product.findUnique({ where: { id: line.productId } });

        // Size — null unless the product currently offers it.
        let size: string | null = null;
        let unit = line.price;
        if (product && product.hasSizes) {
          if (rec.size !== undefined && rec.size !== null) {
            if (typeof rec.size !== "string") fail(400, "item size must be a string");
            const want = rec.size.trim();
            if (want !== "") {
              const match = parseProductSizes(product.sizes).find(
                (s) => s.name.toLowerCase() === want.toLowerCase()
              );
              if (!match) fail(400, `Size "${want}" is not on the menu for ${product.name}`);
              size = match.name;
              unit = match.price;
            } else {
              unit = product.price;
            }
          } else {
            unit = product.price;
          }
        } else if (product) {
          unit = product.price;
        }
        // Answers — validated shapes, canonicalized against current defs,
        // dropped when the product asks nothing (same as registration).
        let answers: { label: string; value: string }[] = [];
        if (product && product.hasFields) {
          if (rec.answers !== undefined && rec.answers !== null) {
            if (!Array.isArray(rec.answers)) fail(400, "item answers must be an array");
            const defs = parseProductFields(product.fields);
            const byLabel = new Map(defs.map((d) => [d.label.toLowerCase(), d.label]));
            for (const a of rec.answers as unknown[]) {
              if (!a || typeof a !== "object") fail(400, "item answers entries must be objects");
              const ar = a as Record<string, unknown>;
              if (typeof ar.label !== "string" || typeof ar.value !== "string") {
                fail(400, "item answers entries must look like {label, value}");
              }
              const label = ar.label.trim().slice(0, 30);
              if (label === "") continue;
              answers.push({
                label: byLabel.get(label.toLowerCase()) ?? label,
                value: ar.value.slice(0, 100),
              });
            }
          } else {
            answers = parseOrderAnswers(line.answers);
          }
        }
        const subtotal = unit * line.quantity;
        updates.set(line.id, { size, answers: JSON.stringify(answers), price: unit, subtotal });
      }
      // Re-total over EVERY line (payload may list a subset).
      let total = 0;
      for (const line of order.items) {
        const u = updates.get(line.id);
        total += u ? u.subtotal : line.subtotal;
      }
      await db.$transaction([
        ...Array.from(updates.entries()).map(([id, u]) =>
          db.orderItem.update({
            where: { id },
            data: { size: u.size, answers: u.answers, price: u.price, subtotal: u.subtotal },
          })
        ),
        db.order.update({ where: { orderId }, data: { ...data, total } }),
      ]);
      const updated = await findOrderRow(orderId);
      return NextResponse.json({ order: serializeOrder(updated!) });
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
