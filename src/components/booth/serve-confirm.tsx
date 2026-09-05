"use client";

// Shared SERVE confirmation — used by the scanner result and the waiting line.

import * as React from "react";
import { BadgeCheck, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { apiFetch, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatPeso, paymentMethodLabel, shortOrderId } from "@/lib/format";
import type { Order } from "@/lib/types";
import { BOOTH_QK, callOutName, unwrapOrder, useApiError } from "./booth-utils";

interface ServeConfirmProps {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the updated (SERVED) order after a successful serve. */
  onDone: (order: Order) => void;
}

export function ServeConfirm({ order, open, onOpenChange, onDone }: ServeConfirmProps) {
  const { toast } = useToast();
  const apiError = useApiError();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const res = await apiFetch<unknown>(`/api/orders/${order.orderId}/serve`, {
        method: "POST",
      });
      const updated = unwrapOrder(res);
      toast({
        title: "✓ Order served",
        description: `Order ${shortOrderId(order.orderId)} completed — ${formatPeso(order.total)} · ${paymentMethodLabel(order.paymentMethod)}.`,
      });
      onOpenChange(false);
      onDone(updated);
      void queryClient.invalidateQueries({ queryKey: BOOTH_QK });
    } catch (err) {
      apiError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!submitting) onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Complete order?</AlertDialogTitle>
          <AlertDialogDescription>
            {shortOrderId(order.orderId)} · {order.items.length}{" "}
            {order.items.length === 1 ? "item" : "items"} · call out{" "}
            <span className="font-bold text-foreground">{callOutName(order)}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5 rounded-md bg-secondary px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-secondary-foreground">Call out</span>
            <span className="max-w-56 truncate font-bold text-secondary-foreground">
              {callOutName(order)}
            </span>
          </div>
          {order.customerAlias && order.customerName && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-secondary-foreground">Customer</span>
              <span className="max-w-56 truncate font-semibold text-secondary-foreground">
                {order.customerName}
              </span>
            </div>
          )}
          {order.customerEmail && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-secondary-foreground">Email</span>
              <span className="max-w-56 truncate text-secondary-foreground/80">
                {order.customerEmail}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-secondary-foreground">Payment</span>
            <span className="font-semibold text-secondary-foreground">
              {paymentMethodLabel(order.paymentMethod)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-secondary-foreground">Total</span>
            <span className="font-semibold text-secondary-foreground">
              {formatPeso(order.total)}
            </span>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Confirm that payment has been manually verified. Serving marks the order{" "}
          <span className="font-semibold text-foreground">PAID</span> and completes it.
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting} className="h-11">
            Cancel
          </AlertDialogCancel>
          <Button className="h-11" onClick={() => void handleConfirm()} disabled={submitting}>
            {submitting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <BadgeCheck aria-hidden />
            )}
            CONFIRM SERVE
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
