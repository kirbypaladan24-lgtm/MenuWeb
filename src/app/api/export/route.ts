// GET /api/export — ADMIN: Excel .xlsx download with 4 sheets
// (Orders, Order Items, Product Summary, Dashboard)
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { errorResponse, unauthorized } from "@/app/api/_lib/http";
import {
  computeDashboard,
  localDateKey,
  localTimeKey,
} from "@/app/api/_lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = requireRole(req, "ADMIN");
    if (!session) return unauthorized();

    const orders = await db.order.findMany({
      include: { items: true },
      orderBy: [{ createdAt: "asc" }, { orderId: "asc" }],
    });
    const stats = await computeDashboard(null);

    /* Sheet 1 — Orders (all statuses) */
    const ordersSheet: (string | number)[][] = [
      [
        "Order ID",
        "Customer",
        "Call-out Name",
        "Email",
        "Created Date",
        "Created Time",
        "Completed Date",
        "Completed Time",
        "Payment Method",
        "Payment Status",
        "Order Status",
        "Total",
      ],
    ];
    for (const o of orders) {
      ordersSheet.push([
        o.orderId,
        o.customerName,
        o.customerAlias,
        o.customerEmail,
        localDateKey(o.createdAt),
        localTimeKey(o.createdAt),
        o.completedAt ? localDateKey(o.completedAt) : "",
        o.completedAt ? localTimeKey(o.completedAt) : "",
        o.paymentMethod,
        o.paymentStatus,
        o.orderStatus,
        o.total,
      ]);
    }

    /* Sheet 2 — Order Items (all orders, snapshot data) */
    const itemsSheet: (string | number)[][] = [
      ["Order ID", "Product ID", "Product", "Temperature", "Quantity", "Price", "Subtotal"],
    ];
    for (const o of orders) {
      for (const item of o.items) {
        itemsSheet.push([
          o.orderId,
          item.productId,
          item.productName,
          item.temperature ?? "",
          item.quantity,
          item.price,
          item.subtotal,
        ]);
      }
    }

    /* Sheet 3 — Product Summary (SERVED only, sold > 0) */
    interface Summary {
      name: string;
      sold: number;
      revenue: number;
    }
    const summaryById = new Map<string, Summary>();
    for (const o of orders) {
      if (o.orderStatus !== "SERVED") continue;
      for (const item of o.items) {
        const entry =
          summaryById.get(item.productId) ??
          { name: item.productName, sold: 0, revenue: 0 };
        entry.sold += item.quantity;
        entry.revenue += item.subtotal;
        summaryById.set(item.productId, entry);
      }
    }
    const productSheet: (string | number)[][] = [
      ["Product", "Quantity Sold", "Revenue"],
    ];
    for (const entry of Array.from(summaryById.values())
      .filter((s) => s.sold > 0)
      .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name))) {
      productSheet.push([entry.name, entry.sold, entry.revenue]);
    }

    /* Sheet 4 — Dashboard */
    const bestSellerText = stats.bestSeller
      ? `${stats.bestSeller.name} (${stats.bestSeller.sold} sold)`
      : "—";
    const dashboardSheet: (string | number)[][] = [
      ["Total Revenue", stats.revenue],
      ["Total Cost (typed by admin)", stats.totalCost],
      ["Net Profit", stats.netProfit],
      ["ROI %", stats.roi],
      ["Total Orders (served)", stats.ordersServed],
      ["Total Items Sold", stats.itemsSold],
      ["Best Seller", bestSellerText],
      ["GCash Revenue", stats.paymentBreakdown.gcash],
      ["Pay-at-Booth Revenue", stats.paymentBreakdown.booth],
    ];

    /* Build workbook — with generous, data-aware column widths */
    /**
     * Auto-fit columns so Excel never cuts data off: each column is sized
     * to its longest cell (header or value) + padding, clamped to a sane
     * range (min 10, max 48 chars).
     */
    const autoFitColumns = (
      sheet: XLSX.WorkSheet,
      rows: (string | number)[][],
    ) => {
      const widths: number[] = [];
      for (const row of rows) {
        row.forEach((cell, col) => {
          const len = String(cell ?? "").length;
          widths[col] = Math.max(widths[col] ?? 0, len);
        });
      }
      sheet["!cols"] = widths.map(
        (w) => ({ wch: Math.min(Math.max(w + 3, 10), 48) }),
      );
    };

    const ordersWs = XLSX.utils.aoa_to_sheet(ordersSheet);
    autoFitColumns(ordersWs, ordersSheet);
    const itemsWs = XLSX.utils.aoa_to_sheet(itemsSheet);
    autoFitColumns(itemsWs, itemsSheet);
    const productWs = XLSX.utils.aoa_to_sheet(productSheet);
    autoFitColumns(productWs, productSheet);
    const dashboardWs = XLSX.utils.aoa_to_sheet(dashboardSheet);
    autoFitColumns(dashboardWs, dashboardSheet);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ordersWs, "Orders");
    XLSX.utils.book_append_sheet(workbook, itemsWs, "Order Items");
    XLSX.utils.book_append_sheet(workbook, productWs, "Product Summary");
    XLSX.utils.book_append_sheet(workbook, dashboardWs, "Dashboard");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const filename = `CoffeePP_Sales_${localDateKey(new Date())}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return errorResponse(err, "GET /api/export");
  }
}
