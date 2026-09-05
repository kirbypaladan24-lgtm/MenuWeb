// GET /api/menu-export — ADMIN: download coffeepp-menu.json, the exact
// menu file contract consumed by the standalone customer site
// (src/data/menu.json). This is the admin → client sync bridge: edit
// products & booth settings here, export, replace the file in the client
// project, redeploy.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { errorResponse, unauthorized } from "@/app/api/_lib/http";
import { getBoothRow, serializeBooth, toPublicProduct } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const booth = await getBoothRow();
    const settings = serializeBooth(booth);
    const products = await db.product.findMany({ orderBy: { id: "asc" } });

    const menu = {
      // Schema v2: products may carry defaultTemperature (fixed serving temp
      // when hasTemperature is false). Kept in sync with the client's
      // src/data/menu.json version.
      version: 2,
      booth: {
        boothName: settings.boothName,
        startDate: settings.startDate,
        endDate: settings.endDate,
        gcashNumber: settings.gcashNumber,
        specsNumber: settings.specsNumber,
        contactEmail: settings.contactEmail,
      },
      products: products.map(toPublicProduct),
    };

    return new NextResponse(JSON.stringify(menu, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="coffeepp-menu.json"',
      },
    });
  } catch (err) {
    return errorResponse(err, "GET /api/menu-export");
  }
}
