// Coffee++ order registration — the ONE pipeline every scan goes through.
//
// Extracted verbatim from POST /api/orders/register so the hotspot bridge
// (phone scans arriving at /api/hotspot/scan) registers orders through the
// exact same validation + re-pricing as the laptop's camera scanner:
//   - booth must be OPEN
//   - duplicate scans welcome (same QR → ORD-…-2, -3, … copies)
//   - payload validated (name/email/items/pay/ts)
//   - re-priced against the CURRENT Product table (warnings, never blocks)
// Throws HttpError (mapped by errorResponse) on any validation failure.

import { db } from "@/lib/db";
import { fail } from "@/app/api/_lib/http";
import {
  boothStateOf,
  getBoothRow,
  nextOrderId,
  serializeBooth,
  serializeOrder,
  uniqueOrderId,
} from "@/app/api/_lib/service";
import type { Order } from "@/lib/types";
import type { Product as ProductRow } from "@prisma/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORDER_ID_RE = /^ORD-[A-Z0-9]{1,10}$/i;

interface IncomingItem {
  pid?: string;
  q: number;
  n: string;
  t: string | null;
  s: number;
}

/** A validated, re-priced line item ready for the DB snapshot. */
interface PreparedItem {
  productId: string;
  productName: string;
  temperature: string | null;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface RegisterResult {
  order: Order;
  warnings: string[];
}

/**
 * Validate + re-price + persist one scanned order payload (the Order-QR
 * JSON body — the same shape the camera scanner, manual entry and the
 * phone scanner app produce).
 */
export async function registerOrderFromPayload(
  body: Record<string, unknown>
): Promise<RegisterResult> {
  // ---- 1. Booth must be OPEN ---------------------------------------
  const booth = await getBoothRow();
  const settings = serializeBooth(booth);
  const state = boothStateOf(settings);
  if (state !== "OPEN") {
    const message =
      state === "BEFORE" ? "The booth has not opened yet" : "The booth is closed";
    fail(403, `${message}. Orders cannot be registered.`, "BOOTH_CLOSED");
  }

  // ---- 2. Order id — duplicates welcome -----------------------------
  // The SAME customer QR may be scanned again to add another copy of the
  // order: first scan keeps the client id, later scans get -2, -3, … suffixes.
  // Walk-ins (no id) get the next sequential ORD-####.
  let orderId: string;
  let duplicateOf: string | null = null;
  if (body.id !== undefined && body.id !== null && body.id !== "") {
    if (typeof body.id !== "string" || !ORDER_ID_RE.test(body.id)) {
      fail(400, "id must look like ORD-XXXX (up to 10 letters/digits)");
    }
    // Client-generated alphanumeric ids are kept as-is (uppercased).
    const requestedId = body.id.toUpperCase();
    orderId = await uniqueOrderId(requestedId);
    duplicateOf = orderId === requestedId ? null : requestedId;
  } else {
    // Manual walk-in order — server assigns the next sequential id.
    orderId = await nextOrderId();
  }

  // ---- 3. Payload validation ---------------------------------------
  // customerName (required)
  if (body.name !== undefined && body.name !== null && typeof body.name !== "string") {
    fail(400, "name must be a string");
  }
  const customerName = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (customerName === "") {
    fail(400, "Please provide the customer name.", "NAME_REQUIRED");
  }

  // customerAlias — the call-out name ("how they want to be called"), optional
  if (
    body.alias !== undefined &&
    body.alias !== null &&
    typeof body.alias !== "string"
  ) {
    fail(400, "alias must be a string");
  }
  const customerAlias =
    typeof body.alias === "string" ? body.alias.trim().slice(0, 40) : "";

  // customerEmail (optional, validated when provided, stored lowercase)
  if (
    body.email !== undefined &&
    body.email !== null &&
    typeof body.email !== "string"
  ) {
    fail(400, "email must be a string");
  }
  const customerEmailRaw =
    typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
  if (customerEmailRaw !== "" && !EMAIL_RE.test(customerEmailRaw)) {
    fail(400, "That email address doesn't look valid.", "EMAIL_INVALID");
  }
  const customerEmail = customerEmailRaw.toLowerCase();

  // items: 1–10 distinct items (both UIs send exactly 1), quantity ≥ 1
  // (no ordering limit — 9999 is only a payload sanity ceiling)
  if (!Array.isArray(body.items)) fail(400, "items must be an array");
  const rawItems = body.items as unknown[];
  if (rawItems.length < 1 || rawItems.length > 10) {
    fail(400, "An order needs 1–10 items");
  }
  const items: IncomingItem[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== "object") fail(400, "items must be objects");
    const obj = it as Record<string, unknown>;
    if (typeof obj.q !== "number" || !Number.isInteger(obj.q)) {
      fail(400, "item q must be an integer");
    }
    if (obj.q < 1 || obj.q > 9999) fail(400, "item q must be between 1 and 9999");
    if (typeof obj.n !== "string" || obj.n.trim() === "") {
      fail(400, "item n must be a non-empty string");
    }
    if (typeof obj.s !== "number" || !Number.isInteger(obj.s) || obj.s < 0) {
      fail(400, "item s must be a non-negative integer");
    }
    let temperature: string | null = null;
    if (obj.t !== undefined && obj.t !== null) {
      if (obj.t !== "HOT" && obj.t !== "COLD") {
        fail(400, "item t must be HOT or COLD");
      }
      temperature = obj.t;
    }
    items.push({
      ...(typeof obj.pid === "string" && obj.pid !== "" ? { pid: obj.pid } : {}),
      q: obj.q,
      n: obj.n.trim().slice(0, 80),
      t: temperature,
      s: obj.s,
    });
  }

  // pay ∈ GCASH | BOOTH
  if (body.pay !== "GCASH" && body.pay !== "BOOTH") {
    fail(400, "pay must be GCASH or BOOTH");
  }
  const paymentMethod = body.pay;

  // createdAt from payload ts (validated; fallback now)
  let createdAt = new Date();
  if (typeof body.ts === "string" && body.ts.trim() !== "") {
    const parsed = new Date(body.ts);
    if (Number.isNaN(parsed.getTime())) {
      fail(400, "ts is not a valid date");
    }
    createdAt = parsed;
  }

  // ---- 4. Re-price against the CURRENT Product table ---------------
  const products = await db.product.findMany();
  const byId = new Map<string, ProductRow>();
  const byNameLower = new Map<string, ProductRow>();
  for (const p of products) {
    byId.set(p.id.toUpperCase(), p);
    byNameLower.set(p.name.trim().toLowerCase(), p);
  }

  const warnings: string[] = [];
  if (duplicateOf) {
    warnings.push(
      `Duplicate scan — another copy of #${duplicateOf.replace(/^ORD-/, "")} was registered as #${orderId.replace(/^ORD-/, "")}.`
    );
  }
  const prepared: PreparedItem[] = [];
  let recomputedTotal = 0;

  for (const item of items) {
    let product: ProductRow | undefined;
    if (item.pid) product = byId.get(item.pid.trim().toUpperCase());
    if (!product) product = byNameLower.get(item.n.toLowerCase());

    if (!product) {
      // Unknown product — keep the payload values, flag for the staff.
      warnings.push(`Unknown product “${item.n}” — kept the QR price (₱${item.s}).`);
      const unit = item.q > 0 ? Math.round(item.s / item.q) : item.s;
      prepared.push({
        productId: item.pid?.trim() || item.n,
        productName: item.n,
        temperature: item.t,
        quantity: item.q,
        price: unit,
        subtotal: item.s,
      });
      recomputedTotal += item.s;
      continue;
    }

    // Known product — current price always wins.
    const subtotal = product.price * item.q;
    if (item.s !== subtotal) {
      warnings.push(
        `Price updated: ${product.name} is now ₱${product.price} — subtotal ₱${subtotal} (QR had ₱${item.s}).`
      );
    }
    if (!product.available) {
      warnings.push(`${product.name} is currently unavailable.`);
    }

    prepared.push({
      productId: product.id,
      productName: product.name,
      temperature: item.t,
      quantity: item.q,
      price: product.price,
      subtotal,
    });
    recomputedTotal += subtotal;
  }

  const payloadTotal =
    typeof body.total === "number" && Number.isInteger(body.total) && body.total >= 0
      ? body.total
      : recomputedTotal;
  if (payloadTotal !== recomputedTotal) {
    warnings.push(`Total recomputed: ₱${recomputedTotal} (QR said ₱${payloadTotal}).`);
  }

  // ---- 5. Create the order ------------------------------------------
  const created = await db.order.create({
    data: {
      orderId,
      customerName,
      customerAlias,
      customerEmail,
      total: recomputedTotal,
      paymentMethod,
      paymentStatus: "UNPAID",
      orderStatus: "WAITING",
      createdAt,
      scannedAt: new Date(),
      items: {
        create: prepared.map((p) => ({
          productId: p.productId,
          productName: p.productName,
          temperature: p.temperature,
          quantity: p.quantity,
          price: p.price,
          subtotal: p.subtotal,
        })),
      },
    },
    include: { items: true },
  });

  return { order: serializeOrder(created), warnings };
}
