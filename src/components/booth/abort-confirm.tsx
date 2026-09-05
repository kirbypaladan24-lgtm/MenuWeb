"use client";

// Shared ABORT confirmation — used by the scanner result and the waiting line.

import * as React from "react";
import { Ban, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiFetch, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ABORT_REASONS } from "@/lib/constants";
import { shortOrderId } from "@/lib/format";
import type { Order } from "@/lib/types";
import { BOOTH_QK, unwrapOrder, useApiError } from "./booth-utils";

interface AbortConfirmProps {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the updated (ABORTED) order after a successful abort. */
  onDone: (order: Order) => void;
}

export function AbortConfirm({ order, open, onOpenChange, onDone }: AbortConfirmProps) {
  const { toast } = useToast();
  const apiError = useApiError();
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState<string>(ABORT_REASONS[0]);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const res = await apiFetch<unknown>(`/api/orders/${order.orderId}/abort`, {
        method: "POST",
        json: { reason },
      });
      const updated = unwrapOrder(res);
      toast({
        title: "Order aborted",
        description: `Order ${shortOrderId(order.orderId)} aborted — ${reason}. Not counted as a sale.`,
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
          <AlertDialogTitle>Abort order?</AlertDialogTitle>
          <AlertDialogDescription>
            {shortOrderId(order.orderId)} · {order.customerName || "Walk-in"} — pick a
            reason. Aborted orders are not counted as sales.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup
          value={reason}
          onValueChange={setReason}
          className="gap-2"
          disabled={submitting}
        >
          {ABORT_REASONS.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors has-[button[data-state=checked]]:border-primary/50 has-[button[data-state=checked]]:bg-primary/5"
            >
              <RadioGroupItem value={r} id={`abort-${order.orderId}-${r}`} />
              <Label
                htmlFor={`abort-${order.orderId}-${r}`}
                className="cursor-pointer font-normal text-foreground"
              >
                {r}
              </Label>
            </label>
          ))}
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting} className="h-11">
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            className="h-11"
            onClick={() => void handleConfirm()}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Ban aria-hidden />
            )}
            CONFIRM ABORT
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
