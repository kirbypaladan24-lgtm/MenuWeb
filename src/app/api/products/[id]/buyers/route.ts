// GET /api/products/[id]/buyers — STAFF: every customer who bought this
// product, newest first. One row per order (credentials + this product's
// quantity / temperature / subtotal) — feeds the dashboard's product
// drill-down table.
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { errorResponse, unauthorized } from "@/app/api/_lib/http";
import { listProductBuyers } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const { id } = await params;
    const productId = decodeURIComponent(id).trim().toUpperCase();

    const buyers = await listProductBuyers(productId);
    return NextResponse.json({ productId, buyers });
  } catch (err) {
    return errorResponse(err, "GET /api/products/[id]/buyers");
  }
}
