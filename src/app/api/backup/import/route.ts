// POST /api/backup/import — ADMIN: bring a backup file's data in.
//
// Two modes (body.mode):
//   "merge"   (default, safe) — add what's missing: products are created
//             or updated by ID, orders whose orderId already exists are
//             SKIPPED, settings are left untouched. 100 orders + a 2-order
//             file = 102 orders, never duplicates.
//   "replace" (disaster recovery) — wipe everything first, then recreate
//             the file's contents, settings included. One transaction:
//             all or nothing.
//
// Older backups always restore into today's schema via safe defaults;
// structural problems fail the whole import with a 400 and touch nothing.
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { errorResponse, fail, readJson, unauthorized } from "@/app/api/_lib/http";
import { parseOrderAnswers, parseProductFields, parseProductSizes } from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

const ORDER_ID_RE = /^ORD-[A-Z0-9-]{1,20}$/i;
const MAX_PRODUCTS = 500;
const MAX_ORDERS = 10000;

function asTrimmedString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

function asIntOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : fallback;
}

function asDateOrNull(v: unknown): Date | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface CleanItem {
  productId: string;
  productName: string;
  temperature: string | null;
  size: string | null;
  answers: string;
  quantity: number;
  price: number;
  subtotal: number;
}

/**
 * Re-derive every touched product's `sold` counter from SERVED lines.
 * Imports bypass the serve endpoint (the only other writer of `sold`),
 * so without this the counters silently drift — for karaoke songs and
 * every other product alike. Unknown productIds are skipped (updateMany
 * never throws on a miss).
 */
async function recountSold(
  tx: Prisma.TransactionClient,
  productIds: string[]
): Promise<void> {
  if (productIds.length === 0) return;
  const sums = await tx.orderItem.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, order: { orderStatus: "SERVED" } },
    _sum: { quantity: true },
  });
  for (const pid of productIds) {
    const found = sums.find((s) => s.productId === pid);
    await tx.product.updateMany({
      where: { id: pid },
      data: { sold: found?._sum.quantity ?? 0 },
    });
  }
}

export async function POST(req: Request) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const body = await readJson(req);
    if (!body) fail(400, "Invalid JSON body");
    const data = (body as Record<string, unknown>).data ?? body;

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail(400, "Body must be the backup object { products, orders, settings }");
    }
    const backup = data as Record<string, unknown>;
    if (!Array.isArray(backup.products)) fail(400, "Backup has no products array");
    if (!Array.isArray(backup.orders)) fail(400, "Backup has no orders array");
    if (backup.products.length > MAX_PRODUCTS) fail(400, "Backup has too many products");
    if (backup.orders.length > MAX_ORDERS) fail(400, "Backup has too many orders");

    // ---- Products -------------------------------------------------
    const products = backup.products.map((p: unknown, i: number) => {
      if (!p || typeof p !== "object") fail(400, `products[${i}] is not an object`);
      const rec = p as Record<string, unknown>;
      const id = asTrimmedString(rec.id, 20);
      if (!id) fail(400, `products[${i}] needs an id`);
      const name = asTrimmedString(rec.name, 80) ?? "Unnamed product";
      const temperature =
        rec.defaultTemperature === "HOT" || rec.defaultTemperature === "COLD"
          ? rec.defaultTemperature
          : null;
      const hasSizes = rec.hasSizes === true;
      const hasFields = rec.hasFields === true;
      return {
        id: id.toUpperCase(),
        name,
        description: typeof rec.description === "string" ? rec.description.slice(0, 300) : "",
        price: asIntOr(rec.price, 0),
        image: typeof rec.image === "string" ? rec.image : "",
        available: rec.available !== false,
        hasTemperature: rec.hasTemperature === true,
        defaultTemperature: rec.hasTemperature === true ? null : temperature,
        hasSizes,
        sizes: hasSizes ? JSON.stringify(parseProductSizes(typeof rec.sizes === "string" ? rec.sizes : JSON.stringify(rec.sizes ?? []))) : "[]",
        hasFields,
        fields: hasFields ? JSON.stringify(parseProductFields(typeof rec.fields === "string" ? rec.fields : JSON.stringify(rec.fields ?? []))) : "[]",
        category: asTrimmedString(rec.category, 60) ?? "Drinks",
        sold: asIntOr(rec.sold, 0),
      };
    });

    // ---- Orders ---------------------------------------------------
    const orders = backup.orders.map((o: unknown, i: number) => {
      if (!o || typeof o !== "object") fail(400, `orders[${i}] is not an object`);
      const rec = o as Record<string, unknown>;
      if (typeof rec.orderId !== "string" || !ORDER_ID_RE.test(rec.orderId.trim())) {
        fail(400, `orders[${i}] needs a valid orderId`);
      }
      if (!Array.isArray(rec.items)) fail(400, `orders[${i}] needs an items array`);
      const items: CleanItem[] = (rec.items as unknown[]).map((it: unknown, j: number) => {
        if (!it || typeof it !== "object") fail(400, `orders[${i}].items[${j}] is not an object`);
        const row = it as Record<string, unknown>;
        const quantity =
          typeof row.quantity === "number" && Number.isInteger(row.quantity) && row.quantity >= 1
            ? row.quantity
            : 1;
        return {
          productId: asTrimmedString(row.productId, 20) ?? asTrimmedString(row.productName, 80) ?? "UNKNOWN",
          productName: asTrimmedString(row.productName, 80) ?? "Unknown item",
          temperature: row.temperature === "HOT" || row.temperature === "COLD" ? row.temperature : null,
          size: asTrimmedString(row.size, 20),
          answers: JSON.stringify(parseOrderAnswers(typeof row.answers === "string" ? row.answers : JSON.stringify(row.answers ?? []))),
          quantity,
          price: asIntOr(row.price, 0),
          subtotal: asIntOr(row.subtotal, asIntOr(row.price, 0) * quantity),
        };
      });
      const validStatus = (v: unknown, allowed: string[], fallback: string) =>
        typeof v === "string" && allowed.includes(v) ? v : fallback;
      return {
        orderId: (rec.orderId as string).trim().toUpperCase(),
        customerName: asTrimmedString(rec.customerName, 100) ?? "",
        customerAlias: asTrimmedString(rec.customerAlias, 40) ?? "",
        customerEmail: asTrimmedString(rec.customerEmail, 120)?.toLowerCase() ?? "",
        total: asIntOr(rec.total, items.reduce((sum, it) => sum + it.subtotal, 0)),
        paymentMethod: validStatus(rec.paymentMethod, ["GCASH", "BOOTH"], "BOOTH"),
        paymentStatus: validStatus(rec.paymentStatus, ["UNPAID", "PAID"], "UNPAID"),
        orderStatus: validStatus(rec.orderStatus, ["PENDING", "WAITING", "SERVED", "ABORTED"], "PENDING"),
        abortReason: asTrimmedString(rec.abortReason, 200),
        createdAt: asDateOrNull(rec.createdAt) ?? new Date(),
        scannedAt: asDateOrNull(rec.scannedAt),
        completedAt: asDateOrNull(rec.completedAt),
        items,
      };
    });

    // ---- Settings (optional — file may hold products/orders only) --
    let settings: Record<string, unknown> | null = null;
    if (backup.settings !== undefined && backup.settings !== null) {
      if (typeof backup.settings !== "object" || Array.isArray(backup.settings)) {
        fail(400, "Backup settings is not an object");
      }
      settings = backup.settings as Record<string, unknown>;
    }

    // ---- Replace inside one transaction ---------------------------
    const mode = (body as Record<string, unknown>).mode === "replace" ? "replace" : "merge";
    let productsAdded = 0;
    let productsUpdated = 0;
    let ordersAdded = 0;
    let ordersSkipped = 0;

    if (mode === "merge") {
      await db.$transaction(async (tx) => {
        const touched = new Set<string>();
        for (const p of products) {
          const exists = await tx.product.findUnique({ where: { id: p.id } });
          if (exists) {
            const { id, ...fields } = p;
            await tx.product.update({ where: { id }, data: fields });
            productsUpdated += 1;
          } else {
            await tx.product.create({ data: p });
            productsAdded += 1;
          }
          touched.add(p.id);
        }
        for (const o of orders) {
          const exists = await tx.order.findUnique({ where: { orderId: o.orderId } });
          if (exists) {
            ordersSkipped += 1;
            continue;
          }
          const { items, ...orderData } = o;
          await tx.order.create({
            data: {
              ...orderData,
              items: {
                create: items.map((it) => ({
                  productId: it.productId,
                  productName: it.productName,
                  temperature: it.temperature,
                  size: it.size,
                  answers: it.answers,
                  quantity: it.quantity,
                  price: it.price,
                  subtotal: it.subtotal,
                })),
              },
            },
          });
          ordersAdded += 1;
          for (const it of items) touched.add(it.productId);
        }
        // Sold counters bypass the serve endpoint on import — re-derive
        // them from SERVED lines so every product (karaoke included)
        // reports truth instead of the file's snapshot value.
        await recountSold(tx, [...touched]);
      });
      return NextResponse.json({ ok: true, mode, productsAdded, productsUpdated, ordersAdded, ordersSkipped });
    }

    await db.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.product.deleteMany({});
      const touched = new Set<string>();
      for (const p of products) {
        await tx.product.create({ data: p });
        touched.add(p.id);
      }
      for (const o of orders) {
        const { items, ...orderData } = o;
        await tx.order.create({
          data: {
            ...orderData,
            items: {
              create: items.map((it) => ({
                productId: it.productId,
                productName: it.productName,
                temperature: it.temperature,
                size: it.size,
                answers: it.answers,
                quantity: it.quantity,
                price: it.price,
                subtotal: it.subtotal,
              })),
            },
          },
        });
        for (const it of o.items) touched.add(it.productId);
      }
      // Same recount as merge — file snapshot values are advisory only.
      await recountSold(tx, [...touched]);
      if (settings) {
        const startDate = asDateOrNull(settings.startDate) ?? new Date();
        const rawEnd = asDateOrNull(settings.endDate);
        // Fallbacks only trigger on corrupt files — real backups always
        // carry valid dates (endDate must be after startDate).
        const endDate =
          rawEnd && rawEnd.getTime() > startDate.getTime()
            ? rawEnd
            : new Date(startDate.getTime() + 3 * 86_400_000);
        const boothData = {
          boothName: asTrimmedString(settings.boothName, 80) ?? "Coffee++",
          startDate,
          endDate,
          totalCost: asIntOr(settings.totalCost, 0),
          gcashNumber: typeof settings.gcashNumber === "string" ? settings.gcashNumber.trim() : "",
          gcashPayment: settings.gcashPayment !== false,
          orderingEnabled: settings.orderingEnabled !== false,
          specsNumber: typeof settings.specsNumber === "string" ? settings.specsNumber.trim() : "",
          contactEmail: typeof settings.contactEmail === "string" ? settings.contactEmail.trim() : "",
          clientSiteUrl: typeof settings.clientSiteUrl === "string" ? settings.clientSiteUrl.trim() : "",
        };
        const existing = await tx.booth.findFirst();
        if (existing) {
          await tx.booth.update({ where: { id: existing.id }, data: boothData });
        } else {
          await tx.booth.create({ data: { id: "main", ...boothData } });
        }
      }
    });

    return NextResponse.json({
      ok: true,
      mode,
      productsAdded: products.length,
      productsUpdated: 0,
      ordersAdded: orders.length,
      ordersSkipped: 0,
    });
  } catch (err) {
    return errorResponse(err, "POST /api/backup/import");
  }
}
