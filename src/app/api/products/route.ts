// GET /api/products — public product list (sold count omitted).
//   With a valid booth session the full Product shape is returned instead
//   (additive — the booth admin UI needs sold for management).
// POST /api/products — ADMIN: create product.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { asBool, asInt, errorResponse, fail, readJson, unauthorized } from "@/app/api/_lib/http";
import { serializeProduct, toPublicProduct } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

const PRODUCT_ID_RE = /^[A-Z]{2,3}-\d{3}$/; // e.g. CF-001

export async function GET(req: Request) {
  try {
    const rows = await db.product.findMany({ orderBy: { id: "asc" } });
    const session = requireRole(req, "STAFF");
    const products = session ? rows.map(serializeProduct) : rows.map(toPublicProduct);
    return NextResponse.json({ products });
  } catch (err) {
    return errorResponse(err, "GET /api/products");
  }
}

export async function POST(req: Request) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const body = await readJson(req);
    if (!body) fail(400, "Invalid JSON body");

    // id (required, XX-000 format, unique)
    if (typeof body.id !== "string" || body.id.trim() === "") {
      fail(400, "id is required");
    }
    const id = body.id.trim().toUpperCase();
    if (!PRODUCT_ID_RE.test(id)) {
      fail(400, "id must look like XX-000 (2–3 letters, dash, 3 digits)");
    }

    // name (required)
    if (typeof body.name !== "string" || body.name.trim() === "") {
      fail(400, "name must be a non-empty string");
    }
    const name = body.name.trim().slice(0, 80);

    // price (required, non-negative int)
    const price = asInt(body.price);
    if (price === null || price < 0) fail(400, "price must be a non-negative integer");

    // description (optional, default "")
    let description = "";
    if ("description" in body && body.description !== null && body.description !== undefined) {
      if (typeof body.description !== "string") fail(400, "description must be a string");
      description = body.description.trim().slice(0, 300);
    }

    // image (optional, default "")
    let image = "";
    if ("image" in body && body.image !== null && body.image !== undefined) {
      if (typeof body.image !== "string") fail(400, "image must be a string");
      image = body.image.trim();
    }

    // available (optional, default true)
    let available = true;
    if ("available" in body && body.available !== null && body.available !== undefined) {
      const b = asBool(body.available);
      if (b === null) fail(400, "available must be a boolean");
      available = b;
    }

    // hasTemperature (optional, default false)
    let hasTemperature = false;
    if ("hasTemperature" in body && body.hasTemperature !== null && body.hasTemperature !== undefined) {
      const b = asBool(body.hasTemperature);
      if (b === null) fail(400, "hasTemperature must be a boolean");
      hasTemperature = b;
    }

    // defaultTemperature (optional — fixed serving temp shown to customers;
    // only meaningful when hasTemperature is false)
    let defaultTemperature: string | null = null;
    if ("defaultTemperature" in body && body.defaultTemperature !== null && body.defaultTemperature !== undefined) {
      if (body.defaultTemperature !== "HOT" && body.defaultTemperature !== "COLD") {
        fail(400, 'defaultTemperature must be "HOT" or "COLD"');
      }
      defaultTemperature = body.defaultTemperature;
    }
    // A choosable temperature makes the fixed default meaningless — keep data clean.
    if (hasTemperature) defaultTemperature = null;

    // category (optional, default "Drinks")
    let category = "Drinks";
    if ("category" in body && body.category !== null && body.category !== undefined) {
      if (typeof body.category !== "string" || body.category.trim() === "") {
        fail(400, "category must be a non-empty string");
      }
      category = body.category.trim().slice(0, 60);
    }

    const existing = await db.product.findUnique({ where: { id } });
    if (existing) {
      fail(409, `Product ${id} already exists`, "DUPLICATE");
    }

    const created = await db.product.create({
      data: { id, name, description, price, image, available, hasTemperature, defaultTemperature, category },
    });

    return NextResponse.json({ product: serializeProduct(created) }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "POST /api/products");
  }
}
