import * as React from "react";
import { cn } from "@/lib/utils";
import {
  BadgeCheck,
  Ban,
  Clock3,
  CircleDollarSign,
  CircleAlert,
} from "lucide-react";
import type { OrderStatus, PaymentStatus } from "@/lib/types";

type Variant =
  | "neutral"
  | "waiting"
  | "success"
  | "destructive"
  | "warning"
  | "muted";

const variantClasses: Record<Variant, string> = {
  neutral: "bg-secondary text-secondary-foreground border-transparent",
  waiting: "bg-warning/15 text-warning-foreground border-warning/40",
  success: "bg-success/15 text-success border-success/40",
  destructive: "bg-destructive/10 text-destructive border-destructive/40",
  warning: "bg-warning/20 text-warning-foreground border-warning/50",
  muted: "bg-muted text-muted-foreground border-border",
};

const statusVariant: Record<OrderStatus, Variant> = {
  PENDING: "neutral",
  WAITING: "waiting",
  SERVED: "success",
  ABORTED: "destructive",
};

const paymentVariant: Record<PaymentStatus, Variant> = {
  UNPAID: "warning",
  PAID: "success",
};

function BadgeShell({
  variant,
  className,
  children,
}: {
  variant: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const icons: Record<OrderStatus, React.ReactNode> = {
    PENDING: <Clock3 className="h-3 w-3" aria-hidden />,
    WAITING: <Clock3 className="h-3 w-3" aria-hidden />,
    SERVED: <BadgeCheck className="h-3 w-3" aria-hidden />,
    ABORTED: <Ban className="h-3 w-3" aria-hidden />,
  };
  return (
    <BadgeShell variant={statusVariant[status]} className={className}>
      {icons[status]}
      {status}
    </BadgeShell>
  );
}

export function PaymentStatusBadge({
  status,
  method,
  className,
}: {
  status: PaymentStatus;
  method?: string;
  className?: string;
}) {
  return (
    <BadgeShell variant={paymentVariant[status]} className={className}>
      {status === "PAID" ? (
        <BadgeCheck className="h-3 w-3" aria-hidden />
      ) : (
        <CircleDollarSign className="h-3 w-3" aria-hidden />
      )}
      {status === "UNPAID" && method ? `UNPAID · ${method}` : status}
    </BadgeShell>
  );
}

export function AvailabilityBadge({
  soldOut,
  className,
}: {
  soldOut: boolean;
  className?: string;
}) {
  return (
    <BadgeShell variant={soldOut ? "muted" : "success"} className={className}>
      {soldOut ? (
        <CircleAlert className="h-3 w-3" aria-hidden />
      ) : (
        <BadgeCheck className="h-3 w-3" aria-hidden />
      )}
      {soldOut ? "SOLD OUT" : "AVAILABLE"}
    </BadgeShell>
  );
}
