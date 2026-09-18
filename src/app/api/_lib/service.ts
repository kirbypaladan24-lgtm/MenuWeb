// Coffee++ API — domain service layer (private to src/app/api/**)
// Serializers map Prisma rows to the shared types in src/lib/types.ts.
import { db } from "@/lib/db";
import { fail } from "@/app/api/_lib/http";
import type { Prisma, Product as ProductRow, Booth as BoothRow, OrderItem as ItemRow } from "@prisma/client";
import type {
  BoothSettings,
  BoothState,
  DashboardStats,
  DailySalesStat,
  HotColdStat,
  Order,
  OrderAnswer,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductBuyer,
  ProductField,
  ProductSize,
  ProductStat,
  PublicProduct,
  ServeTimeStats,
  SizeStat,
  Temperature,
  TimeOfDayBucket,
  TimeOfDayStat,
} from "@/lib/types";

export type OrderRow = Prisma.OrderGetPayload<{ include: { items: true } }>;

/* ------------------------------------------------------------------ */
/* Serializers                                                         */
/* ------------------------------------------------------------------ */

/* Coerce a stored temperature string to the Temperature union.
 * The API only ever writes "HOT"/"COLD"/null, but the DB column is a plain
 * string — normalize anything unexpected to null instead of casting. */
function asTemperature(value: string | null): Temperature | null {
  return value === "HOT" || value === "COLD" ? value : null;
}

/* ------------------------------------------------------------------ */
/* Product sizes (stored as a JSON string on the Product row)           */
/* ------------------------------------------------------------------ */

const MAX_SIZES = 6;
const MAX_SIZE_NAME = 20;
const MAX_FIELDS = 4;
const MAX_FIELD_LABEL = 30;
const MAX_ANSWER_CHARS = 100;

/** Read the sizes JSON off a Product row — corrupt data reads as []. */
export function parseProductSizes(raw: string | null | undefined): ProductSize[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: ProductSize[] = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.name !== "string" || rec.name.trim() === "") continue;
      if (typeof rec.price !== "number" || !Number.isInteger(rec.price) || rec.price < 0) continue;
      out.push({ name: rec.name.trim().slice(0, MAX_SIZE_NAME), price: rec.price });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Validate a sizes list from a product create/update body. Throws HttpError
 * on any problem. Returns the canonical list (trimmed names).
 */
export function validateSizeList(input: unknown): ProductSize[] {
  if (!Array.isArray(input)) fail(400, "sizes must be an array of {name, price}");
  const raw = input as unknown[];
  if (raw.length > MAX_SIZES) fail(400, `sizes can have at most ${MAX_SIZES} entries`);
  const seen = new Set<string>();
  const out: ProductSize[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") fail(400, "sizes must be objects like {name, price}");
    const rec = entry as Record<string, unknown>;
    if (typeof rec.name !== "string" || rec.name.trim() === "") {
      fail(400, "every size needs a non-empty name");
    }
    const name = rec.name.trim().slice(0, MAX_SIZE_NAME);
    if (typeof rec.price !== "number" || !Number.isInteger(rec.price) || rec.price < 0) {
      fail(400, `size "${name}" needs a non-negative integer price`);
    }
    if (seen.has(name.toLowerCase())) fail(400, `duplicate size name "${name}"`);
    seen.add(name.toLowerCase());
    out.push({ name, price: rec.price });
  }
  return out;
}

/** Read the custom-field defs off a Product row — corrupt data reads as []. */
export function parseProductFields(raw: string | null | undefined): ProductField[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: ProductField[] = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.label !== "string" || rec.label.trim() === "") continue;
      out.push({
        label: rec.label.trim().slice(0, MAX_FIELD_LABEL),
        required: rec.required === true,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Validate custom-field defs from a product create/update body. Throws
 * HttpError on any problem. Returns the canonical list.
 */
export function validateFieldList(input: unknown): ProductField[] {
  if (!Array.isArray(input)) fail(400, "fields must be an array of {label, required}");
  const raw = input as unknown[];
  if (raw.length > MAX_FIELDS) fail(400, `fields can have at most ${MAX_FIELDS} entries`);
  const seen = new Set<string>();
  const out: ProductField[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") fail(400, "fields must be objects like {label, required}");
    const rec = entry as Record<string, unknown>;
    if (typeof rec.label !== "string" || rec.label.trim() === "") {
      fail(400, "every field needs a non-empty label");
    }
    const label = rec.label.trim().slice(0, MAX_FIELD_LABEL);
    if (seen.has(label.toLowerCase())) fail(400, `duplicate field label "${label}"`);
    seen.add(label.toLowerCase());
    out.push({ label, required: rec.required === true });
  }
  return out;
}

/** Read stored answers off an OrderItem row — corrupt data reads as []. */
export function parseOrderAnswers(raw: string | null | undefined): OrderAnswer[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: OrderAnswer[] = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.label !== "string" || rec.label.trim() === "") continue;
      if (typeof rec.value !== "string") continue;
      out.push({ label: rec.label.trim().slice(0, MAX_FIELD_LABEL), value: rec.value.slice(0, MAX_ANSWER_CHARS) });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeProduct(p: ProductRow): Product {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    image: p.image,
    available: p.available,
    hasTemperature: p.hasTemperature,
    defaultTemperature: asTemperature(p.defaultTemperature),
    hasSizes: p.hasSizes,
    sizes: parseProductSizes(p.sizes),
    hasFields: p.hasFields,
    fields: parseProductFields(p.fields),
    category: p.category,
    sold: p.sold,
  };
}

/** Customer-safe product: sold count omitted. defaultTemperature is
 *  exported only when there is no Hot/Cold choice — that is the one case
 *  where the customer site needs to know the fixed serving temperature.
 *  sizes ride along only when hasSizes is true (the flag is the switch). */
export function toPublicProduct(p: ProductRow): PublicProduct {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    image: p.image,
    available: p.available,
    hasTemperature: p.hasTemperature,
    defaultTemperature: p.hasTemperature
      ? null
      : asTemperature(p.defaultTemperature),
    hasSizes: p.hasSizes,
    sizes: p.hasSizes ? parseProductSizes(p.sizes) : [],
    hasFields: p.hasFields,
    fields: p.hasFields ? parseProductFields(p.fields) : [],
    category: p.category,
  };
}

function serializeItem(i: ItemRow): OrderItem {
  return {
    productId: i.productId,
    productName: i.productName,
    temperature: asTemperature(i.temperature),
    size: typeof i.size === "string" && i.size !== "" ? i.size : null,
    answers: parseOrderAnswers(i.answers),
    quantity: i.quantity,
    price: i.price,
    subtotal: i.subtotal,
  };
}

export function serializeOrder(o: OrderRow): Order {
  return {
    orderId: o.orderId,
    customerName: o.customerName,
    customerAlias: o.customerAlias,
    customerEmail: o.customerEmail,
    items: o.items.map(serializeItem),
    total: o.total,
    paymentMethod: o.paymentMethod as PaymentMethod,
    paymentStatus: o.paymentStatus as PaymentStatus,
    orderStatus: o.orderStatus as OrderStatus,
    abortReason: o.abortReason,
    createdAt: o.createdAt.toISOString(),
    scannedAt: o.scannedAt ? o.scannedAt.toISOString() : null,
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
  };
}

export function serializeBooth(b: BoothRow): BoothSettings {
  return {
    boothName: b.boothName,
    startDate: b.startDate.toISOString(),
    endDate: b.endDate.toISOString(),
    totalCost: b.totalCost,
    gcashNumber: b.gcashNumber,
    gcashPayment: b.gcashPayment,
    orderingEnabled: b.orderingEnabled,
    specsNumber: b.specsNumber,
    contactEmail: b.contactEmail,
    clientSiteUrl: b.clientSiteUrl,
  };
}

/* ------------------------------------------------------------------ */
/* Booth settings & state                                              */
/* ------------------------------------------------------------------ */

export async function getBoothRow(): Promise<BoothRow> {
  const row = await db.booth.findFirst();
  if (!row) {
    // Seeded invariant violation — surface as a generic 500 via errorResponse.
    throw new Error("Booth settings row is missing (run prisma seed)");
  }
  return row;
}

export function boothStateOf(settings: BoothSettings, now: Date = new Date()): BoothState {
  const t = now.getTime();
  if (t < new Date(settings.startDate).getTime()) return "BEFORE";
  if (t > new Date(settings.endDate).getTime()) return "CLOSED";
  return "OPEN";
}

/** Local calendar-day key, e.g. 2026-09-04. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local wall-clock key, e.g. 14:23. */
export function localTimeKey(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

/** Parse `day` query param: "1".."N" → booth day number, otherwise null (no filter). */
export function parseDayFilter(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * How many calendar days the booth run spans, inclusive (local server
 * time), derived from the booth dates — the run length is data, not a
 * constant. Day 1 = the calendar date of startDate. Minimum 1 so a
 * same-day or inverted range still yields one day.
 */
export function boothDayCount(startDate: Date, endDate: Date): number {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return diff >= 1 ? diff : 1;
}

/**
 * Calendar window for a booth day (local server time).
 * day 1 = the calendar date of booth.startDate, day 2 = the next date, etc.
 * Out-of-range days (day < 1 or past the last booth day) return null —
 * callers treat that as "no filter" instead of an empty window.
 */
export function dayWindowFrom(
  startDate: Date,
  day: number,
  dayCount: number
): { start: Date; end: Date } | null {
  if (!Number.isInteger(day) || day < 1 || day > dayCount) return null;
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + (day - 1));
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/* ------------------------------------------------------------------ */
/* ID generators (sequential, zero-padded to 4)                        */
/* ------------------------------------------------------------------ */

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/** ORD-0001… — next sequence = max existing suffix + 1 (≥ count + 1). */
export async function nextOrderId(): Promise<string> {
  const rows = await db.order.findMany({ select: { orderId: true } });
  let max = 0;
  for (const row of rows) {
    const match = /^ORD-(\d+)$/.exec(row.orderId);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `ORD-${pad4(max + 1)}`;
}

/**
 * Duplicate-friendly id: the SAME customer QR can be scanned again to add
 * another copy of the order. The first scan keeps the client id as-is;
 * each extra scan gets `-2`, `-3`, … appended (e.g. ORD-K7F2Q9-2).
 */
export async function uniqueOrderId(baseId: string): Promise<string> {
  let candidate = baseId;
  let n = 1;
  // Find the smallest free suffix (2, 3, …) that isn't taken yet.
  while (await findOrderRow(candidate)) {
    n += 1;
    candidate = `${baseId}-${n}`;
  }
  return candidate;
}

/* ------------------------------------------------------------------ */
/* Order queries                                                       */
/* ------------------------------------------------------------------ */

const VALID_STATUSES: readonly string[] = ["PENDING", "WAITING", "SERVED", "ABORTED"];

export async function findOrderRow(orderId: string): Promise<OrderRow | null> {
  return db.order.findUnique({ where: { orderId }, include: { items: true } });
}

export interface ListOrdersOptions {
  status?: string | null;
  q?: string | null;
  day: number | null;
}

/** Booth order list: newest first, with items. status/q/day filters. */
export async function listOrders(opts: ListOrdersOptions): Promise<Order[]> {
  const booth = await getBoothRow();
  const dayCount = boothDayCount(booth.startDate, booth.endDate);
  const window =
    opts.day !== null && opts.day !== undefined
      ? dayWindowFrom(booth.startDate, opts.day, dayCount)
      : null;
  const status =
    opts.status && VALID_STATUSES.includes(opts.status) ? opts.status : undefined;

  const rows = await db.order.findMany({
    where: {
      ...(status ? { orderStatus: status } : {}),
      ...(window ? { createdAt: { gte: window.start, lt: window.end } } : {}),
    },
    include: { items: true },
    orderBy: [{ createdAt: "desc" }, { orderId: "desc" }],
  });

  const needle = opts.q ? opts.q.trim().toLowerCase() : "";
  if (needle) {
    const filtered = rows.filter(
      (r) =>
        r.orderId.toLowerCase().includes(needle) ||
        r.customerName.toLowerCase().includes(needle) ||
        r.customerAlias.toLowerCase().includes(needle) ||
        r.customerEmail.toLowerCase().includes(needle)
    );
    return filtered.map(serializeOrder);
  }
  return rows.map(serializeOrder);
}

/* ------------------------------------------------------------------ */
/* Product buyers (dashboard drill-down)                                */
/* ------------------------------------------------------------------ */

/**
 * Every customer who bought `productId`, newest orders first.
 * One row per ORDER LINE — since the smarter ordering update an order can
 * carry a separate HOT and a COLD line for the same product, so that order
 * appears twice (once per temperature, each with its own quantity /
 * subtotal) plus the order's full customer credentials.
 */
export async function listProductBuyers(productId: string): Promise<ProductBuyer[]> {
  const rows = await db.orderItem.findMany({
    where: { productId },
    include: { order: true },
    orderBy: [{ order: { createdAt: "desc" } }, { id: "desc" }],
  });

  return rows.map((r) => ({
    orderId: r.order.orderId,
    customerName: r.order.customerName,
    customerAlias: r.order.customerAlias,
    customerEmail: r.order.customerEmail,
    quantity: r.quantity,
    temperature: asTemperature(r.temperature),
    size: typeof r.size === "string" && r.size !== "" ? r.size : null,
    answers: parseOrderAnswers(r.answers),
    subtotal: r.subtotal,
    paymentMethod: r.order.paymentMethod as PaymentMethod,
    paymentStatus: r.order.paymentStatus as PaymentStatus,
    orderStatus: r.order.orderStatus as OrderStatus,
    orderTotal: r.order.total,
    createdAt: r.order.createdAt.toISOString(),
    scannedAt: r.order.scannedAt ? r.order.scannedAt.toISOString() : null,
    completedAt: r.order.completedAt ? r.order.completedAt.toISOString() : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

interface ProductAgg {
  productId: string;
  name: string;
  sold: number;
  revenue: number;
  hot: number;
  cold: number;
  bySize: Map<string, { sold: number; revenue: number }>;
}

/** One ProductStat row - zeros + full size menu when there are no sales. */
function toProductStat(
  productId: string,
  name: string,
  agg?: ProductAgg,
  menuSizes: ProductSize[] = []
): ProductStat {
  const buckets = new Map<string, { sold: number; revenue: number }>();
  for (const s of menuSizes) buckets.set(s.name, { sold: 0, revenue: 0 });
  if (agg) {
    for (const [key, v] of agg.bySize) {
      const entry = buckets.get(key) ?? { sold: 0, revenue: 0 };
      entry.sold += v.sold;
      entry.revenue += v.revenue;
      buckets.set(key, entry);
    }
  }
  const menuNames = new Set(menuSizes.map((s) => s.name));
  const sizes: SizeStat[] = [
    // Defined sizes first, in menu order - zeros included so every size total stays visible.
    ...menuSizes.map((s) => ({
      name: s.name,
      ...(buckets.get(s.name) ?? { sold: 0, revenue: 0 }),
    })),
    // Extras last: pre-size lines ('No size') and renamed sizes.
    ...Array.from(buckets.entries())
      .filter(([key]) => !menuNames.has(key))
      .map(([sizeName, v]) => ({ name: sizeName, sold: v.sold, revenue: v.revenue }))
      .sort((x, y) => y.sold - x.sold || x.name.localeCompare(y.name)),
  ];
  // No size menu + nothing but pre-size lines: drop the lone 'No size' bucket.
  const meaningful =
    menuSizes.length === 0 &&
    (sizes.length === 0 || (sizes.length === 1 && sizes[0].name === 'No size'))
      ? []
      : sizes;
  return {
    productId,
    name,
    sold: agg?.sold ?? 0,
    revenue: agg?.revenue ?? 0,
    sizes: meaningful,
  };
}

/**
 * Aggregate dashboard stats.
 * `day` filters orders by creation day window (same rule as /api/orders).
 * Only SERVED orders contribute revenue / items.
 * Net Profit = Revenue − Total Cost (the amount the admin typed in the
 * Total Cost box — stock, per-product costs and expense ledgers are gone).
 */
export async function computeDashboard(day: number | null): Promise<DashboardStats> {
  const booth = await getBoothRow();
  const dayCount = boothDayCount(booth.startDate, booth.endDate);
  const window =
    day !== null && day !== undefined
      ? dayWindowFrom(booth.startDate, day, dayCount)
      : null;

  const orders = await db.order.findMany({
    where: window ? { createdAt: { gte: window.start, lt: window.end } } : undefined,
    include: { items: true },
  });
  const products = await db.product.findMany({ orderBy: { id: "asc" } });

  const served = orders.filter((o) => o.orderStatus === "SERVED");

  const revenue = served.reduce((sum, o) => sum + o.total, 0);
  const ordersServed = served.length;
  const ordersWaiting = orders.filter((o) => o.orderStatus === "WAITING").length;
  const ordersAborted = orders.filter((o) => o.orderStatus === "ABORTED").length;
  const ordersPending = orders.filter((o) => o.orderStatus === "PENDING").length;

  const aggById = new Map<string, ProductAgg>();
  let itemsSold = 0;

  for (const order of served) {
    for (const item of order.items) {
      itemsSold += item.quantity;

      const agg = aggById.get(item.productId) ?? {
        productId: item.productId,
        name: item.productName,
        sold: 0,
        revenue: 0,
        hot: 0,
        cold: 0,
        bySize: new Map(),
      };
      agg.sold += item.quantity;
      agg.revenue += item.subtotal;
      if (item.temperature === "HOT") agg.hot += item.quantity;
      else if (item.temperature === "COLD") agg.cold += item.quantity;
      // Size comparison bucket — pre-size lines land in "No size" so the
      // breakdown always reconciles with the product totals.
      const sizeKey = item.size && item.size !== "" ? item.size : "No size";
      const sizeEntry = agg.bySize.get(sizeKey) ?? { sold: 0, revenue: 0 };
      sizeEntry.sold += item.quantity;
      sizeEntry.revenue += item.subtotal;
      agg.bySize.set(sizeKey, sizeEntry);
      aggById.set(item.productId, agg);
    }
  }

  const totalCost = booth.totalCost;
  const netProfit = revenue - totalCost;
  const roi = totalCost > 0 ? Math.round((netProfit / totalCost) * 10000) / 100 : 0;

  const productStats: ProductStat[] = [
    // Every catalog product, even with zero sales — the dashboard lists
    // the full menu with 0s instead of an empty table before opening.
    ...products.map((p) =>
      toProductStat(
        p.id,
        p.name,
        aggById.get(p.id),
        p.hasSizes ? parseProductSizes(p.sizes) : []
      )
    ),
    // Lines for products off the menu (unknown / since deleted) — real
    // sales that belong nowhere else.
    ...Array.from(aggById.values())
      .filter((a) => a.sold > 0 && !products.some((p) => p.id === a.productId))
      .map((a) => toProductStat(a.productId, a.name, a)),
  ].sort((x, y) => y.sold - x.sold || x.name.localeCompare(y.name));
  const top = productStats[0];
  const bestSeller: DashboardStats["bestSeller"] =
    top && top.sold > 0 ? { name: top.name, sold: top.sold } : null;

  const hotCold: HotColdStat[] = products
    .filter((p) => p.hasTemperature)
    .map((p) => {
      const agg = aggById.get(p.id);
      return { productId: p.id, name: p.name, hot: agg?.hot ?? 0, cold: agg?.cold ?? 0 };
    });

  let gcash = 0;
  let boothRevenue = 0;
  for (const order of served) {
    if (order.paymentMethod === "GCASH") gcash += order.total;
    else boothRevenue += order.total;
  }

  const dailyMap = new Map<string, { revenue: number; orders: number }>();
  for (const order of served) {
    if (!order.completedAt) continue;
    const key = localDateKey(order.completedAt);
    const entry = dailyMap.get(key) ?? { revenue: 0, orders: 0 };
    entry.revenue += order.total;
    entry.orders += 1;
    dailyMap.set(key, entry);
  }
  const dailySales: DailySalesStat[] = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, revenue: v.revenue, orders: v.orders }));

  // Time-of-day demand — WHEN people buy, bucketed by local wall-clock hour
  // of the moment the order was scanned/registered at the booth.
  // buyers = every non-aborted order (a person who bought, served or still
  // waiting); items/revenue = SERVED orders only, consistent with the rest
  // of the dashboard. Buckets: Morning 5–11:59, Afternoon 12–17:59,
  // Evening 18–22:59, Night 23–04:59.
  const timeAgg: Record<
    TimeOfDayBucket,
    { buyers: number; items: number; revenue: number }
  > = {
    MORNING: { buyers: 0, items: 0, revenue: 0 },
    AFTERNOON: { buyers: 0, items: 0, revenue: 0 },
    EVENING: { buyers: 0, items: 0, revenue: 0 },
    NIGHT: { buyers: 0, items: 0, revenue: 0 },
  };
  for (const order of orders) {
    if (order.orderStatus === "ABORTED") continue;
    const when = order.scannedAt ?? order.createdAt;
    const hour = when.getHours();
    const bucket: TimeOfDayBucket =
      hour >= 5 && hour < 12
        ? "MORNING"
        : hour >= 12 && hour < 18
          ? "AFTERNOON"
          : hour >= 18 && hour < 23
            ? "EVENING"
            : "NIGHT";
    timeAgg[bucket].buyers += 1;
    if (order.orderStatus === "SERVED") {
      timeAgg[bucket].revenue += order.total;
      for (const item of order.items) timeAgg[bucket].items += item.quantity;
    }
  }
  const timeOfDay: TimeOfDayStat[] = (
    ["MORNING", "AFTERNOON", "EVENING", "NIGHT"] as const
  ).map((bucket) => ({ bucket, ...timeAgg[bucket] }));

  // Fulfillment times - scan-to-serve durations, the recorded counterpart
  // of the waiting line's live timers. Only SERVED orders with both ends
  // of the interval contribute; aborted orders never completed.
  const durations: { secs: number; productIds: string[]; productNames: Map<string, string> }[] = [];
  for (const order of served) {
    if (!order.completedAt) continue;
    const start = order.scannedAt ?? order.createdAt;
    const secs = (order.completedAt.getTime() - start.getTime()) / 1000;
    if (!Number.isFinite(secs) || secs < 0) continue;
    const seen = new Map<string, string>();
    for (const item of order.items) {
      if (!seen.has(item.productId)) seen.set(item.productId, item.productName);
    }
    durations.push({ secs, productIds: [...seen.keys()], productNames: seen });
  }
  const sortedSecs = durations.map((d) => d.secs).sort((a, b) => a - b);
  const serveCount = sortedSecs.length;
  const serveAvg =
    serveCount > 0 ? sortedSecs.reduce((sum, s) => sum + s, 0) / serveCount : 0;
  const serveMedian =
    serveCount === 0
      ? 0
      : serveCount % 2 === 1
        ? sortedSecs[Math.floor(serveCount / 2)]
        : (sortedSecs[serveCount / 2 - 1] + sortedSecs[serveCount / 2]) / 2;
  const serveTimes: ServeTimeStats = {
    summary: {
      count: serveCount,
      avgSecs: Math.round(serveAvg),
      medianSecs: Math.round(serveMedian),
      minSecs: serveCount > 0 ? Math.round(sortedSecs[0]) : 0,
      maxSecs: serveCount > 0 ? Math.round(sortedSecs[serveCount - 1]) : 0,
    },
    byProduct: Array.from(
      durations
        .reduce((map, d) => {
          for (const pid of d.productIds) {
            const entry = map.get(pid) ?? {
              productId: pid,
              name: d.productNames.get(pid) ?? pid,
              totalSecs: 0,
              orders: 0,
            };
            entry.totalSecs += d.secs;
            entry.orders += 1;
            map.set(pid, entry);
          }
          return map;
        }, new Map<string, { productId: string; name: string; totalSecs: number; orders: number }>())
        .values()
    )
      .map((e) => ({
        productId: e.productId,
        name: e.name,
        orders: e.orders,
        avgSecs: Math.round(e.totalSecs / e.orders),
      }))
      .sort((a, b) => b.avgSecs - a.avgSecs || b.orders - a.orders),
    buckets: [
      { label: "Under 1 min", maxSecs: 60 },
      { label: "1-3 min", maxSecs: 180 },
      { label: "3-5 min", maxSecs: 300 },
      { label: "5-10 min", maxSecs: 600 },
      { label: "Over 10 min", maxSecs: Number.POSITIVE_INFINITY },
    ].map((b, i, all) => {
      const minSecs = i === 0 ? 0 : all[i - 1].maxSecs;
      return {
        ...b,
        count: sortedSecs.filter((s) => s >= minSecs && s < b.maxSecs).length,
      };
    }),
  };

  return {
    revenue,
    ordersServed,
    ordersWaiting,
    ordersAborted,
    ordersPending,
    itemsSold,
    totalCost,
    netProfit,
    roi,
    bestSeller,
    productStats,
    hotCold,
    paymentBreakdown: { gcash, booth: boothRevenue },
    dailySales,
    timeOfDay,
    serveTimes,
  };
}
