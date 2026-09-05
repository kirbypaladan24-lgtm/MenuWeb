"use client";

// Color palette pickers for the admin console.
// Two faces of the same system (src/lib/palettes.ts):
//  - <PalettePicker />      big card grid for the Settings view
//  - <PaletteMenuButton />  compact dropdown for the shell (sidebar + mobile bar)
// Both apply instantly (html[data-palette]) and persist per device.

import * as React from "react";
import { Check, Moon, Palette, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PALETTES, usePalette } from "@/lib/palettes";
import type { PaletteDef } from "@/lib/palettes";

/** Row of preview dots — background, card, primary, accent. */
function Swatches({
  palette,
  size = "sm",
}: {
  palette: PaletteDef;
  size?: "sm" | "md";
}) {
  const dots = [
    palette.swatches.background,
    palette.swatches.card,
    palette.swatches.primary,
    palette.swatches.accent,
  ];
  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-hidden>
      {dots.map((color, i) => (
        <span
          key={i}
          className={cn(
            "inline-block rounded-full ring-1 ring-border/60",
            size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5"
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

/** Big card grid — Settings → Color palette. */
export function PalettePicker() {
  const { paletteId, setPalette } = usePalette();
  const { toast } = useToast();

  function pick(p: PaletteDef) {
    setPalette(p.id);
    toast({
      title: "✓ Palette applied",
      description: `${p.name} — saved on this device.`,
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Console color palette"
      className="grid gap-3 sm:grid-cols-2"
    >
      {PALETTES.map((p) => {
        const active = p.id === paletteId;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => pick(p)}
            className={cn(
              "flex flex-col gap-2.5 rounded-xl border p-4 text-left transition-all hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border bg-card hover:border-primary/40"
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-display text-sm font-bold text-foreground">
                  {p.name}
                </span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    p.isDark
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-accent text-accent-foreground"
                  )}
                >
                  {p.isDark ? (
                    <Moon className="h-3 w-3" aria-hidden />
                  ) : (
                    <Sun className="h-3 w-3" aria-hidden />
                  )}
                  {p.isDark ? "Dark" : "Light"}
                </span>
              </span>
              {active && (
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                  aria-label="Active palette"
                >
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                </span>
              )}
            </span>
            <Swatches palette={p} size="md" />
            <span className="text-xs leading-relaxed text-muted-foreground">
              {p.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Compact dropdown — shell sidebar (label) + mobile top bar (icon). */
export function PaletteMenuButton({
  showLabel = true,
  placement = "sidebar",
  className,
}: {
  showLabel?: boolean;
  placement?: "sidebar" | "header";
  className?: string;
}) {
  const { paletteId, palette, setPalette } = usePalette();
  const { toast } = useToast();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={showLabel ? "sm" : "icon"}
          className={cn(
            showLabel && "w-full justify-start gap-2 font-semibold",
            className
          )}
          aria-label={`Color palette: ${palette.name}. Change palette.`}
        >
          <Palette className="h-4 w-4 shrink-0" aria-hidden />
          {showLabel && (
            <span className="min-w-0 flex-1 truncate text-left">
              {palette.name}
            </span>
          )}
          {showLabel && (
            <span
              className="ml-auto hidden h-2 w-2 shrink-0 rounded-full bg-primary sm:inline-block"
              aria-hidden
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={placement === "sidebar" ? "top" : "bottom"}
        align={placement === "sidebar" ? "start" : "end"}
        className="w-64"
      >
        <DropdownMenuLabel className="text-xs font-bold uppercase tracking-wider">
          Color palette
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PALETTES.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => {
              setPalette(p.id);
              toast({
                title: "✓ Palette applied",
                description: `${p.name} — saved on this device.`,
              });
            }}
            className="gap-2.5"
            aria-checked={p.id === paletteId}
            role="menuitemradio"
          >
            <Swatches palette={p} />
            <span className="min-w-0 flex-1 truncate font-medium">
              {p.name}
            </span>
            {p.id === paletteId && (
              <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
