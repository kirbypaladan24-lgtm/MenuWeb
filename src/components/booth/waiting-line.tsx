"use client";

// Waiting Line — live queue of scanned orders, refetched every 8 seconds.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Coffee, Ban, Mail, Smartphone, Volume2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyEmailButton } from "@/components/shared/copy-email-button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/shared/status-badge";
import { apiFetch } from "@/lib/api";
import { BOOTH_QK, asList, callOutName } from "./booth-utils";
import {
  formatPeso,
  formatTime,
  paymentMethodLabel,
  shortOrderId,
} from "@/lib/format";
import type { Order } from "@/lib/types";
import type { BoothView } from "@/lib/constants";
import { AbortConfirm } from "./abort-confirm";
import { ServeConfirm } from "./serve-confirm";
import { ViewHeader } from "./view-header";

export default function WaitingLine({
  onNavigate,
}: {
  onNavigate?: (view: BoothView) => void;
}) {
  const [serveOrder, setServeOrder] = React.useState<Order | null>(null);
  const [abortOrder, setAbortOrder] = React.useState<Order | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["booth", "waiting"],
    queryFn: () => apiFetch<unknown>("/api/orders?status=WAITING"),
    refetchInterval: 8000,
  });

  const waiting = React.useMemo(() => {
    const list = asList<Order>(data, "orders");
    return [...list].sort((a, b) => {
      const ta = a.scannedAt ?? a.createdAt;
      const tb = b.scannedAt ?? b.createdAt;
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
  }, [data]);

  const count = waiting.length;

  return (
    <div>
      <ViewHeader
        title="Waiting Line"
        description="Orders scanned and waiting to be prepared — refreshes automatically."
        action={
          <Badge
            variant="secondary"
            className={
              count > 0
                ? "border-warning/40 bg-warning/15 px-3 py-1 text-xs font-bold text-warning-foreground"
                : "px-3 py-1 text-xs font-bold"
            }
          >
            {count} in line
          </Badge>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load the waiting line"
          description="Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Try Again
            </Button>
          }
        />
      ) : count === 0 ? (
        <EmptyState
          title="No orders waiting right now"
          description="Scan a customer's Order QR and it will appear here."
          action={
            onNavigate && (
              <Button onClick={() => onNavigate("scanner")}>
                <Coffee aria-hidden />
                Open Scanner
              </Button>
            )
          }
        />
      ) : (
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1 scroll-thin">
          {waiting.map((o, i) => (
            <Card
              key={o.orderId}
              className="gap-3 py-4 animate-in fade-in slide-in-from-bottom-1 duration-200"
              style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
            >
              <CardContent className="space-y-3 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-2xl font-bold leading-none text-foreground">
                      {shortOrderId(o.orderId)}
                    </span>
                    <OrderStatusBadge status={o.orderStatus} />
                  </div>
                  <span className="text-lg font-bold text-foreground">
                    {formatPeso(o.total)}
                  </span>
                </div>

                {/* Hero — the name the staff calls out, big & bold like the order number */}
                <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
                  <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                    <Volume2 className="h-3 w-3" aria-hidden />
                    Call out
                  </p>
                  <p className="font-display text-2xl font-black leading-tight tracking-tight text-foreground sm:text-3xl">
                    <span className="break-words line-clamp-2">{callOutName(o)}</span>
                  </p>
                </div>

                {/* Real name (when the call-out name differs) + contact */}
                <div className="min-w-0 space-y-0.5">
                  {callOutName(o) !== (o.customerName || "") && (
                    <p className="truncate text-sm font-medium text-muted-foreground">
                      {o.customerName || "Walk-in"}
                    </p>
                  )}
                  {o.customerEmail && (
                    <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <Mail className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{o.customerEmail}</span>
                      <CopyEmailButton email={o.customerEmail} />
                    </p>
                  )}
                </div>

                <ul className="space-y-1">
                  {o.items.map((item, idx) => (
                    <li key={`${o.orderId}-${item.productId}-${item.temperature ?? "x"}-${idx}`} className="text-sm text-foreground">
                      <span className="font-semibold">{item.quantity} ×</span>{" "}
                      {item.productName}
                      {item.temperature && (
                        <span className="text-muted-foreground"> — {item.temperature}</span>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="gap-1.5 text-xs">
                    {o.paymentMethod === "GCASH" ? (
                      <Smartphone className="h-3 w-3" aria-hidden />
                    ) : (
                      <Wallet className="h-3 w-3" aria-hidden />
                    )}
                    {paymentMethodLabel(o.paymentMethod)}
                  </Badge>
                  <PaymentStatusBadge status={o.paymentStatus} />
                  {o.scannedAt && (
                    <span className="text-xs text-muted-foreground">
                      Scanned {formatTime(o.scannedAt)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button className="h-11 font-semibold" onClick={() => setServeOrder(o)}>
                    <Coffee aria-hidden />
                    SERVE
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 border-destructive/40 font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setAbortOrder(o)}
                  >
                    <Ban aria-hidden />
                    ABORT
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {serveOrder && (
        <ServeConfirm
          order={serveOrder}
          open={serveOrder !== null}
          onOpenChange={(o) => {
            if (!o) setServeOrder(null);
          }}
          onDone={() => setServeOrder(null)}
        />
      )}
      {abortOrder && (
        <AbortConfirm
          order={abortOrder}
          open={abortOrder !== null}
          onOpenChange={(o) => {
            if (!o) setAbortOrder(null);
          }}
          onDone={() => setAbortOrder(null)}
        />
      )}
    </div>
  );
}
