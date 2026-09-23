"use client";

// Booth shell — desktop sidebar + mobile top bar / bottom nav + main content.

import * as React from "react";
import {
  FileSpreadsheet,
  Grid2x2,
  LayoutDashboard,
  LayoutGrid,
  ListOrdered,
  Package,
  ReceiptText,
  ScanLine,
  Settings as SettingsIcon,
  Square,
  Columns2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BrandLogo } from "@/components/shared/brand-logo";
import { BOOTH_NAV } from "@/lib/constants";
import type { BoothView } from "@/lib/constants";
import { cn } from "@/lib/utils";
import Dashboard from "./dashboard";
import Scanner from "./scanner";
import { PaletteMenuButton } from "./palette-picker";
import WaitingLine from "./waiting-line";
import OrdersView from "./orders";
import ProductsView from "./products";
import ReportsView from "./reports";
import SettingsView from "./settings";
import { PauseConsoleButton } from "./pause-console";

const NAV_ICONS: Record<BoothView, LucideIcon> = {
  dashboard: LayoutDashboard,
  scanner: ScanLine,
  waiting: ListOrdered,
  orders: ReceiptText,
  products: Package,
  reports: FileSpreadsheet,
  settings: SettingsIcon,
};

/** Shorter labels for the mobile bottom nav. */
const SHORT_LABELS: Partial<Record<BoothView, string>> = {
  waiting: "Waiting",
};

/* ------------------------------------------------------------------ */
/* Split screen — Windows-style snap layouts, up to 4 panes             */
/* ------------------------------------------------------------------ */

const MAX_PANES = 4;

/** First view not already on screen (so a new pane opens something useful). */
function nextFreshView(panes: BoothView[]): BoothView {
  const fallback: BoothView[] = ["waiting", "scanner", "dashboard", "orders"];
  return (
    fallback.find((v) => !panes.includes(v)) ??
    BOOTH_NAV.find((n) => !panes.includes(n.id))?.id ??
    "dashboard"
  );
}

interface SnapOption {
  panes: number;
  label: string;
  icon: LucideIcon;
}

const SNAP_OPTIONS: SnapOption[] = [
  { panes: 1, label: "Single view", icon: Square },
  { panes: 2, label: "Split in halves", icon: Columns2 },
  { panes: 3, label: "Three columns", icon: LayoutGrid },
  { panes: 4, label: "Four squares", icon: Grid2x2 },
];

/** Miniature preview boxes, like the Windows snap picker. */
function SnapPreview({ panes, active }: { panes: number; active: boolean }) {
  // Static classes only — Tailwind never sees interpolated ones.
  const grid =
    panes === 1
      ? "grid-cols-1"
      : panes === 2
        ? "grid-cols-2"
        : panes === 3
          ? "grid-cols-3"
          : "grid-cols-2 grid-rows-2";
  return (
    <span className={cn("grid h-10 w-14 gap-0.5", grid)} aria-hidden>
      {Array.from({ length: panes }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "rounded-[3px] border",
            active
              ? "border-primary bg-primary/25"
              : "border-border bg-muted group-hover:border-primary/50"
          )}
        />
      ))}
    </span>
  );
}

function renderView(view: BoothView, onNavigate: (v: BoothView) => void) {
  switch (view) {
    case "dashboard":
      return <Dashboard />;
    case "scanner":
      return <Scanner />;
    case "waiting":
      return <WaitingLine onNavigate={onNavigate} />;
    case "orders":
      return <OrdersView />;
    case "products":
      return <ProductsView />;
    case "reports":
      return <ReportsView />;
    case "settings":
      return <SettingsView />;
  }
}

export interface BoothShellProps {
  view: BoothView;
  onNavigate: (view: BoothView) => void;
}

export default function BoothShell({ view: initialView, onNavigate }: BoothShellProps) {
  // Split-screen state. `initialView` seeds the first pane; after that the
  // shell owns its panes (sidebar / bottom nav drive the FOCUSED pane, so
  // scanning can live next to the waiting line).
  const [panes, setPanes] = React.useState<BoothView[]>([initialView]);
  const [focus, setFocus] = React.useState(0);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const split = panes.length > 1;
  const focal = panes[Math.min(focus, panes.length - 1)];

  const go = (v: BoothView) => {
    setPanes((prev) => prev.map((p, i) => (i === focus ? v : p)));
    onNavigate(v);
  };

  const setPaneView = (idx: number, v: BoothView) => {
    setPanes((prev) => prev.map((p, i) => (i === idx ? v : p)));
    setFocus(idx);
  };

  const applySnap = (n: number) => {
    setPanes((prev) => {
      if (n === 1) return [prev[Math.min(focus, prev.length - 1)]];
      const next = [...prev];
      while (next.length < n) next.push(nextFreshView(next));
      return next.slice(0, Math.min(n, MAX_PANES));
    });
    setFocus((f) => Math.min(f, n - 1));
    setPickerOpen(false);
  };

  const closePane = (idx: number) => {
    if (panes.length <= 1) return;
    const next = panes.filter((_, i) => i !== idx);
    setPanes(next);
    setFocus(Math.max(0, Math.min(focus, next.length - 1)));
  };

  // Escape backs out of split screen one pane at a time — never while a
  // dialog or menu owns the key (Radix keeps those).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (
        document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')
      ) {
        return;
      }
      setPanes((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)));
      setFocus(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const renderPaneBody = (paneView: BoothView, idx: number) => (
    <div
      key={`${idx}-${paneView}`}
      className="animate-in fade-in min-h-0 flex-1 duration-200"
    >
      {renderView(paneView, (v) => setPaneView(idx, v))}
    </div>
  );

  const renderPane = (paneView: BoothView, idx: number) => (
    <div
      key={idx}
      onMouseDown={() => setFocus(idx)}
      className={cn(
        // Split mode pins the frame to its Panel (h-full) — without it the
        // scroll area never bounds. Single mode keeps the classic flow
        // (no h-full: it would collapse page scroll).
        "flex min-h-0 min-w-0 flex-col overflow-hidden",
        split && "h-full w-full",
        split &&
          "rounded-xl border bg-card focus-within:border-primary/50",
        split &&
          focus === idx &&
          "border-primary/60 shadow-sm ring-1 ring-primary/30"
      )}
    >
      {/* Per-pane toolbar (split mode only): pick this frame's page, or
          close the frame. Single mode keeps the classic chromeless look. */}
      {split && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-card px-2 py-1.5">
          <span
            className="hidden h-2 w-2 shrink-0 rounded-full bg-success sm:block"
            aria-hidden
          />
          <Select value={paneView} onValueChange={(v) => setPaneView(idx, v as BoothView)}>
            <SelectTrigger
              className="h-8 min-w-0 flex-1 text-xs font-semibold"
              aria-label={`Page shown in split ${idx + 1}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOOTH_NAV.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => closePane(idx)}
            aria-label={`Close split ${idx + 1} (Esc closes splits too)`}
            title="Close this split"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}
      {/* Independent scroll per frame — waiting/orders keep their own
          full-height column behavior inside. overscroll-contain stops the
          wheel from chaining out to sibling frames. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-thin">
        {split ? (
          <div className="mx-auto w-full max-w-6xl p-3 sm:p-4">
            {renderPaneBody(paneView, idx)}
          </div>
        ) : (
          <div
            className={cn(
              "mx-auto w-full max-w-6xl",
              paneView === "waiting" || paneView === "orders"
                ? "flex h-[calc(100dvh-7.625rem-env(safe-area-inset-bottom))] flex-col p-4 pb-0 sm:p-6 sm:pb-0 md:h-dvh md:p-6 md:pb-0"
                : "p-4 pb-24 sm:p-6 md:pb-8"
            )}
          >
            <div
              key={paneView}
              className={cn(
                "animate-in fade-in slide-in-from-bottom-1 duration-200",
                (paneView === "waiting" || paneView === "orders") &&
                  "flex min-h-0 flex-1 flex-col"
              )}
            >
              {renderView(paneView, onNavigate)}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderSplit = () => {
    const handleClass =
      "mx-0.5 w-1.5 shrink-0 rounded-full bg-border transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary/70";
    const vHandleClass =
      "my-0.5 h-1.5 shrink-0 rounded-full bg-border transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary/70";
    if (panes.length === 2) {
      return (
        <PanelGroup direction="horizontal" className="h-full min-h-0 w-full flex-1">
          <Panel defaultSize={50} minSize={20} className="min-h-0 min-w-0">{renderPane(panes[0], 0)}</Panel>
          <PanelResizeHandle className={handleClass} aria-label="Resize splits" />
          <Panel defaultSize={50} minSize={20} className="min-h-0 min-w-0">{renderPane(panes[1], 1)}</Panel>
        </PanelGroup>
      );
    }
    if (panes.length === 3) {
      return (
        <PanelGroup direction="horizontal" className="h-full min-h-0 w-full flex-1">
          <Panel defaultSize={34} minSize={15} className="min-h-0 min-w-0">{renderPane(panes[0], 0)}</Panel>
          <PanelResizeHandle className={handleClass} aria-label="Resize splits" />
          <Panel defaultSize={33} minSize={15} className="min-h-0 min-w-0">{renderPane(panes[1], 1)}</Panel>
          <PanelResizeHandle className={handleClass} aria-label="Resize splits" />
          <Panel defaultSize={33} minSize={15} className="min-h-0 min-w-0">{renderPane(panes[2], 2)}</Panel>
        </PanelGroup>
      );
    }
    // Four panes — 2×2 grid, like the OS snap picker.
    return (
      <PanelGroup direction="vertical" className="h-full min-h-0 w-full flex-1">
        <Panel defaultSize={50} minSize={25} className="min-h-0 min-w-0">
          <PanelGroup direction="horizontal" className="h-full min-h-0 w-full">
            <Panel defaultSize={50} minSize={20} className="min-h-0 min-w-0">{renderPane(panes[0], 0)}</Panel>
            <PanelResizeHandle className={handleClass} aria-label="Resize splits" />
            <Panel defaultSize={50} minSize={20} className="min-h-0 min-w-0">{renderPane(panes[1], 1)}</Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className={vHandleClass} aria-label="Resize splits" />
        <Panel defaultSize={50} minSize={25} className="min-h-0 min-w-0">
          <PanelGroup direction="horizontal" className="h-full min-h-0 w-full">
            <Panel defaultSize={50} minSize={20} className="min-h-0 min-w-0">{renderPane(panes[2], 2)}</Panel>
            <PanelResizeHandle className={handleClass} aria-label="Resize splits" />
            <Panel defaultSize={50} minSize={20} className="min-h-0 min-w-0">{renderPane(panes[3], 3)}</Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    );
  };

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col bg-background md:flex-row",
        // Split mode locks the viewport: the page itself never scrolls, so
        // the wheel stays inside whichever frame the mouse is over.
        split && "h-dvh overflow-hidden"
      )}
    >
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2.5 border-b p-4">
          <div
            className="h-10 w-37.5 bg-foreground"
            style={{
              maskImage: "url(/logo-name.svg)",
              WebkitMaskImage: "url(/logo-name.svg)",
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskPosition: "left center",
              WebkitMaskPosition: "left center",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
            }}
            aria-label="Coffee++ Logo"
            role="img"
          />
        </div>
        <nav
          aria-label="Booth navigation"
          className="flex-1 space-y-1 overflow-y-auto scroll-thin p-3"
        >
          {BOOTH_NAV.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const active = item.id === focal;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "border-transparent font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="space-y-2 border-t p-3">
          {/* Quick palette switch — per-device, saved instantly */}
          <PauseConsoleButton />
          <PaletteMenuButton />
          <div className="flex items-center gap-2.5 pb-1">
            {/* SPECS org seal — the organization running this console */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-border">
              <Image
                src="/images/brand/specs-logo.png"
                alt="SPECS — Society of Programmers and Enthusiasts in Computer Science, Partido State University seal"
                width={34}
                height={34}
                className="h-8 w-8 object-contain"
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold leading-none text-foreground">
                SPECS Booth Console
              </p>
              <p className="text-[8px] font-semibold uppercase tracking-widest text-muted-foreground">
                Partido State Univ · est. 2024
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 shrink-0 border-b bg-card md:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <div className="flex items-center gap-2">
            {/* SPECS org seal — leads the brand lockup, top left */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-border">
              <Image
                src="/images/brand/specs-logo.png"
                alt="SPECS seal"
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
              />
            </span>
            <BrandLogo compact />
          </div>
          <div className="flex items-center gap-2">
            {/* Quick palette switch (compact) */}
            <PaletteMenuButton showLabel={false} placement="header" />
            <Badge
              variant="outline"
              className="gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest"
            >
              Booth Console
            </Badge>
          </div>
        </div>
      </header>

      {/* Main content — single view keeps the classic layout; split mode
          fills the locked viewport with independently scrolling resizable
          frames (bottom padding clears the fixed mobile bottom nav). */}
      <main className={cn(split ? "flex min-h-0 min-w-0 flex-1 flex-col" : "min-w-0 flex-1")}>
        {split ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 pb-[4.5rem] sm:p-3 sm:pb-[4.5rem] md:pb-3">
            {renderSplit()}
          </div>
        ) : (
          // Single mode — the original chromeless markup, untouched by the
          // split frame wrappers (they own scroll containers that fight
          // page scroll here).
          <div
            className={cn(
              "mx-auto w-full max-w-6xl",
              panes[0] === "waiting" || panes[0] === "orders"
                ? "flex h-[calc(100dvh-7.625rem-env(safe-area-inset-bottom))] flex-col p-4 pb-0 sm:p-6 sm:pb-0 md:h-dvh md:p-6 md:pb-0"
                : "p-4 pb-24 sm:p-6 md:pb-8",
            )}
          >
            <div
              key={panes[0]}
              className={cn(
                "animate-in fade-in slide-in-from-bottom-1 duration-200",
                (panes[0] === "waiting" || panes[0] === "orders") &&
                  "flex min-h-0 flex-1 flex-col",
              )}
            >
              {renderView(panes[0], onNavigate)}
            </div>
          </div>
        )}
      </main>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Booth navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card md:hidden"
      >
        <div className="flex overflow-x-auto scroll-thin px-1 pb-[env(safe-area-inset-bottom)]">
          {BOOTH_NAV.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const active = item.id === focal;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 min-w-[76px] shrink-0 flex-col items-center justify-center gap-1 px-2 text-[10px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <span
                    className="absolute top-0 h-0.5 w-8 rounded-full bg-primary"
                    aria-hidden
                  />
                )}
                <Icon className="h-5 w-5" aria-hidden />
                <span className="whitespace-nowrap">
                  {SHORT_LABELS[item.id] ?? item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      {/* Split-screen picker — floating action button on every page.
          Opens the OS-style snap layouts (single / halves / thirds /
          four squares, max 4 frames). Esc also backs out one frame. */}
      <div className="fixed right-4 bottom-[4.75rem] z-40 md:right-6 md:bottom-6">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              className="h-12 w-12 rounded-full shadow-lg"
              aria-label={split ? `Split screen on (${panes.length} frames) — change layout` : "Split screen — show two or more pages side by side"}
              title="Split screen"
            >
              <LayoutGrid className="h-5 w-5" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="w-64 p-2"
            aria-label="Snap layout picker"
          >
            <p className="px-2 pt-1 pb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Snap layout · max 4
            </p>
            <div className="grid grid-cols-2 gap-1">
              {SNAP_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = panes.length === opt.panes;
                return (
                  <button
                    key={opt.panes}
                    type="button"
                    onClick={() => applySnap(opt.panes)}
                    aria-pressed={active}
                    className={cn(
                      "group flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-transparent hover:border-border hover:bg-accent"
                    )}
                  >
                    <SnapPreview panes={opt.panes} active={active} />
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-foreground">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="px-2 pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Drag the dividers to resize · <kbd className="rounded border px-1 font-mono">Esc</kbd> closes a frame · sidebar switches the focused frame.
            </p>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
