"use client";

// Booth shell — desktop sidebar + mobile top bar / bottom nav + main content.

import * as React from "react";
import {
  FileSpreadsheet,
  LayoutDashboard,
  ListOrdered,
  Package,
  ReceiptText,
  ScanLine,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
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

export default function BoothShell({ view, onNavigate }: BoothShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2.5 border-b p-4">
          {/* SPECS org seal — leads the brand lockup, top left */}
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-border"
            title="SPECS — Society of Programmers and Enthusiasts in Computer Science, Partido State University"
          >
            <Image
              src="/images/brand/specs-logo.png"
              alt="SPECS organization seal"
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
            />
          </span>
          <BrandLogo compact />
        </div>
        <nav aria-label="Booth navigation" className="flex-1 space-y-1 overflow-y-auto scroll-thin p-3">
          {BOOTH_NAV.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const active = item.id === view;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "border-transparent font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
          <PaletteMenuButton />
          <div className="flex items-center gap-2.5 px-2 pb-1">
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
              <p className="truncate text-sm font-semibold leading-none text-foreground">
                SPECS Booth Console
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Partido State Univ · est. 2024
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 border-b bg-card md:hidden">
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
            <Badge variant="outline" className="gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest">
              Booth Console
            </Badge>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl p-4 pb-24 sm:p-6 md:pb-8">
          <div key={view} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
            {renderView(view, onNavigate)}
          </div>
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Booth navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card md:hidden"
      >
        <div className="flex overflow-x-auto scroll-thin px-1 pb-[env(safe-area-inset-bottom)]">
          {BOOTH_NAV.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const active = item.id === view;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 min-w-[76px] shrink-0 flex-col items-center justify-center gap-1 px-2 text-[10px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
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
    </div>
  );
}
