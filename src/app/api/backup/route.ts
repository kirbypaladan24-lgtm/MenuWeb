// GET /api/backup — ADMIN: JSON download of the full database snapshot
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { errorResponse, unauthorized } from "@/app/api/_lib/http";
import {
  getBoothRow,
  localDateKey,
  serializeBooth,
  serializeOrder,
  serializeProduct,
} from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const products = await db.product.findMany({ orderBy: { id: "asc" } });
    const orders = await db.order.findMany({
      include: { items: true },
      orderBy: [{ createdAt: "asc" }, { orderId: "asc" }],
    });
    const booth = await getBoothRow();

    const payload = {
      products: products.map(serializeProduct),
      orders: orders.map(serializeOrder),
      settings: serializeBooth(booth),
      exportedAt: new Date().toISOString(),
    };

    const filename = `CoffeePP_Backup_${localDateKey(new Date())}.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return errorResponse(err, "GET /api/backup");
  }
}
