"use client";

// Orders log — every order with status / day / search filters, newest first.
// ADMIN can edit an order's customer data / payment info and delete records
// entirely (a served order's quantities are un-counted on delete).

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Pencil, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { BOOTH_DAYS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import {
  formatDateTime,
  formatPeso,
  paymentMethodLabel,
  shortOrderId,
} from "@/lib/format";
import type { Order, OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/types";
import { BOOTH_QK, asList, callOutName, useApiError } from "./booth-utils";
import { ViewHeader } from "./view-header";

type StatusFilter = "ALL" | OrderStatus;
type DayFilter = "all" | "1" | "2" | "3";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "WAITING", label: "Waiting" },
  { value: "SERVED", label: "Served" },
  { value: "ABORTED", label: "Aborted" },
];

function itemsSummary(order: Order): string {
  return order.items
    .map(
      (i) =>
        `${i.quantity}× ${i.productName}${i.temperature ? ` ${i.temperature}` : ""}`
    )
    .join(", ");
}

/* ------------------------------------------------------------------ */
/* Edit dialog — customer data + payment info                          */
/* ------------------------------------------------------------------ */

interface OrderEditForm {
  customerName: string;
  customerAlias: string;
  customerEmail: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
}

function toEditForm(o: Order): OrderEditForm {
  return {
    customerName: o.customerName ?? "",
    customerAlias: o.customerAlias ?? "",
    customerEmail: o.customerEmail ?? "",
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
  };
}

function OrderEditDialog({
  order,
  onOpenChange,
  onSaved,
}: {
  order: Order | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const apiError = useApiError();
  const [form, setForm] = React.useState<OrderEditForm | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setForm(order ? toEditForm(order) : null);
  }, [order]);

  if (!order || !form) return null;

  function set<K extends keyof OrderEditForm>(key: K, value: OrderEditForm[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function handleSave() {
    if (!form || !order) return;
    const alias = form.customerAlias.trim();
    const name = form.customerName.trim();
    if (!alias && !name) {
      toast({
        title: "Check the form",
        description: "Give the order a call-out name or a full name.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/orders/${order.orderId}`, {
        method: "PATCH",
        json: {
          customerAlias: alias,
          customerName: name,
          customerEmail: form.customerEmail.trim(),
          paymentMethod: form.paymentMethod,
          paymentStatus: form.paymentStatus,
        },
      });
      toast({
        title: "✓ Order updated",
        description: `${shortOrderId(order.orderId)} now belongs to ${alias || name}.`,
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      apiError(err, "Could not update this order.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={order !== null} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-thin sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {shortOrderId(order.orderId)}</DialogTitle>
          <DialogDescription>
            Fix a name typo or record a late payment — items and totals stay as
            they were scanned.
          </DialogDescription>
        </DialogHeader>

        {/* Read-only context */}
        <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-1.5">
            <OrderStatusBadge status={order.orderStatus} />
            <span className="font-semibold text-foreground">{formatPeso(order.total)}</span>
          </div>
          <p className="mt-1 leading-relaxed">{itemsSummary(order) || "No items"}</p>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="order-alias">Call-out name</Label>
            <Input
              id="order-alias"
              value={form.customerAlias}
              onChange={(e) => set("customerAlias", e.target.value)}
              placeholder="The name staff shout when it's ready"
              disabled={saving}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="order-name">Full name</Label>
            <Input
              id="order-name"
              value={form.customerName}
              onChange={(e) => set("customerName", e.target.value)}
              placeholder="Optional"
              disabled={saving}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="order-email">Email</Label>
            <Input
              id="order-email"
              type="email"
              value={form.customerEmail}
              onChange={(e) => set("customerEmail", e.target.value)}
              placeholder="Optional"
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="order-payment-method">Payment method</Label>
              <Select
                value={form.paymentMethod}
                onValueChange={(v) => set("paymentMethod", v as PaymentMethod)}
                disabled={saving}
              >
                <SelectTrigger id="order-payment-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GCASH">GCash</SelectItem>
                  <SelectItem value="BOOTH">Pay at booth</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="order-payment-status">Payment status</Label>
              <Select
                value={form.paymentStatus}
                onValueChange={(v) => set("paymentStatus", v as PaymentStatus)}
                disabled={saving}
              >
                <SelectTrigger id="order-payment-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNPAID">Unpaid</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-10">
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving} className="h-10">
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Orders view                                                         */
/* ------------------------------------------------------------------ */

export default function OrdersView() {
  // No sign-in: the console runs on the booth laptop and always has full access.
  const isAdmin = true;
  const { toast } = useToast();
  const apiError = useApiError();
  const queryClient = useQueryClient();

  const [status, setStatus] = React.useState<StatusFilter>("ALL");
  const [day, setDay] = React.useState<DayFilter>("all");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  const [editing, setEditing] = React.useState<Order | null>(null);
  const [deleting, setDeleting] = React.useState<Order | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["booth", "orders", status, day, debounced],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      if (day !== "all") params.set("day", day);
      if (debounced) params.set("q", debounced);
      const qs = params.toString();
      return apiFetch<unknown>(qs ? `/api/orders?${qs}` : "/api/orders");
    },
  });

  const orders = React.useMemo(() => {
    const list = asList<Order>(data, "orders");
    return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [data]);

  const hasFilters = status !== "ALL" || day !== "all" || debounced !== "";

  async function invalidateAll() {
    await queryClient.invalidateQueries({ queryKey: BOOTH_QK });
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/api/orders/${deleting.orderId}`, { method: "DELETE" });
      toast({
        title: "✓ Order deleted",
        description: `${shortOrderId(deleting.orderId)} was removed from the records.`,
      });
      setDeleting(null);
      await invalidateAll();
    } catch (err) {
      apiError(err, "Could not delete this order.");
    } finally {
      setDeleteBusy(false);
    }
  }

  function ActionButtons({ order }: { order: Order }) {
    if (!isAdmin) return null;
    return (
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setEditing(order)}
          aria-label={`Edit ${shortOrderId(order.orderId)}`}
          title="Edit customer / payment"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setDeleting(order)}
          aria-label={`Delete ${shortOrderId(order.orderId)}`}
          title="Delete order"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div>
      <ViewHeader
        title="Orders"
        description="Every order across the booth run — newest first."
        action={
          isFetching ? (
            <Badge variant="secondary" className="text-xs">
              Updating…
            </Badge>
          ) : undefined
        }
      />

      <div className="space-y-3">
        {/* Status + day filters */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <Tabs
            value={status}
            onValueChange={(v) => setStatus(v as StatusFilter)}
            className="min-w-0 flex-1"
          >
            <TabsList className="w-full">
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="px-1 text-xs sm:px-3 sm:text-sm">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative lg:w-72">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order ID or customer…"
              className="pl-8"
              aria-label="Search orders"
            />
          </div>
        </div>

        <Tabs value={day} onValueChange={(v) => setDay(v as DayFilter)}>
          <TabsList>
            <TabsTrigger value="all" className="text-xs sm:text-sm">
              All Days
            </TabsTrigger>
            {BOOTH_DAYS.map((d, i) => (
              <TabsTrigger key={d} value={String(i + 1)} className="text-xs sm:text-sm">
                {d}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            title="Couldn't load orders"
            description="Check your connection and try again."
            action={
              <Button variant="outline" onClick={() => void refetch()}>
                Try Again
              </Button>
            }
          />
        ) : orders.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No orders match these filters" : "No orders yet"}
            description={
              hasFilters
                ? "Try a different status, day, or search term."
                : "Orders appear here as soon as customers place them."
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden gap-0 py-0 md:block">
              <div className="max-h-[70vh] overflow-y-auto scroll-thin">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="max-w-64">Items</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Completed</TableHead>
                      {isAdmin && <TableHead className="w-24 text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((o) => (
                      <TableRow
                        key={o.orderId}
                        className={o.orderStatus === "ABORTED" ? "opacity-60" : undefined}
                      >
                        <TableCell className="font-semibold">
                          {shortOrderId(o.orderId)}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="font-bold text-foreground">{callOutName(o)}</p>
                            {o.customerAlias && o.customerName && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {o.customerName}
                              </p>
                            )}
                            {o.customerEmail && (
                              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Mail className="h-3 w-3 shrink-0" aria-hidden />
                                <span className="max-w-40 truncate">{o.customerEmail}</span>
                                <CopyEmailButton email={o.customerEmail} />
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-64 truncate whitespace-normal text-muted-foreground">
                          {itemsSummary(o)}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {formatPeso(o.total)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">
                              {paymentMethodLabel(o.paymentMethod)}
                            </span>
                            <PaymentStatusBadge status={o.paymentStatus} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <OrderStatusBadge status={o.orderStatus} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(o.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {o.completedAt ? formatDateTime(o.completedAt) : "—"}
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <div className="flex justify-end">
                              <ActionButtons order={o} />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* Mobile cards */}
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1 scroll-thin md:hidden">
              {orders.map((o) => (
                <Card key={o.orderId} className="gap-2 py-3">
                  <CardContent className="space-y-2 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-lg font-bold">
                        {shortOrderId(o.orderId)}
                      </span>
                      <OrderStatusBadge status={o.orderStatus} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">
                        {callOutName(o)}
                      </p>
                      {o.customerAlias && o.customerName && (
                        <p className="truncate text-xs text-muted-foreground">
                          {o.customerName}
                        </p>
                      )}
                      {o.customerEmail && (
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{o.customerEmail}</span>
                          <CopyEmailButton email={o.customerEmail} />
                        </p>
                      )}
                    </div>
                    <p className="text-sm text-foreground">{itemsSummary(o)}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold">{formatPeso(o.total)}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {paymentMethodLabel(o.paymentMethod)}
                        </span>
                        <PaymentStatusBadge status={o.paymentStatus} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                      <span>{formatDateTime(o.createdAt)}</span>
                      {o.abortReason && (
                        <span className="text-destructive">{o.abortReason}</span>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 flex-1"
                          onClick={() => setEditing(o)}
                        >
                          <Pencil aria-hidden />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 flex-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleting(o)}
                        >
                          <Trash2 aria-hidden />
                          Delete
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Edit order */}
      {isAdmin && (
        <OrderEditDialog
          order={editing}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          onSaved={() => void invalidateAll()}
        />
      )}

      {/* Delete order */}
      {isAdmin && (
        <AlertDialog
          open={deleting !== null}
          onOpenChange={(o) => {
            if (!o && !deleteBusy) setDeleting(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this order?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleting
                  ? `${shortOrderId(deleting.orderId)} — ${callOutName(deleting)} (${formatPeso(deleting.total)}) will be permanently removed from the records, reports, and Excel exports. This cannot be undone.`
                  : ""}
                {deleting?.orderStatus === "SERVED"
                  ? " Its sold quantities are subtracted from the product counters so the reports stay accurate."
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={deleteBusy}
              >
                {deleteBusy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                Delete Order
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
