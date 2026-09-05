// Coffee++ formatting helpers
import { parseISO } from "date-fns";

/**
 * Fixed display timezone for every date/time we render.
 *
 * The booth runs at Partido State University (Philippines), and staff enter
 * booth windows / read timestamps in Manila wall-clock time. Formatting with
 * an EXPLICIT timezone makes the output identical on the server (UTC in the
 * sandbox / any host) and in every visitor's browser — timezone-dependent
 * rendering made the SSR text differ from the client text and broke React
 * hydration (the countdown date line). Never make these helpers local-time.
 *
 * date-fns 4.1 has no `timeZone` format option, so the fixed-zone conversion
 * is done with Intl.DateTimeFormat (full-icu Node + every browser).
 */
const BOOTH_TIMEZONE = "Asia/Manila";

// Cached formatters — en-US + fixed zone = byte-identical output everywhere.
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOTH_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOTH_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOTH_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toDate(iso: string | Date): Date {
  return typeof iso === "string" ? parseISO(iso) : iso;
}

/** ₱49 or ₱1,519 (whole pesos) */
export function formatPeso(amount: number): string {
  return `₱${Math.round(amount).toLocaleString("en-PH")}`;
}

/** "ORD-0007" → "#0007" */
export function shortOrderId(orderId: string): string {
  const num = orderId.replace(/^ORD-/, "");
  return `#${num}`;
}

/** "Sep 22, 2026" */
export function formatDate(iso: string | Date): string {
  return DATE_FMT.format(toDate(iso));
}

/** "8:00 AM" */
export function formatTime(iso: string | Date): string {
  return TIME_FMT.format(toDate(iso));
}

/** "Sep 22, 2026 · 8:00 AM" */
export function formatDateTime(iso: string | Date): string {
  const d = toDate(iso);
  return `${DATE_FMT.format(d)} · ${TIME_FMT.format(d)}`;
}

/** "2026-09-22" (booth-local calendar day) */
export function dayKey(iso: string | Date): string {
  const parts = DAY_KEY_FMT.formatToParts(toDate(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function paymentMethodLabel(method: string): string {
  return method === "GCASH" ? "GCash" : "Pay at Booth";
}
