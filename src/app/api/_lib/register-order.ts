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
  parseProductFields,
  parseProductSizes,
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
  z: string | null; // size name (hasSizes products) — null when none chosen
  a: { label: string; value: string }[]; // custom-field answers — [] when none
  s: number;
}

/** A validated, re-priced line item ready for the DB snapshot. */
interface PreparedItem {
  productId: string;
  productName: string;
  temperature: string | null;
  size: string | null;
  answers: { label: string; value: string }[];
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
    // z = size name (hasSizes products). Tolerated when missing (old QRs);
    // the re-pricer below resolves it against the current size menu.
    let size: string | null = null;
    if (obj.z !== undefined && obj.z !== null) {
      if (typeof obj.z !== "string") fail(400, "item z must be a string");
      const trimmed = obj.z.trim().slice(0, 20);
      size = trimmed === "" ? null : trimmed;
    }
    // a = custom-field answers [{l, v}]. Tolerated when missing (old QRs);
    // resolved against the current field defs below. Values cap at 100
    // chars so one QR can't bloat the database.
    const incomingAnswers: { label: string; value: string }[] = [];
    if (obj.a !== undefined && obj.a !== null) {
      if (!Array.isArray(obj.a)) fail(400, "item a must be an array");
      for (const entry of obj.a as unknown[]) {
        if (!entry || typeof entry !== "object") fail(400, "item a entries must be objects");
        const rec = entry as Record<string, unknown>;
        if (typeof rec.l !== "string" || typeof rec.v !== "string") {
          fail(400, "item a entries must look like {l, v}");
        }
        const label = rec.l.trim().slice(0, 30);
        if (label === "") continue;
        incomingAnswers.push({ label, value: rec.v.slice(0, 100) });
      }
      if (incomingAnswers.length > 8) fail(400, "an item can carry at most 8 answers");
    }
    items.push({
      ...(typeof obj.pid === "string" && obj.pid !== "" ? { pid: obj.pid } : {}),
      q: obj.q,
      n: obj.n.trim().slice(0, 80),
      t: temperature,
      z: size,
      a: incomingAnswers,
      s: obj.s,
    });
  }

  // pay ∈ GCASH | BOOTH
  if (body.pay !== "GCASH" && body.pay !== "BOOTH") {
    fail(400, "pay must be GCASH or BOOTH");
  }
  if (body.pay === "GCASH" && !settings.gcashPayment) {
    fail(400, "GCash payments are currently disabled — please order again with Pay at Booth.", "GCASH_DISABLED");
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
        size: item.z,
        answers: item.a,
        quantity: item.q,
        price: unit,
        subtotal: item.s,
      });
      recomputedTotal += item.s;
      continue;
    }

    // Known product — resolve the size first (a size's own price wins),
    // then the current base price. Warnings never block.
    let size = item.z;
    let unit = product.price;
    if (product.hasSizes) {
      const menu = parseProductSizes(product.sizes);
      if (size) {
        const match = menu.find((s) => s.name.toLowerCase() === size!.toLowerCase());
        if (match) {
          size = match.name; // canonicalize casing ("large" → "Large")
          unit = match.price;
        } else {
          warnings.push(`Size “${size}” is not on the menu for ${product.name} — charged base ₱${product.price}.`);
          size = null;
        }
      } else {
        warnings.push(`${product.name} now has sizes — no size chosen, charged base ₱${product.price}.`);
      }
    } else if (size) {
      warnings.push(`Size “${size}” ignored — ${product.name} has no size options.`);
      size = null;
    }

    // Known product — resolve the custom-field answers. Missing REQUIRED
    // answers warn (never block — the line keeps moving; creation screens
    // enforce them up front). Labels canonicalize to the menu ("sugar" →
    // "Sugar"); answers for a product with the flag off are dropped.
    let answers: { label: string; value: string }[] = [];
    if (product.hasFields) {
      const defs = parseProductFields(product.fields);
      const byLabel = new Map(defs.map((d) => [d.label.toLowerCase(), d.label]));
      for (const ans of item.a) {
        const canonical = byLabel.get(ans.label.toLowerCase());
        answers.push({ label: canonical ?? ans.label, value: ans.value });
      }
      for (const def of defs) {
        const filled = answers.some(
          (a) => a.label.toLowerCase() === def.label.toLowerCase() && a.value.trim() !== ""
        );
        if (def.required && !filled) {
          warnings.push(`“${def.label}” is required for ${product.name} — registered without an answer.`);
        }
      }
    } else if (item.a.length > 0) {
      warnings.push(`Extra answers ignored — ${product.name} has no custom fields.`);
    }

    // Known product — current price always wins.
    const subtotal = unit * item.q;
    if (item.s !== subtotal) {
      warnings.push(
        `Price updated: ${product.name}${size ? ` (${size})` : ""} is now ₱${unit} — subtotal ₱${subtotal} (QR had ₱${item.s}).`
      );
    }
    if (!product.available) {
      warnings.push(`${product.name} is currently unavailable.`);
    }

    prepared.push({
      productId: product.id,
      productName: product.name,
      temperature: item.t,
      size,
      answers,
      quantity: item.q,
      price: unit,
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
          size: p.size,
          answers: JSON.stringify(p.answers),
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
