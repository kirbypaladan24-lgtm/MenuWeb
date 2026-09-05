"use client";

// Shared helpers for the booth UI — owned by booth agent.

import * as React from "react";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import type { Order } from "@/lib/types";

/**
 * Root of every booth query key. Invalidating this prefix refreshes
 * every booth view (dashboard, orders, waiting, products, settings).
 */
export const BOOTH_QK = ["booth"] as const;

/**
 * Reports request errors: toasts a destructive message and clears the
 */
export function useApiError() {
  const { toast } = useToast();
  return React.useCallback(
    (err: unknown, fallback = "Something went wrong. Please try again.") => {
      if (err instanceof ApiError) {
        toast({
          title: "Request failed",
          description: err.message || fallback,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Request failed", description: fallback, variant: "destructive" });
    },
    [toast]
  );
}

/**
 * Normalizes endpoints that may return `T[]` directly or `{ key: T[] }`
 * (e.g. `{ orders: [...] }`), so the UI tolerates either contract shape.
 */
export function asList<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const inner = (data as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

/**
 * Unwraps an order payload that may be `{ order: Order }` or a bare `Order`.
 * Throws when the response contains no order at all.
 */
export function unwrapOrder(res: unknown): Order {
  if (res && typeof res === "object") {
    const wrapped = (res as { order?: unknown }).order;
    if (wrapped && typeof wrapped === "object" && "orderId" in wrapped) {
      return wrapped as Order;
    }
    if ("orderId" in (res as Record<string, unknown>)) {
      return res as unknown as Order;
    }
  }
  throw new Error("Unexpected response from server");
}

/** Normalize manual Order-ID input: "007", "ord-7" → "ORD-0007". */
export function normalizeOrderId(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (/^\d{1,4}$/.test(s)) return `ORD-${s.padStart(4, "0")}`;
  const m = /^ORD-(\d{1,4})$/.exec(s);
  if (m) return `ORD-${m[1].padStart(4, "0")}`;
  return null;
}

/** The name the staff should call out for an order: alias first, name fallback. */
export function callOutName(order: Pick<Order, "customerName" | "customerAlias">): string {
  return order.customerAlias?.trim() || order.customerName?.trim() || "Walk-in";
}
