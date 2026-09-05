// Coffee++ admin QR parsing (booth console side of the Order QR bridge)
//
// The standalone customer site creates orders entirely OFFLINE and encodes the
// full order data as compact JSON in the Order QR — id, customer name, email,
// items (with product ids and subtotals), total, payment method, placed-at
// time. The booth console parses that JSON and REGISTERS the order via
// POST /api/orders/register; the QR payload is the ONLY data bridge between
// the two apps. Legacy bare-ID codes ("ORD-0007" / "7") are still accepted
// for lookups of already-registered orders.
"use client";

/** One line item inside the QR payload. */
export interface QrOrderItem {
  pid?: string; // product id (e.g. "CF-001") — tolerated when missing
  q: number; // quantity
  n: string; // product name
  t: string | null; // HOT | COLD | null
  s: number; // subtotal (₱)
}

/**
 * Full order data embedded in the Order QR (v2 contract).
 * `id` is optional so the same shape doubles as the Manual Order
 * request body — the server then assigns the next sequential ORD-####.
 */
export interface QrOrderPayload {
  v: 1;
  id?: string; // ORD-K7F2Q9 (client-generated) / ORD-0007 (admin manual)
  name: string; // customer name
  alias?: string; // call-out name ("how they want to be called")
  email: string; // customer email ("" when not provided)
  items: QrOrderItem[];
  total: number;
  pay: string; // GCASH | BOOTH
  ts?: string; // ISO placed-at time — tolerated when missing
}

export interface ParsedOrderQr {
  orderId: string; // normalized order id
  payload: QrOrderPayload | null; // full data when the QR is the JSON format
}

/** Order-id shape: ORD- + 1–10 alphanumerics, optionally -N (duplicate copies). */
const ORDER_ID_RE = /^ORD-[A-Z0-9]{1,10}(-\d+)?$/i;

/** Legacy numeric forms: "7", "ord-7", "ORD-0007" → ORD-0007 (padded). */
function normalizeLegacyOrdId(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (/^\d{1,4}$/.test(s)) return `ORD-${s.padStart(4, "0")}`;
  const m = /^ORD-(\d{1,4})$/.exec(s);
  if (m) return `ORD-${m[1].padStart(4, "0")}`;
  return null;
}

/**
 * Parse raw scanned / pasted text into an order action. Accepts:
 *  - the v2 JSON payload built by the customer site (full order data —
 *    id kept UPPERCASED as-is, never numeric-padded)
 *  - a bare Order ID: legacy "ORD-0007" / "ord-7" / "7" (numeric-only is
 *    padded to ORD-0007) or an alphanumeric id like "ORD-K7F2Q9" typed
 *    manually — both resolve to a lookup of an already-registered order.
 * Returns null when the text is neither.
 */
export function parseOrderQr(text: string): ParsedOrderQr | null {
  const raw = text.trim();
  if (raw === "") return null;

  // v2 payload — JSON with the full order data
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw) as Partial<QrOrderPayload> & {
        items?: Partial<QrOrderItem>[];
      };
      if (typeof obj.id !== "string" || !ORDER_ID_RE.test(obj.id)) return null;
      // Client-generated ids are alphanumeric — keep as-is (uppercase), no padding.
      const orderId = obj.id.toUpperCase();

      const items: QrOrderItem[] = Array.isArray(obj.items)
        ? obj.items
            .filter(
              (it): it is QrOrderItem =>
                !!it &&
                typeof it === "object" &&
                typeof it.q === "number" &&
                typeof it.n === "string" &&
                typeof it.s === "number"
            )
            .map((it) => ({
              ...(typeof it.pid === "string" && it.pid !== "" ? { pid: it.pid } : {}),
              q: it.q,
              n: it.n,
              t: typeof it.t === "string" ? it.t : null,
              s: it.s,
            }))
        : [];

      const payload: QrOrderPayload = {
        v: 1,
        id: orderId,
        name: typeof obj.name === "string" ? obj.name : "",
        ...(typeof obj.alias === "string" && obj.alias !== "" ? { alias: obj.alias } : {}),
        email: typeof obj.email === "string" ? obj.email : "",
        items,
        total: typeof obj.total === "number" ? obj.total : 0,
        pay: typeof obj.pay === "string" ? obj.pay : "",
        ...(typeof obj.ts === "string" && obj.ts !== "" ? { ts: obj.ts } : {}),
      };
      return { orderId, payload };
    } catch {
      return null;
    }
  }

  // Legacy / manual — bare Order ID (padded numeric, or alphanumeric as-is)
  const legacy = normalizeLegacyOrdId(raw);
  if (legacy) return { orderId: legacy, payload: null };
  if (ORDER_ID_RE.test(raw)) return { orderId: raw.toUpperCase(), payload: null };
  return null;
}
