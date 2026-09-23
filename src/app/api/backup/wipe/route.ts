// POST /api/backup/wipe — ADMIN: reboot the booth data.
//
// Two-step, both PIN-gated (the PIN is verified server-side, never trusted
// from the client):
//   1. { pin }               → { pinOk: true } (nothing touched)
//   2. { pin, confirm: true } → wipes + { ok, ordersDeleted }
//
// The wipe deletes ALL orders (and their items) and resets every product's
// sold counter to 0. Products, menu, booth settings and total cost stay —
// a reboot starts the next run fresh without re-entering the menu.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { errorResponse, fail, readJson, unauthorized } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

// Booth-day PIN — change per event. Compared server-side only.
const REBOOT_PIN = "2026";

export async function POST(req: Request) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const body = await readJson(req);
    if (!body) fail(400, "Invalid JSON body");

    if (typeof body.pin !== "string" || body.pin !== REBOOT_PIN) {
      fail(403, "Wrong PIN.", "WRONG_PIN");
    }
    if (body.confirm !== true) {
      return NextResponse.json({ pinOk: true });
    }

    const deleted = await db.$transaction(async (tx) => {
      const count = await tx.order.count();
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.product.updateMany({ data: { sold: 0 } });
      return count;
    });

    return NextResponse.json({ ok: true, ordersDeleted: deleted });
  } catch (err) {
    return errorResponse(err, "POST /api/backup/wipe");
  }
}
