import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Coffee++ inline brand mark — espresso cup with steam.
 * BRAND-LOCKED COLOR: the cup is ALWAYS #324020 (dark olive), in light AND
 * dark mode, on both the client and admin apps. Do not switch these paths
 * back to currentColor / theme tokens — the logo never changes with theme.
 *
 * ADMIN-ONLY (this copy): the svg carries the `brand-mark` class so globals.css
 * can sit it on a cream plate (CSS vars) when a dark palette is active — the
 * cup color itself still never changes.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("brand-mark", className)}
      aria-hidden="true"
    >
      {/* steam */}
      <path
        d="M17 5c0 3-2 3-2 6s2 3 2 6M24 4c0 3-2 3-2 6s2 3 2 6M31 5c0 3-2 3-2 6s2 3 2 6"
        stroke="#324020"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* cup */}
      <path
        d="M10 20h25v7c0 8.284-5.596 13-12.5 13S10 35.284 10 27v-7Z"
        fill="#324020"
      />
      {/* handle */}
      <path
        d="M35 22h2.5a4.5 4.5 0 0 1 0 9H34"
        stroke="#324020"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* saucer */}
      <path
        d="M8 42h30"
        stroke="#324020"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* ++ */}
      <path
        d="M18.6 26.6v6M15.6 29.6h6M27.4 26.6v6M24.4 29.6h6"
        stroke="var(--brand-mark-plus, #E8D5BC)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Full wordmark lockup: mark + "Coffee++" in the display font */
export function BrandLogo({
  className,
  markClassName,
  compact = false,
}: {
  className?: string;
  markClassName?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {/* Mark color is brand-locked to #324020 — no text-* needed */}
      <BrandMark className={cn("h-9 w-9", markClassName)} />
      <span className="font-display font-bold leading-none tracking-tight">
        <span className="text-xl text-foreground sm:text-2xl">Coffee</span>
        <span className="text-xl text-primary sm:text-2xl">++</span>
        {!compact && (
          <span className="ml-2 hidden align-middle text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:inline">
            Campus Booth
          </span>
        )}
      </span>
    </span>
  );
}
