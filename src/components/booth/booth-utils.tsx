"use client";

// Shared helpers for the booth UI — owned by booth agent.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiFetch } from "@/lib/api";
import type { BoothInfo, Order } from "@/lib/types";

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

/* ------------------------------------------------------------------ */
/* Booth days — derived from the booth dates, never hardcoded           */
/* ------------------------------------------------------------------ */

/** One booth day tab: Day N + its calendar date (local time). */
export interface BoothDay {
  n: number;
  label: string;
  dateLabel: string;
}

/** Tab strip cap — absurd date ranges still render a usable filter. */
const MAX_DAY_TABS = 31;

/**
 * Booth day list from the booth start/end dates (inclusive calendar days,
 * local time) — the run length is data from Settings, so 1-day pop-ups
 * and week-long runs just work. Mirrors boothDayCount() on the server.
 */
export function boothDaysFromRange(startISO: string, endISO: string): BoothDay[] {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const count = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const total = Math.min(Math.max(count, 1), MAX_DAY_TABS);
  const days: BoothDay[] = [];
  for (let n = 1; n <= total; n += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + (n - 1));
    days.push({
      n,
      label: `Day ${n}`,
      dateLabel: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }
  return days;
}

/**
 * Booth day tabs for filters. Shares the ["booth", "info"] query so the
 * Settings save (which invalidates the BOOTH_QK prefix) refreshes the tabs
 * automatically. Falls back to no day tabs (All only) while loading or
 * when the booth info can't be read — filtering degrades, the page works.
 */
export function useBoothDays(): { days: BoothDay[]; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["booth", "info"],
    queryFn: () => apiFetch<BoothInfo>("/api/booth"),
  });
  const days = React.useMemo(() => {
    const settings = (data as BoothInfo | undefined)?.settings;
    if (!settings) return [];
    return boothDaysFromRange(settings.startDate, settings.endDate);
  }, [data]);
  return { days, isLoading };
}
