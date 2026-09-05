// GET /api/booth — public booth info + state
// PATCH /api/booth — ADMIN: update settings (dates, total cost, gcash, specs, email)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { errorResponse, fail, asInt, parseIsoDate, readJson, unauthorized } from "@/app/api/_lib/http";
import { boothStateOf, getBoothRow, serializeBooth } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const row = await getBoothRow();
    const settings = serializeBooth(row);
    return NextResponse.json({ settings, state: boothStateOf(settings) });
  } catch (err) {
    return errorResponse(err, "GET /api/booth");
  }
}

export async function PATCH(req: Request) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const body = await readJson(req);
    if (!body) fail(400, "Invalid JSON body");

    const row = await getBoothRow();

    let boothName = row.boothName;
    if ("boothName" in body) {
      const v = body.boothName;
      if (typeof v !== "string" || v.trim() === "") fail(400, "boothName must be a non-empty string");
      boothName = v.trim();
    }

    const startDate = "startDate" in body ? parseIsoDate(body.startDate, "startDate") : row.startDate;
    const endDate = "endDate" in body ? parseIsoDate(body.endDate, "endDate") : row.endDate;
    if (endDate.getTime() <= startDate.getTime()) {
      fail(400, "endDate must be after startDate");
    }

    let totalCost = row.totalCost;
    if ("totalCost" in body) {
      const n = asInt(body.totalCost);
      if (n === null || n < 0) fail(400, "totalCost must be a non-negative integer");
      totalCost = n;
    }

    let gcashNumber = row.gcashNumber;
    if ("gcashNumber" in body) {
      if (typeof body.gcashNumber !== "string") fail(400, "gcashNumber must be a string");
      gcashNumber = body.gcashNumber.trim();
    }

    let specsNumber = row.specsNumber;
    if ("specsNumber" in body) {
      if (typeof body.specsNumber !== "string") fail(400, "specsNumber must be a string");
      specsNumber = body.specsNumber.trim();
    }

    let contactEmail = row.contactEmail;
    if ("contactEmail" in body) {
      if (typeof body.contactEmail !== "string") fail(400, "contactEmail must be a string");
      contactEmail = body.contactEmail.trim();
    }

    // clientSiteUrl — the deployed customer web menu URL (QR on Scanner).
    // Empty clears it; non-empty must be an absolute http(s) link.
    let clientSiteUrl = row.clientSiteUrl;
    if ("clientSiteUrl" in body) {
      if (typeof body.clientSiteUrl !== "string") fail(400, "clientSiteUrl must be a string");
      const v = body.clientSiteUrl.trim();
      if (v !== "") {
        try {
          const parsed = new URL(v);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("bad protocol");
          }
        } catch {
          fail(400, "clientSiteUrl must be a full http(s) link, e.g. https://coffeepp.vercel.app", "CLIENT_URL_INVALID");
        }
      }
      clientSiteUrl = v;
    }

    const updated = await db.booth.update({
      where: { id: row.id },
      data: { boothName, startDate, endDate, totalCost, gcashNumber, specsNumber, contactEmail, clientSiteUrl },
    });

    return NextResponse.json({ settings: serializeBooth(updated) });
  } catch (err) {
    return errorResponse(err, "PATCH /api/booth");
  }
}
