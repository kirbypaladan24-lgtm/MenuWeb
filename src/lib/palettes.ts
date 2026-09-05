"use client";

// Admin-only color palette system.
// The console ships with a cozy default and lets every staff member switch the
// whole UI between curated palettes (light AND dark). The choice is a
// per-device preference stored in localStorage — no server round-trip, and it
// never touches the customer-facing client site branding.
//
// How it works:
//  - globals.css defines the shadcn design tokens per palette under
//    `[data-palette="<id>"]` blocks on <html>. `:root` (no attribute) is the
//    cozy default, so even before JS runs the app renders cozy.
//  - layout.tsx runs a tiny pre-paint script that reads this module's storage
//    key and sets the attribute (whitelisted ids only) before first paint.
//  - This module is the TS mirror of that contract: palette metadata for the
//    picker UIs + apply/subscribe helpers + a `usePalette` hook.

import * as React from "react";

export const PALETTE_STORAGE_KEY = "coffeepp-admin:palette";

export interface PaletteDef {
  id: string;
  name: string;
  description: string;
  /** True when the palette is a dark theme (drives the badge + color-scheme). */
  isDark: boolean;
  /** Preview swatches (CSS color strings) for the picker cards. */
  swatches: {
    background: string;
    card: string;
    primary: string;
    accent: string;
  };
}

export const PALETTES: readonly PaletteDef[] = [
  {
    id: "cozy",
    name: "Cozy Cream",
    description:
      "Warm latte tones with soft caramel — the homey Coffee++ booth mood. Default.",
    isDark: false,
    swatches: {
      background: "oklch(0.977 0.013 85)",
      card: "oklch(0.998 0.006 85)",
      primary: "oklch(0.52 0.09 58)",
      accent: "oklch(0.907 0.05 76)",
    },
  },
  {
    id: "midnight-mint",
    name: "Midnight Mint",
    description:
      "Dark green and black with white text and a soft neon cyan glow — crisp night shifts.",
    isDark: true,
    swatches: {
      background: "oklch(0.155 0.018 168)",
      card: "oklch(0.205 0.028 170)",
      primary: "oklch(0.83 0.125 180)",
      accent: "oklch(0.29 0.05 174)",
    },
  },
  {
    id: "espresso",
    name: "Espresso Classic",
    description: "The original Coffee++ light theme — espresso brown on warm cream.",
    isDark: false,
    swatches: {
      background: "oklch(0.982 0.008 84)",
      card: "oklch(1 0 0)",
      primary: "oklch(0.44 0.09 45)",
      accent: "oklch(0.9 0.045 75)",
    },
  },
  {
    id: "matcha",
    name: "Matcha Latte",
    description: "Soft green-tinted paper with deep matcha greens — calm and botanical.",
    isDark: false,
    swatches: {
      background: "oklch(0.972 0.014 115)",
      card: "oklch(0.995 0.007 115)",
      primary: "oklch(0.44 0.075 140)",
      accent: "oklch(0.905 0.055 120)",
    },
  },
  {
    id: "golden-hour",
    name: "Golden Hour",
    description: "Deep espresso night warmed with honey amber — a candlelit booth.",
    isDark: true,
    swatches: {
      background: "oklch(0.185 0.018 55)",
      card: "oklch(0.245 0.028 55)",
      primary: "oklch(0.78 0.13 75)",
      accent: "oklch(0.33 0.055 65)",
    },
  },
  {
    id: "rosewood",
    name: "Rosewood",
    description: "Blush paper, dusty rose and plum inks — gentle and warm-hearted.",
    isDark: false,
    swatches: {
      background: "oklch(0.973 0.013 22)",
      card: "oklch(0.995 0.007 22)",
      primary: "oklch(0.5 0.11 20)",
      accent: "oklch(0.905 0.05 25)",
    },
  },
  {
    id: "charcoal",
    name: "Charcoal Night",
    description: "Neutral graphite surfaces with a single warm amber spark — sleek and quiet.",
    isDark: true,
    swatches: {
      background: "oklch(0.195 0.008 60)",
      card: "oklch(0.255 0.01 60)",
      primary: "oklch(0.75 0.115 70)",
      accent: "oklch(0.335 0.02 64)",
    },
  },
  {
    id: "polar-mint",
    name: "Polar Mint",
    description: "Crisp white and mint with pine greens and soft cyan accents — fresh and airy.",
    isDark: false,
    swatches: {
      background: "oklch(0.982 0.006 178)",
      card: "oklch(1 0 0)",
      primary: "oklch(0.42 0.075 172)",
      accent: "oklch(0.9 0.065 178)",
    },
  },
] as const;

export const DEFAULT_PALETTE_ID = "cozy";

/** Every valid id — mirrors the whitelist inside layout.tsx's boot script. */
export const PALETTE_IDS: readonly string[] = PALETTES.map((p) => p.id);

export function isPaletteId(value: string): boolean {
  return PALETTE_IDS.includes(value);
}

export function getPalette(id: string): PaletteDef {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/* ------------------------------------------------------------------ */
/* Apply + persist + subscribe (module-level, no provider needed)      */
/* ------------------------------------------------------------------ */

type Listener = (id: string) => void;
const listeners = new Set<Listener>();

function readStored(): string {
  try {
    const value = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return value && isPaletteId(value) ? value : DEFAULT_PALETTE_ID;
  } catch {
    return DEFAULT_PALETTE_ID;
  }
}

function currentAttribute(): string {
  if (typeof document === "undefined") return DEFAULT_PALETTE_ID;
  const value = document.documentElement.getAttribute("data-palette");
  return value && isPaletteId(value) ? value : DEFAULT_PALETTE_ID;
}

/** Switch the console to a palette: sets <html data-palette>, persists, notifies. */
export function applyPalette(id: string): void {
  const safe = isPaletteId(id) ? id : DEFAULT_PALETTE_ID;
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, safe);
  } catch {
    // Private-mode / storage disabled — the attribute still applies for this session.
  }
  document.documentElement.setAttribute("data-palette", safe);
  listeners.forEach((cb) => cb(safe));
}

/** Reset to the shipped cozy default. */
export function resetPalette(): void {
  applyPalette(DEFAULT_PALETTE_ID);
}

export function subscribePalette(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

/**
 * Current palette id, live-updating. Server snapshot is the cozy default so
 * hydration always matches the pre-paint boot script's fallback.
 */
export function usePalette(): {
  paletteId: string;
  palette: PaletteDef;
  setPalette: (id: string) => void;
} {
  const paletteId = React.useSyncExternalStore(
    subscribePalette,
    () => currentAttribute() || readStored(),
    () => DEFAULT_PALETTE_ID
  );
  const setPalette = React.useCallback((id: string) => applyPalette(id), []);
  return { paletteId, palette: getPalette(paletteId), setPalette };
}
