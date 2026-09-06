// POST /api/orders/register — register an order from a scanned customer
// Order QR (or a manually built walk-in order). The standalone customer site
// creates orders entirely offline, so this endpoint IS the data bridge: it
// validates the QR payload and re-prices it against the CURRENT product
// table, warning (never blocking) on mismatches. Re-scanning the SAME QR
// registers ANOTHER copy of the order (ORD-K7F2Q9-2, -3, …) so customers can
// repeat a scan when they want more of the same.
//
// The validation/re-pricing itself lives in _lib/register-order.ts so the
// hotspot phone-scanner bridge (/api/hotspot/scan) registers orders through
// the exact same pipeline — this route is the HTTP wrapper for the laptop's
// own scanner (camera, manual entry, Manual Order dialog).
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { errorResponse, fail, readJson, unauthorized } from "@/app/api/_lib/http";
import { registerOrderFromPayload } from "@/app/api/_lib/register-order";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const body = await readJson(req);
    if (!body) fail(400, "Invalid JSON body");

    const { order, warnings } = await registerOrderFromPayload(body);

    return NextResponse.json({ order, warnings }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "POST /api/orders/register");
  }
}
