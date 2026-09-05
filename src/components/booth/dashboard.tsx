"use client";

// Dashboard — live sales overview (10s auto-refresh) with optional day filter.

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import {
  Award,
  BadgeCheck,
  Ban,
  Banknote,
  Boxes,
  Check,
  Clock3,
  Loader2,
  Moon,
  RefreshCw,
  Sunrise,
  Sun,
  Sunset,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { EmptyState } from "@/components/shared/empty-state";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { BOOTH_DAYS } from "@/lib/constants";
import { formatPeso } from "@/lib/format";
import type { DashboardStats, TimeOfDayStat } from "@/lib/types";
import { BOOTH_QK, useApiError } from "./booth-utils";
import { ViewHeader } from "./view-header";

type DayFilter = "all" | "1" | "2" | "3";

/** Presentation meta for the four time-of-day buckets. */
const TIME_OF_DAY_META: {
  bucket: TimeOfDayStat["bucket"];
  label: string;
  range: string;
  icon: React.ReactNode;
  chipClass: string;
}[] = [
  {
    bucket: "MORNING",
    label: "Morning",
    range: "5 AM – 12 PM",
    icon: <Sunrise className="h-4 w-4" aria-hidden />,
    chipClass: "bg-warning/20 text-warning-foreground",
  },
  {
    bucket: "AFTERNOON",
    label: "Afternoon",
    range: "12 PM – 6 PM",
    icon: <Sun className="h-4 w-4" aria-hidden />,
    chipClass: "bg-primary/10 text-primary",
  },
  {
    bucket: "EVENING",
    label: "Evening",
    range: "6 PM – 11 PM",
    icon: <Sunset className="h-4 w-4" aria-hidden />,
    chipClass: "bg-secondary text-secondary-foreground",
  },
  {
    bucket: "NIGHT",
    label: "Night",
    range: "11 PM – 5 AM",
    icon: <Moon className="h-4 w-4" aria-hidden />,
    chipClass: "bg-muted text-muted-foreground",
  },
];

function shortDay(date: string): string {
  try {
    return format(parseISO(date), "MMM d");
  } catch {
    return date;
  }
}

function StatCard({
  label,
  value,
  icon,
  chipClass,
  valueClass,
  cardClass,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  chipClass: string;
  valueClass?: string;
  cardClass?: string;
}) {
  return (
    <Card className={`gap-3 py-4 ${cardClass ?? ""}`}>
      <CardContent className="flex items-center gap-3 px-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${chipClass}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className={`truncate text-2xl font-bold tracking-tight ${valueClass ?? "text-foreground"}`}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Total Cost — the admin types how much they've spent running the booth
 * (ingredients, supplies…). Net Profit = Total Revenue − Total Cost.
 */
function TotalCostCard({ totalCost }: { totalCost: number }) {
  const { toast } = useToast();
  const apiError = useApiError();
  const queryClient = useQueryClient();
  const [value, setValue] = React.useState(String(totalCost));
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!saving) setValue(String(totalCost));
  }, [totalCost, saving]);

  async function handleSave() {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n) || n < 0) {
      toast({
        title: "Check the amount",
        description: "Total Cost must be zero or more pesos.",
        variant: "destructive",
      });
      return;
    }
    const amount = Math.round(n);
    setSaving(true);
    try {
      await apiFetch("/api/booth", { method: "PATCH", json: { totalCost: amount } });
      toast({
        title: "✓ Total Cost saved",
        description: `Net Profit now subtracts ${formatPeso(amount)} of spending.`,
      });
      await queryClient.invalidateQueries({ queryKey: BOOTH_QK });
    } catch (err) {
      apiError(err, "Could not save the Total Cost.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-primary/25 gap-4 py-4">
      <CardContent className="grid gap-4 px-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wallet className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Total Cost — money you spent
            </p>
            <p className="font-display text-2xl font-bold tracking-tight text-foreground">
              {formatPeso(totalCost)}
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="grid w-36 gap-1.5">
            <Label htmlFor="total-cost-input" className="text-xs font-semibold">
              Spent so far (₱)
            </Label>
            <Input
              id="total-cost-input"
              type="number"
              min={0}
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={saving}
              placeholder="1500"
            />
          </div>
          <Button
            className="h-10 font-semibold"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, icon, valueClass }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <Card className="gap-2 py-3">
      <CardContent className="flex items-center gap-2.5 px-4">
        <span className="text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className={`truncate text-lg font-bold ${valueClass ?? "text-foreground"}`}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * When People Buy — buyers per part of the day (morning / afternoon /
 * evening / night), bucketed by the moment each order was scanned at the
 * booth. The peak part of the day is highlighted.
 */
function TimeOfDayCard({ stats }: { stats: DashboardStats }) {
  const rows = TIME_OF_DAY_META.map((meta) => {
    const stat = stats.timeOfDay.find((t) => t.bucket === meta.bucket) ?? {
      bucket: meta.bucket,
      buyers: 0,
      items: 0,
      revenue: 0,
    };
    return { meta, stat };
  });
  const maxBuyers = Math.max(...rows.map((r) => r.stat.buyers), 1);
  const totalBuyers = rows.reduce((sum, r) => sum + r.stat.buyers, 0);
  const peak = totalBuyers > 0
    ? rows.reduce((a, b) => (b.stat.buyers > a.stat.buyers ? b : a))
    : null;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-primary" aria-hidden />
          When People Buy
        </CardTitle>
        <CardDescription>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 sm:px-6">
        {peak ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              Peak · {peak.meta.label}
            </span>
            <span className="text-muted-foreground">
              {peak.stat.buyers} {peak.stat.buyers === 1 ? "buyer" : "buyers"}{" "}
              {peak.meta.range.toLowerCase()} out of {totalBuyers} total
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No orders yet — buyer counts appear as soon as QRs are scanned.
          </p>
        )}
        <div className="space-y-3">
          {rows.map(({ meta, stat }) => (
            <div key={meta.bucket} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.chipClass}`}
                    aria-hidden
                  >
                    {meta.icon}
                  </span>
                  <span className="font-semibold text-foreground">{meta.label}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {meta.range}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`font-bold ${
                      peak?.meta.bucket === meta.bucket
                        ? "text-primary"
                        : "text-foreground"
                    }`}
                  >
                    {stat.buyers} {stat.buyers === 1 ? "buyer" : "buyers"}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {stat.items} items · {formatPeso(stat.revenue)}
                  </span>
                </span>
              </div>
              <div
                className="h-2.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`${meta.label} buyers`}
                aria-valuenow={stat.buyers}
                aria-valuemin={0}
                aria-valuemax={maxBuyers}
              >
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    peak?.meta.bucket === meta.bucket
                      ? "bg-chart-1"
                      : "bg-primary/25"
                  }`}
                  style={{ width: `${(stat.buyers / maxBuyers) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [day, setDay] = React.useState<DayFilter>("all");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["booth", "dashboard", day],
    queryFn: () =>
      apiFetch<DashboardStats>(
        day === "all" ? "/api/dashboard" : `/api/dashboard?day=${day}`
      ),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <div>
        <ViewHeader title="Dashboard" description="Loading live booth numbers…" />
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <ViewHeader title="Dashboard" description="Live sales overview." />
        <EmptyState
          icon={<RefreshCw className="h-6 w-6" aria-hidden />}
          title="Couldn't load the dashboard"
          description="Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              <RefreshCw aria-hidden />
              Try Again
            </Button>
          }
        />
      </div>
    );
  }

  const waiting = data.ordersWaiting ?? 0;
  const netProfit = data.netProfit ?? 0;
  const roiRaw = data.roi ?? 0;
  const roiPct = Math.abs(roiRaw) <= 1 ? roiRaw * 100 : roiRaw;
  const avgPerOrder =
    (data.ordersServed ?? 0) > 0
      ? (data.revenue ?? 0) / (data.ordersServed ?? 1)
      : 0;
  const gcash = data.paymentBreakdown?.gcash ?? 0;
  const booth = data.paymentBreakdown?.booth ?? 0;
  const payTotal = gcash + booth;
  const gcashPct = payTotal > 0 ? (gcash / payTotal) * 100 : 0;
  const boothPct = payTotal > 0 ? (booth / payTotal) * 100 : 0;
  const tempRows = (data.hotCold ?? []).filter((r) => r.hot + r.cold > 0);
  const hasSales = (data.ordersServed ?? 0) > 0 || (data.itemsSold ?? 0) > 0;
  const chartData = (data.dailySales ?? []).map((d) => ({
    label: shortDay(d.date),
    revenue: d.revenue,
  }));

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Dashboard"
        description="Live sales overview — refreshes every 10 seconds."
        action={
          <div className="flex items-center gap-2">
            {isFetching && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Updating
              </span>
            )}
            <Tabs value={day} onValueChange={(v) => setDay(v as DayFilter)}>
              <TabsList>
                <TabsTrigger value="all" className="text-xs sm:text-sm">
                  All
                </TabsTrigger>
                {BOOTH_DAYS.map((d, i) => (
                  <TabsTrigger key={d} value={String(i + 1)} className="text-xs sm:text-sm">
                    {d}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        }
      />

      {/* Primary stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Revenue"
          value={formatPeso(data.revenue ?? 0)}
          icon={<Banknote className="h-5 w-5" aria-hidden />}
          chipClass="bg-primary/10 text-primary"
        />
        <StatCard
          label="Served Orders"
          value={String(data.ordersServed ?? 0)}
          icon={<BadgeCheck className="h-5 w-5" aria-hidden />}
          chipClass="bg-success/15 text-success"
        />
        <StatCard
          label="Waiting Orders"
          value={String(waiting)}
          icon={<Clock3 className="h-5 w-5" aria-hidden />}
          chipClass="bg-warning/20 text-warning-foreground"
          valueClass={waiting > 0 ? "text-warning-foreground" : "text-foreground"}
          cardClass={waiting > 0 ? "border-warning/50" : ""}
        />
        <StatCard
          label="Net Profit"
          value={formatPeso(netProfit)}
          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
          chipClass="bg-primary/10 text-primary"
          valueClass={netProfit > 0 ? "text-success" : netProfit < 0 ? "text-destructive" : "text-foreground"}
        />
      </div>

      {/* Total Cost — typed by the admin, feeds Net Profit */}
      <TotalCostCard totalCost={data.totalCost ?? 0} />

      {/* Secondary stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat
          label="Items Sold"
          value={String(data.itemsSold ?? 0)}
          icon={<Boxes className="h-4 w-4" aria-hidden />}
        />
        <MiniStat
          label="Aborted"
          value={String(data.ordersAborted ?? 0)}
          icon={<Ban className="h-4 w-4" aria-hidden />}
        />
        <MiniStat
          label="Avg / Order"
          value={formatPeso(Math.round(avgPerOrder))}
          icon={<Wallet className="h-4 w-4" aria-hidden />}
        />
        <MiniStat
          label="ROI"
          value={`${roiPct.toFixed(1)}%`}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          valueClass={roiPct > 0 ? "text-success" : roiPct < 0 ? "text-destructive" : "text-foreground"}
        />
      </div>

      {/* Best seller */}
      {data.bestSeller && (
        <Card className="border-warning/40 bg-secondary/50 gap-3 py-4">
          <CardContent className="flex items-center gap-4 px-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning-foreground">
              <Award className="h-6 w-6" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Best Seller
              </p>
              <p className="truncate font-display text-xl font-bold text-foreground">
                {data.bestSeller.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {data.bestSeller.sold} sold
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Time-of-day demand — always visible, even before any served sale */}
      <TimeOfDayCard stats={data} />

      {!hasSales ? (
        <EmptyState
          title="No sales yet"
          description="No sales yet — served orders will appear here."
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              <RefreshCw aria-hidden />
              Refresh
            </Button>
          }
        />
      ) : (
        <>
          {/* Product performance */}
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Product Performance</CardTitle>
              <CardDescription>
                Units sold and revenue per product (served orders only).
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4 sm:pl-0">Product</TableHead>
                    <TableHead>Sold</TableHead>
                    <TableHead className="pr-4 sm:pr-0">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.productStats ?? []).map((p) => (
                    <TableRow key={p.productId}>
                      <TableCell className="pl-4 font-medium sm:pl-0">{p.name}</TableCell>
                      <TableCell>{p.sold}</TableCell>
                      <TableCell className="pr-4 font-semibold sm:pr-0">
                        {formatPeso(p.revenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Charts row */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="gap-4">
              <CardHeader>
                <CardTitle>Daily Sales</CardTitle>
                <CardDescription>Served revenue per day.</CardDescription>
              </CardHeader>
              <CardContent className="px-4 sm:px-6">
                {chartData.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No sales recorded yet.
                  </p>
                ) : (
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          fontSize={12}
                          tick={{ fill: "var(--muted-foreground)" }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          fontSize={12}
                          width={52}
                          tick={{ fill: "var(--muted-foreground)" }}
                          tickFormatter={(v: number) => `₱${v}`}
                        />
                        <Tooltip
                          cursor={{ fill: "var(--muted)" }}
                          formatter={(value) => [formatPeso(Number(value)), "Revenue"] as [string, string]}
                          labelStyle={{ color: "var(--foreground)" }}
                          contentStyle={{
                            background: "var(--popover)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            color: "var(--popover-foreground)",
                          }}
                        />
                        <Bar dataKey="revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="gap-4">
              <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>GCash vs Pay at Booth (served revenue).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 px-4 sm:px-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">GCash</span>
                    <span className="font-semibold">{formatPeso(gcash)}</span>
                  </div>
                  <div
                    className="h-2.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="GCash share of revenue"
                    aria-valuenow={Math.round(gcashPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-chart-1 transition-all duration-300"
                      style={{ width: `${gcashPct}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Pay at Booth</span>
                    <span className="font-semibold">{formatPeso(booth)}</span>
                  </div>
                  <div
                    className="h-2.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Pay at Booth share of revenue"
                    aria-valuenow={Math.round(boothPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-chart-2 transition-all duration-300"
                      style={{ width: `${boothPct}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {payTotal === 0
                    ? "No payments recorded yet."
                    : `${Math.round(gcashPct)}% GCash · ${Math.round(boothPct)}% booth of ${formatPeso(payTotal)}.`}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Hot/Cold */}
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Hot vs Cold</CardTitle>
              <CardDescription>Drink sales by temperature.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 px-4 sm:px-6">
              {tempRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No drink sales yet.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {tempRows.map((r) => (
                    <div
                      key={r.productId}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-bold text-warning-foreground">
                          HOT {r.hot}
                        </span>
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">
                          COLD {r.cold}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
