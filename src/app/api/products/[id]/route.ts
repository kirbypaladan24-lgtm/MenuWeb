// PATCH /api/products/[id] — ADMIN: partial product update
// DELETE /api/products/[id] — ADMIN: delete product (orders keep stored productName)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { asBool, asInt, errorResponse, fail, readJson, unauthorized } from "@/app/api/_lib/http";
import { parseProductFields, parseProductSizes, serializeProduct, validateFieldList, validateSizeList } from "@/app/api/_lib/service";
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
    if ("hasSizes" in body) {
      const b = asBool(body.hasSizes);
      if (b === null) fail(400, "hasSizes must be a boolean");
      data.hasSizes = b;
      // Switching sizes off clears the size menu — stored sizes must never
      // leak back onto the customer site while the flag is off.
      if (!b) data.sizes = "[]";
    }
    if ("sizes" in body) {
      const list = validateSizeList(body.sizes);
      data.sizes = JSON.stringify(list);
    }
    // hasSizes on with an empty menu is a broken product — the customer
    // site would show a size picker with nothing to pick.
    {
      const effectiveHasSizes =
        data.hasSizes === true || (data.hasSizes === undefined && existing.hasSizes);
      const effectiveSizes =
        typeof data.sizes === "string" ? parseProductSizes(data.sizes) : parseProductSizes(existing.sizes);
      if (effectiveHasSizes && effectiveSizes.length === 0) {
        fail(400, "sizes needs at least 1 entry when hasSizes is true");
      }
    }
    if ("hasFields" in body) {
      const b = asBool(body.hasFields);
      if (b === null) fail(400, "hasFields must be a boolean");
      data.hasFields = b;
      // Switching custom inputs off clears the defs — stored labels must
      // never leak back onto the customer site while the flag is off.
      if (!b) data.fields = "[]";
    }
    if ("fields" in body) {
      const list = validateFieldList(body.fields);
      data.fields = JSON.stringify(list);
    }
    // hasFields on with no inputs is a broken product — the customer site
    // would show an empty questions block.
    {
      const effectiveHasFields =
        data.hasFields === true || (data.hasFields === undefined && existing.hasFields);
      const effectiveFields =
        typeof data.fields === "string" ? parseProductFields(data.fields) : parseProductFields(existing.fields);
      if (effectiveHasFields && effectiveFields.length === 0) {
        fail(400, "fields needs at least 1 entry when hasFields is true");
      }
    }
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
