"use client";

// Reports — Excel export + JSON backup downloads (admin only),
// with a compact summary of the key booth numbers.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatPeso } from "@/lib/format";
import type { DashboardStats } from "@/lib/types";
import { useApiError } from "./booth-utils";
import { ViewHeader } from "./view-header";

function filenameFromDisposition(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="?([^";]+)"?/i.exec(cd);
  return m ? m[1] : fallback;
}

async function downloadFile(
  path: string,
  fallbackName: string
): Promise<void> {
  const res = await fetch(path);
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body: unknown = await res.json();
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof (body as Record<string, unknown>).error === "string"
      ) {
        message = (body as { error: string }).error;
      }
    } catch {
      // Non-JSON error body — keep the status message.
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFromDisposition(res, fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function SummaryTile({ label, value, valueClass }: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-0.5 truncate text-lg font-bold ${valueClass ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function ReportsInner() {
  const { toast } = useToast();
  const apiError = useApiError();

  const [exporting, setExporting] = React.useState(false);
  const [backing, setBacking] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["booth", "dashboard", "all"],
    queryFn: () => apiFetch<DashboardStats>("/api/dashboard"),
  });

  async function handleExport() {
    setExporting(true);
    try {
      await downloadFile("/api/export", "coffeepp-sales.xlsx");
      toast({
        title: "✓ Excel exported",
        description: "coffeepp-sales.xlsx downloaded — all booth data in 4 wide-readable sheets.",
      });
    } catch (err) {
      apiError(err, "Could not export the Excel file.");
    } finally {
      setExporting(false);
    }
  }

  async function handleBackup() {
    setBacking(true);
    try {
      await downloadFile("/api/backup", "coffeepp-backup.json");
      toast({
        title: "✓ Backup downloaded",
        description: "coffeepp-backup.json — full JSON snapshot of the database.",
      });
    } catch (err) {
      apiError(err, "Could not download the backup.");
    } finally {
      setBacking(false);
    }
  }

  const roiRaw = data?.roi ?? 0;
  const roiPct = Math.abs(roiRaw) <= 1 ? roiRaw * 100 : roiRaw;

  return (
    <div>
      <ViewHeader
        title="Reports"
        description="Export the full sales workbook or back up the database."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {/* Excel export */}
        <Card className="gap-4">
          <CardHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileSpreadsheet className="h-6 w-6" aria-hidden />
            </div>
            <CardTitle>Export to Excel</CardTitle>
            <CardDescription>
              The complete sales workbook (.xlsx) for your post-event report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>• Orders — every order with status, payment, and totals</li>
              <li>• Order Items — line items per order (HOT/COLD, qty, price)</li>
              <li>• Product Summary — sold and revenue per product</li>
              <li>• Dashboard — revenue, total cost, net profit, ROI, best seller, payment split</li>
            </ul>
            <Button
              className="h-11 w-full font-semibold"
              onClick={() => void handleExport()}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <FileSpreadsheet aria-hidden />
              )}
              {exporting ? "Preparing workbook…" : "Download .xlsx"}
            </Button>
          </CardContent>
        </Card>

        {/* JSON backup */}
        <Card className="gap-4">
          <CardHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Database className="h-6 w-6" aria-hidden />
            </div>
            <CardTitle>Backup Database</CardTitle>
            <CardDescription>
              A portable JSON snapshot of everything in the system.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>• Products — menu, prices, and sold counts</li>
              <li>• Orders — every order and its items</li>
              <li>• Settings — booth schedule, payment channels, total cost</li>
            </ul>
            <Button
              variant="outline"
              className="h-11 w-full font-semibold"
              onClick={() => void handleBackup()}
              disabled={backing}
            >
              {backing ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Database aria-hidden />
              )}
              {backing ? "Preparing backup…" : "Download JSON"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Compact summary */}
      <Card className="mt-4 gap-4">
        <CardHeader>
          <CardTitle>Key Numbers</CardTitle>
          <CardDescription>Current totals across the whole booth run.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryTile label="Revenue" value={formatPeso(data.revenue ?? 0)} />
              <SummaryTile label="Total Cost" value={formatPeso(data.totalCost ?? 0)} />
              <SummaryTile
                label="Net Profit"
                value={formatPeso(data.netProfit ?? 0)}
                valueClass={
                  (data.netProfit ?? 0) > 0
                    ? "text-success"
                    : (data.netProfit ?? 0) < 0
                      ? "text-destructive"
                      : "text-foreground"
                }
              />
              <SummaryTile label="ROI" value={`${roiPct.toFixed(1)}%`} />
              <SummaryTile label="Served Orders" value={String(data.ordersServed ?? 0)} />
              <SummaryTile label="Items Sold" value={String(data.itemsSold ?? 0)} />
              <SummaryTile label="Aborted" value={String(data.ordersAborted ?? 0)} />
              <SummaryTile label="Waiting" value={String(data.ordersWaiting ?? 0)} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ReportsView() {
  return (
      <ReportsInner />
  );
}
