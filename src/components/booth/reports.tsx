"use client";

// Reports — Excel export + JSON backup downloads (admin only),
// with a compact summary of the key booth numbers.

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Database, FileSpreadsheet, Loader2, RotateCcw, Upload } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  const queryClient = useQueryClient();

  const [exporting, setExporting] = React.useState(false);
  const [backing, setBacking] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  const [mode, setMode] = React.useState<"merge" | "replace">("merge");
  const [pinOpen, setPinOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [pinBusy, setPinBusy] = React.useState(false);
  const [wiping, setWiping] = React.useState(false);
  const [staged, setStaged] = React.useState<{
    name: string;
    data: unknown;
    products: number;
    orders: number;
    hasSettings: boolean;
    exportedAt: string | null;
  } | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

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

  // Stage a backup file: parse + preview counts locally, restore later.
  async function handlePickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Backup files are small JSON — this doesn't look like one (5 MB limit).",
        variant: "destructive",
      });
      return;
    }
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      const rec = parsed as Record<string, unknown>;
      if (!Array.isArray(rec.products) || !Array.isArray(rec.orders)) {
        throw new Error("needs products + orders arrays");
      }
      setStaged({
        name: file.name,
        data: parsed,
        products: rec.products.length,
        orders: rec.orders.length,
        hasSettings: rec.settings !== undefined && rec.settings !== null,
        exportedAt:
          typeof rec.exportedAt === "string" && rec.exportedAt !== "" ? rec.exportedAt : null,
      });
      setConfirmed(false);
    } catch {
      toast({
        title: "Not a backup file",
        description: `${file.name} isn't a Coffee++ backup JSON (needs products + orders).`,
        variant: "destructive",
      });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRestore() {
    if (!staged || !confirmed) return;
    setRestoring(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        mode: string;
        productsAdded: number;
        productsUpdated: number;
        ordersAdded: number;
        ordersSkipped: number;
      }>("/api/backup/import", { method: "POST", json: { mode, data: staged.data } });
      toast(
        mode === "merge"
          ? {
              title: "✓ Import complete",
              description: `${res.ordersAdded} orders added (${res.ordersSkipped} already here, skipped) · ${res.productsAdded} products added, ${res.productsUpdated} updated.`,
            }
          : {
              title: "✓ Backup restored",
              description: `${res.productsAdded} products and ${res.ordersAdded} orders replaced the current data.`,
            }
      );
      setStaged(null);
      setConfirmed(false);
      await queryClient.invalidateQueries({ queryKey: ["booth"] });
    } catch (err) {
      apiError(err, "Could not import the backup — current data untouched.");
    } finally {
      setRestoring(false);
    }
  }

  const roiRaw = data?.roi ?? 0;
  const roiPct = Math.abs(roiRaw) <= 1 ? roiRaw * 100 : roiRaw;

  // Orders currently on record — shown in the reboot confirm step.
  const totalOrders =
    (data?.ordersServed ?? 0) +
    (data?.ordersWaiting ?? 0) +
    (data?.ordersAborted ?? 0) +
    (data?.ordersPending ?? 0);

  function openReboot() {
    setPin("");
    setPinOpen(true);
  }

  // Step 1 — PIN gate. The server verifies; nothing is wiped here.
  // Auto-submits the moment the 4th digit lands — no Continue press.
  async function submitPin(value: string) {
    if (value.length !== 4 || pinBusy) return;
    setPinBusy(true);
    try {
      const res = await apiFetch<{ pinOk: boolean }>("/api/backup/wipe", {
        method: "POST",
        json: { pin: value },
      });
      if (res.pinOk) {
        setPinOpen(false);
        setConfirmOpen(true);
      }
    } catch (err) {
      apiError(err, "Wrong PIN.");
      setPin("");
    } finally {
      setPinBusy(false);
    }
  }

  // Step 2 — confirmed wipe. Deletes ALL orders, resets sold counts;
  // products, menu and settings stay.
  async function executeWipe() {
    setWiping(true);
    try {
      const res = await apiFetch<{ ok: boolean; ordersDeleted: number }>(
        "/api/backup/wipe",
        { method: "POST", json: { pin, confirm: true } }
      );
      toast({
        title: "✓ Booth rebooted",
        description: `${res.ordersDeleted} orders deleted, sold counts reset. Menu and settings kept.`,
      });
      setConfirmOpen(false);
      setPin("");
      await queryClient.invalidateQueries({ queryKey: ["booth"] });
    } catch (err) {
      apiError(err, "Could not reboot — current data untouched.");
    } finally {
      setWiping(false);
    }
  }

  return (
    <div>
      <ViewHeader
        title="Reports"
        description="Export the full sales workbook, back up the database, or restore one."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
              <li>• Order Items — line items per order (size, HOT/COLD, answers, qty, price)</li>
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

        {/* Restore from backup — merge new data in, or replace everything */}
        <Card className="gap-4 border-destructive/30">
          <CardHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Upload className="h-6 w-6" aria-hidden />
            </div>
            <CardTitle>Import Backup</CardTitle>
            <CardDescription>
              Bring a downloaded JSON snapshot back in — add what's missing, or start over from it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v === "replace" ? "replace" : "merge")}
              className="grid gap-2"
            >
              <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/5">
                <RadioGroupItem value="merge" id="import-merge" className="mt-0.5" aria-label="Add missing data" />
                <Label htmlFor="import-merge" className="cursor-pointer">
                  <span className="block text-sm font-semibold text-foreground">Add missing</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    New orders are added, existing order IDs are skipped, products update by ID. Current data stays.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 has-[button[data-state=checked]]:border-destructive has-[button[data-state=checked]]:bg-destructive/5">
                <RadioGroupItem value="replace" id="import-replace" className="mt-0.5" aria-label="Replace all data" />
                <Label htmlFor="import-replace" className="cursor-pointer">
                  <span className="block text-sm font-semibold text-foreground">Replace everything</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Wipes all current data first — disaster recovery only.
                  </span>
                </Label>
              </div>
            </RadioGroup>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Choose a backup JSON file"
              onChange={(e) => void handlePickFile(e.target.files?.[0])}
            />
            {!staged ? (
              <Button
                variant="outline"
                className="h-11 w-full font-semibold"
                onClick={() => fileRef.current?.click()}
              >
                <Upload aria-hidden />
                Choose backup file
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border bg-secondary/40 px-3 py-2.5 text-sm">
                  <p className="truncate font-semibold text-foreground">
                    {staged.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {staged.products} products · {staged.orders} orders
                    {staged.hasSettings ? " · settings" : " · no settings"}
                    {staged.exportedAt ? ` · backed up ${staged.exportedAt.slice(0, 10)}` : ""}
                  </p>
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed">
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(v) => setConfirmed(v === true)}
                    aria-label={mode === "merge" ? "Confirm importing" : "Confirm replacing all current data"}
                    className="mt-0.5"
                  />
                  <span className="text-muted-foreground">
                    {mode === "merge" ? (
                      <>I understand this <strong className="text-foreground">adds the file&apos;s {staged.orders} orders and {staged.products} products</strong> — existing order IDs are skipped, nothing is deleted.</>
                    ) : (
                      <>I understand this <strong className="text-foreground">replaces ALL current products, orders and settings</strong> — this can&apos;t be undone.</>
                    )}
                  </span>
                </label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="h-11 flex-1 font-semibold"
                    onClick={() => {
                      setStaged(null);
                      setConfirmed(false);
                    }}
                    disabled={restoring}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant={mode === "merge" ? "default" : "destructive"}
                    className="h-11 flex-1 font-semibold"
                    onClick={() => void handleRestore()}
                    disabled={!confirmed || restoring}
                  >
                    {restoring ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Upload aria-hidden />
                    )}
                    {restoring ? (mode === "merge" ? "Importing…" : "Restoring…") : (mode === "merge" ? "Import" : "Restore")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Danger zone — reboot wipes orders for a fresh run */}
      <Card className="mt-4 gap-4 border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <RotateCcw className="h-5 w-5" aria-hidden />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Reboot deletes ALL orders and resets sold counts — products, menu and settings stay.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            className="h-11 w-full font-semibold sm:w-auto sm:px-8"
            onClick={openReboot}
          >
            <RotateCcw aria-hidden />
            Reboot Booth
          </Button>
        </CardContent>
      </Card>

      {/* Step 1 — PIN gate */}
      <Dialog
        open={pinOpen}
        onOpenChange={(o) => {
          if (!o && !pinBusy) {
            setPinOpen(false);
            setPin("");
          }
        }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center">Enter reboot PIN</DialogTitle>
            <DialogDescription className="text-center">
              4 digits — nothing happens until you confirm next.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <InputOTP
              maxLength={4}
              pattern={REGEXP_ONLY_DIGITS}
              value={pin}
              onChange={(v) => {
                setPin(v);
                if (v.length === 4) void submitPin(v);
              }}
              aria-label="Reboot PIN"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <DialogFooter className="gap-2 sm:justify-stretch">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setPinOpen(false);
                setPin("");
              }}
              disabled={pinBusy}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => void submitPin(pin)}
              disabled={pin.length !== 4 || pinBusy}
            >
              {pinBusy ? <Loader2 className="animate-spin" aria-hidden /> : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2 — final confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reboot the booth?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes all {totalOrders} order{totalOrders === 1 ? "" : "s"} on
              record and resets every sold count to 0. Products, menu, booth
              settings and total cost stay. This can&apos;t be undone — back up
              first if these sales matter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={wiping}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => void executeWipe()}
              disabled={wiping}
            >
              {wiping ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RotateCcw aria-hidden />
              )}
              {wiping ? "Rebooting…" : "Yes, wipe all orders"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
