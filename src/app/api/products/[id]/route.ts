// PATCH /api/products/[id] — ADMIN: partial product update
// DELETE /api/products/[id] — ADMIN: delete product (orders keep stored productName)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { asBool, asInt, errorResponse, fail, readJson, unauthorized } from "@/app/api/_lib/http";
import { serializeProduct } from "@/app/api/_lib/service";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function normalizeProductId(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const { id } = await params;
    const productId = normalizeProductId(id);
    const existing = await db.product.findUnique({ where: { id: productId } });
    if (!existing) fail(404, "Product not found");

    const body = await readJson(req);
    if (!body) fail(400, "Invalid JSON body");

    const data: Prisma.ProductUpdateInput = {};

    if ("name" in body) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        fail(400, "name must be a non-empty string");
      }
      data.name = body.name.trim().slice(0, 80);
    }
    if ("description" in body) {
      if (typeof body.description !== "string") fail(400, "description must be a string");
      data.description = body.description.trim().slice(0, 300);
    }
    if ("price" in body) {
      const n = asInt(body.price);
      if (n === null || n < 0) fail(400, "price must be a non-negative integer");
      data.price = n;
    }
    if ("image" in body) {
      if (typeof body.image !== "string") fail(400, "image must be a string");
      data.image = body.image.trim();
    }
    if ("available" in body) {
      const b = asBool(body.available);
      if (b === null) fail(400, "available must be a boolean");
      data.available = b;
    }
    if ("hasTemperature" in body) {
      const b = asBool(body.hasTemperature);
      if (b === null) fail(400, "hasTemperature must be a boolean");
      data.hasTemperature = b;
    }
    if ("defaultTemperature" in body) {
      const v = body.defaultTemperature;
      if (v === null || v === undefined) {
        data.defaultTemperature = null;
      } else if (v === "HOT" || v === "COLD") {
        data.defaultTemperature = v;
      } else {
        fail(400, 'defaultTemperature must be "HOT", "COLD" or null');
      }
    }
    // Enabling the Hot/Cold choice clears any fixed serving temperature —
    // the field only carries meaning when there is no customer choice.
    if (data.hasTemperature === true) data.defaultTemperature = null;
    if ("category" in body) {
      if (typeof body.category !== "string" || body.category.trim() === "") {
        fail(400, "category must be a non-empty string");
      }
      data.category = body.category.trim().slice(0, 60);
    }

    const updated = await db.product.update({ where: { id: productId }, data });
    return NextResponse.json({ product: serializeProduct(updated) });
  } catch (err) {
    return errorResponse(err, "PATCH /api/products/[id]");
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const { id } = await params;
    const productId = normalizeProductId(id);
    const existing = await db.product.findUnique({ where: { id: productId } });
    if (!existing) fail(404, "Product not found");

    await db.product.delete({ where: { id: productId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "DELETE /api/products/[id]");
  }
}
