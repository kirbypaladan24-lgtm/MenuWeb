// Coffee++ API — domain service layer (private to src/app/api/**)
// Serializers map Prisma rows to the shared types in src/lib/types.ts.
import { db } from "@/lib/db";
import type { Prisma, Product as ProductRow, Booth as BoothRow, OrderItem as ItemRow } from "@prisma/client";
import type {
  BoothSettings,
  BoothState,
  DashboardStats,
  DailySalesStat,
  HotColdStat,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductStat,
  PublicProduct,
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
    category: p.category,
    sold: p.sold,
  };
}

/** Customer-safe product: sold count omitted. defaultTemperature is
 *  exported only when there is no Hot/Cold choice — that is the one case
 *  where the customer site needs to know the fixed serving temperature. */
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
    category: p.category,
  };
}

function serializeItem(i: ItemRow): OrderItem {
  return {
    productId: i.productId,
    productName: i.productName,
    temperature: asTemperature(i.temperature),
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

/** Parse `day` query param: "1"|"2"|"3" → booth day, otherwise null (no filter). */
export function parseDayFilter(raw: string | null): 1 | 2 | 3 | null {
  if (raw === "1" || raw === "2" || raw === "3") {
    return Number(raw) as 1 | 2 | 3;
  }
  return null; // "all", "", or anything else
}

/**
 * Calendar window for a booth day (local server time).
 * day 1 = the calendar date of booth.startDate, day 2 = the next date, etc.
 */
export function dayWindowFrom(startDate: Date, day: 1 | 2 | 3): { start: Date; end: Date } {
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
  day: 1 | 2 | 3 | null;
}

/** Booth order list: newest first, with items. status/q/day filters. */
export async function listOrders(opts: ListOrdersOptions): Promise<Order[]> {
  const booth = await getBoothRow();
  const window = opts.day ? dayWindowFrom(booth.startDate, opts.day) : null;
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
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/**
 * Aggregate dashboard stats.
 * `day` filters orders by creation day window (same rule as /api/orders).
 * Only SERVED orders contribute revenue / items.
 * Net Profit = Revenue − Total Cost (the amount the admin typed in the
 * Total Cost box — stock, per-product costs and expense ledgers are gone).
 */
export async function computeDashboard(day: 1 | 2 | 3 | null): Promise<DashboardStats> {
  const booth = await getBoothRow();
  const window = day ? dayWindowFrom(booth.startDate, day) : null;

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

  interface Agg {
    productId: string;
    name: string;
    sold: number;
    revenue: number;
    hot: number;
    cold: number;
  }

  const aggById = new Map<string, Agg>();
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
      };
      agg.sold += item.quantity;
      agg.revenue += item.subtotal;
      if (item.temperature === "HOT") agg.hot += item.quantity;
      else if (item.temperature === "COLD") agg.cold += item.quantity;
      aggById.set(item.productId, agg);
    }
  }

  const totalCost = booth.totalCost;
  const netProfit = revenue - totalCost;
  const roi = totalCost > 0 ? Math.round((netProfit / totalCost) * 10000) / 100 : 0;

  const productStats: ProductStat[] = Array.from(aggById.values())
    .filter((a) => a.sold > 0)
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name))
    .map((a) => ({
      productId: a.productId,
      name: a.name,
      sold: a.sold,
      revenue: a.revenue,
    }));
  const top = productStats[0];
  const bestSeller: DashboardStats["bestSeller"] = top ? { name: top.name, sold: top.sold } : null;

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
  };
}
