"use client";

// Product buyers — dashboard drill-down. Pressing a product card on the
// dashboard opens this dialog: every customer who bought THAT product, one
// table row per order, with the full customer credentials (call-out name,
// name, email), this product's line-item details (qty / temp / subtotal),
// payment + order status, and timestamps. Search, status filter, sortable
// columns and Excel / CSV export keep the table flexible and organized.

import * as React from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  Search,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyEmailButton } from "@/components/shared/copy-email-button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/shared/status-badge";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  formatDateTime,
  formatPeso,
  paymentMethodLabel,
  shortOrderId,
} from "@/lib/format";
import type { OrderStatus, Product, ProductBuyer } from "@/lib/types";
import { asList, callOutName, BOOTH_QK } from "./booth-utils";

type StatusFilter = "ALL" | OrderStatus;

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "WAITING", label: "Waiting" },
  { value: "SERVED", label: "Served" },
  { value: "PENDING", label: "Pending" },
  { value: "ABORTED", label: "Aborted" },
];

/* Sortable columns — key must match the ProductBuyer field used to compare. */
type SortKey =
  | "orderId"
  | "customerName"
  | "customerEmail"
  | "quantity"
  | "subtotal"
  | "orderTotal"
  | "createdAt";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "orderId", label: "Order" },
  { key: "customerName", label: "Customer" },
  { key: "customerEmail", label: "Email" },
  { key: "quantity", label: "Qty", align: "right" },
  { key: "subtotal", label: "This item", align: "right" },
  { key: "orderTotal", label: "Order total", align: "right" },
  { key: "createdAt", label: "Ordered" },
];

/** Neutral comparator per column key. */
function compareBuyers(a: ProductBuyer, b: ProductBuyer, key: SortKey): number {
  switch (key) {
    case "quantity":
    case "subtotal":
    case "orderTotal":
      return a[key] - b[key];
    case "createdAt":
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    case "orderId":
      return a.orderId.localeCompare(b.orderId);
    case "customerEmail":
      return (a.customerEmail || "").localeCompare(b.customerEmail || "");
    default:
      return callOutName(a).localeCompare(callOutName(b));
  }
}

/* ------------------------------------------------------------------ */
/* Exports — one row per buyer, filtered + sorted exactly as shown.    */
/* Excel (.xlsx) is the primary format: every column is auto-fitted    */
/* to its longest cell so long emails / names are never cut in half,   */
/* the header row gets Excel filter dropdowns, and money lands as      */
/* real ₱-formatted numbers (sortable + summable like a native Excel   */
/* table). CSV stays available from the format dropdown for tools      */
/* that want plain text.                                               */
/* ------------------------------------------------------------------ */

const EXPORT_HEADERS = [
  "Order ID",
  "Call-out name",
  "Customer name",
  "Email",
  "Quantity",
  "Temperature",
  "This item subtotal",
  "Order total",
  "Payment method",
  "Payment status",
  "Order status",
  "Ordered at",
  "Scanned at",
  "Served at",
] as const;

/** Column indexes holding money — formatted as ₱ in the Excel export. */
const EXPORT_MONEY_COLS = [6, 7] as const;

/** One export row from a buyer — shared by the Excel and CSV writers. */
function buyerRow(r: ProductBuyer): (string | number)[] {
  return [
    r.orderId,
    callOutName(r),
    r.customerName,
    r.customerEmail,
    r.quantity,
    r.temperature ?? "",
    r.subtotal,
    r.orderTotal,
    paymentMethodLabel(r.paymentMethod),
    r.paymentStatus,
    r.orderStatus,
    formatDateTime(r.createdAt),
    r.scannedAt ? formatDateTime(r.scannedAt) : "",
    r.completedAt ? formatDateTime(r.completedAt) : "",
  ];
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportBuyersCsv(product: Product, rows: ProductBuyer[]) {
  const lines = rows.map((r) =>
    buyerRow(r)
      .map((v) => csvEscape(String(v ?? "")))
      .join(",")
  );
  const csv = [EXPORT_HEADERS.join(","), ...lines].join("\r\n");
  triggerDownload(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    `coffeepp-${product.id.toLowerCase()}-buyers.csv`
  );
}

/**
 * Excel export — built in the browser with SheetJS (dynamically imported
 * so the ~1 MB library only loads when an export actually happens).
 * "Flexible tables": column widths are computed from each column's longest
 * cell (header or value, clamped 9–55 chars) so nothing is cut in half,
 * the header row gets Excel's filter dropdowns, and money cells are real
 * numbers with a ₱ number format — sortable and summable in Excel.
 */
async function exportBuyersExcel(product: Product, rows: ProductBuyer[]) {
  const XLSX = await import("xlsx");
  const data: (string | number)[][] = [
    [...EXPORT_HEADERS],
    ...rows.map(buyerRow),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Money cells → real numbers with a ₱ number format.
  for (let r = 1; r < data.length; r++) {
    for (const c of EXPORT_MONEY_COLS) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = '"₱"#,##0.00';
    }
  }

  // Auto-fit columns: width = longest cell in the column + padding.
  const widths: number[] = [];
  for (const row of data) {
    row.forEach((cell, col) => {
      const len = String(cell ?? "").length;
      widths[col] = Math.max(widths[col] ?? 0, len);
    });
  }
  ws["!cols"] = widths.map((w) => ({ wch: Math.min(Math.max(w + 2, 9), 55) }));

  // Excel filter dropdowns on the header row.
  if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Buyers");
  const buffer = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  triggerDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `coffeepp-${product.id.toLowerCase()}-buyers.xlsx`
  );
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function ProductBuyersDialog({
  product,
  onOpenChange,
}: {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("ALL");
  const [sortKey, setSortKey] = React.useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const { toast } = useToast();

  // Reset the tools every time a different product is opened.
  React.useEffect(() => {
    if (product) {
      setSearch("");
      setStatus("ALL");
      setSortKey("createdAt");
      setSortDir("desc");
    }
  }, [product]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["booth", "product-buyers", product?.id],
    queryFn: () => apiFetch<unknown>(`/api/products/${product?.id}/buyers`),
    enabled: product !== null,
  });

  const buyers = React.useMemo(
    () => asList<ProductBuyer>(data, "buyers"),
    [data]
  );

  /* Search + status filter */
  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return buyers.filter((b) => {
      if (status !== "ALL" && b.orderStatus !== status) return false;
      if (!needle) return true;
      return (
        b.orderId.toLowerCase().includes(needle) ||
        b.customerName.toLowerCase().includes(needle) ||
        b.customerAlias.toLowerCase().includes(needle) ||
        b.customerEmail.toLowerCase().includes(needle)
      );
    });
  }, [buyers, search, status]);

  /* Column sort — newest orders first by default */
  const sorted = React.useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const base = compareBuyers(a, b, sortKey);
      return sortDir === "asc" ? base : -base;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const totalUnits = sorted.reduce((sum, r) => sum + r.quantity, 0);
  const totalItemRevenue = sorted.reduce((sum, r) => sum + r.subtotal, 0);
  /* Customers ≠ rows since the smarter ordering update: an order can carry
     a HOT and a COLD line for the same product, so one customer may occupy
     two rows (one per temperature). Count people by unique order. */
  const uniqueCustomers = React.useMemo(
    () => new Set(sorted.map((r) => r.orderId)).size,
    [sorted]
  );

  /* Export handlers — Excel is the primary format (auto-fit columns so
     nothing is cut off in Excel); CSV stays available as plain text. */
  async function handleExportExcel() {
    if (!product || sorted.length === 0) return;
    try {
      await exportBuyersExcel(product, sorted);
      toast({
        title: "✓ Excel downloaded",
        description: `${sorted.length} ${sorted.length === 1 ? "row" : "rows"} (${uniqueCustomers} ${uniqueCustomers === 1 ? "customer" : "customers"}) — columns auto-fit, filters included.`,
      });
    } catch {
      toast({
        title: "Export failed",
        description: "The Excel file couldn't be generated. Please try again.",
        variant: "destructive",
      });
    }
  }

  function handleExportCsv() {
    if (!product || sorted.length === 0) return;
    exportBuyersCsv(product, sorted);
    toast({
      title: "✓ CSV downloaded",
      description: `${sorted.length} ${sorted.length === 1 ? "row" : "rows"} (${uniqueCustomers} ${uniqueCustomers === 1 ? "customer" : "customers"}).`,
    });
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "createdAt" ? "desc" : "asc");
    }
  }

  function sortIcon(key: SortKey) {
    if (key !== sortKey) {
      return <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3" aria-hidden />
    ) : (
      <ArrowDown className="h-3 w-3" aria-hidden />
    );
  }

  const open = product !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto scroll-thin sm:max-w-5xl">
        {product && (
          <>
            {/* min-w-0 — the dialog content is a grid and the header holds a
                nowrap-truncating title; without min-w-0 its min-content
                (~474px) inflates the grid track, stretching every sibling
                (toolbar, table) past the dialog edge on mobile. */}
            <DialogHeader className="min-w-0">
              <DialogTitle className="flex items-center gap-3">
                <span className="relative flex h-11 w-11 shrink-0 overflow-hidden rounded-lg border bg-muted">
                  <Image
                    src={product.image || "/images/products/ClassicCoffee.jpg"}
                    alt=""
                    fill
                    sizes="44px"
                    className="object-cover"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-xl font-bold tracking-tight">
                    {product.name} — Customers who bought this
                  </span>
                  <span className="block text-xs font-medium text-muted-foreground">
                    {product.id} · {formatPeso(product.price)}
                    {product.hasTemperature
                      ? " · HOT / COLD"
                      : product.defaultTemperature
                        ? ` · SERVED ${product.defaultTemperature}`
                        : ""}
                  </span>
                </span>
              </DialogTitle>
              <DialogDescription>
                Every registered order that contains {product.name} — one row
                per customer, with their credentials and this item&apos;s
                details.
              </DialogDescription>
            </DialogHeader>

            {/* Tools: search, status filter, export (Excel primary, CSV in dropdown).
                min-w-0 — the dialog content is a grid, and without it the
                toolbar's min-content inflates past the dialog width so
                flex-wrap never engages (tabs/buttons got cut off on mobile). */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 basis-56">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, call-out, email, order #"
                  className="h-9 pl-8"
                  aria-label="Search buyers"
                />
              </div>
              <Tabs
                value={status}
                onValueChange={(v) => setStatus(v as StatusFilter)}
              >
                <TabsList className="h-9">
                  {STATUS_TABS.map((t) => (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      className="h-7 px-2.5 text-xs"
                    >
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="flex items-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-r-none pr-3"
                  onClick={() => void handleExportExcel()}
                  disabled={sorted.length === 0}
                >
                  <FileSpreadsheet aria-hidden />
                  Excel
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-l-none border-l-0 px-2"
                      aria-label="Choose export format"
                      disabled={sorted.length === 0}
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void handleExportExcel()}>
                      <FileSpreadsheet className="h-4 w-4" aria-hidden />
                      <span>Excel (.xlsx) — auto-fit columns</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleExportCsv()}>
                      <FileText className="h-4 w-4" aria-hidden />
                      <span>CSV (.csv) — plain text</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Summary line */}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" aria-hidden />
                <strong className="text-foreground">{uniqueCustomers}</strong>{" "}
                {uniqueCustomers === 1 ? "customer" : "customers"}
                {sorted.length !== uniqueCustomers && (
                  <span className="font-normal text-muted-foreground">
                    {" "}· {sorted.length} {sorted.length === 1 ? "line" : "lines"} (hot/cold split)
                  </span>
                )}
              </span>
              <span>
                <strong className="text-foreground">{totalUnits}</strong>{" "}
                {totalUnits === 1 ? "unit" : "units"} of this product
              </span>
              <span>
                <strong className="text-foreground">
                  {formatPeso(totalItemRevenue)}
                </strong>{" "}
                item total
              </span>
              <span className="hidden sm:inline">
                Click a column header to sort.
              </span>
            </p>

            {/* Buyers table */}
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : isError ? (
              <EmptyState
                title="Couldn't load the buyers"
                description="Check your connection and try again."
                action={
                  <Button variant="outline" onClick={() => void refetch()}>
                    Try Again
                  </Button>
                }
              />
            ) : buyers.length === 0 ? (
              <EmptyState
                icon={<Users className="h-6 w-6" aria-hidden />}
                title="No buyers yet"
                description={`Nobody has bought ${product.name} so far — customers will appear here as soon as their Order QRs are scanned.`}
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Search className="h-6 w-6" aria-hidden />}
                title="No matching customers"
                description="Try a different search or status filter."
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setStatus("ALL");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <div className="overflow-x-auto scroll-thin rounded-lg border">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      {COLUMNS.map((col) => (
                        <TableHead
                          key={col.key}
                          className={col.align === "right" ? "text-right" : ""}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-foreground"
                            aria-label={`Sort by ${col.label}`}
                          >
                            {col.label}
                            {sortIcon(col.key)}
                          </button>
                        </TableHead>
                      ))}
                      <TableHead className="text-center">Temp</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((b) => (
                      <TableRow key={b.orderId}>
                        <TableCell className="whitespace-nowrap font-semibold text-foreground">
                          {shortOrderId(b.orderId)}
                        </TableCell>
                        <TableCell>
                          <p className="font-semibold text-foreground">
                            {callOutName(b)}
                          </p>
                          {b.customerAlias?.trim() &&
                          b.customerName?.trim() ? (
                            <p className="text-xs text-muted-foreground">
                              {b.customerName}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {b.customerEmail ? (
                            <span className="flex items-center gap-0.5">
                              <a
                                href={`mailto:${b.customerEmail}`}
                                className="inline-flex min-w-0 items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <Mail className="h-3 w-3 shrink-0" aria-hidden />
                                <span className="truncate">
                                  {b.customerEmail}
                                </span>
                              </a>
                              <CopyEmailButton email={b.customerEmail} />
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {b.quantity}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatPeso(b.subtotal)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatPeso(b.orderTotal)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(b.createdAt)}
                        </TableCell>
                        <TableCell className="text-center">
                          {b.temperature ? (
                            <Badge
                              variant="secondary"
                              className={
                                b.temperature === "HOT"
                                  ? "border-warning/40 bg-warning/15 text-warning-foreground"
                                  : ""
                              }
                            >
                              {b.temperature}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-xs font-medium text-foreground">
                              {paymentMethodLabel(b.paymentMethod)}
                            </span>
                            <PaymentStatusBadge
                              status={b.paymentStatus}
                              className="px-2 py-0.5 text-[10px]"
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <OrderStatusBadge
                            status={b.orderStatus}
                            className="px-2 py-0.5 text-[10px]"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
