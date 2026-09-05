import * as React from "react";
import { cn } from "@/lib/utils";

/** Customer-site section heading: small eyebrow + display title + optional lead */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "center",
  className,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-2 sm:mb-10",
        align === "center" ? "items-center text-center" : "items-start text-left",
        className
      )}
    >
      <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-primary">
        {eyebrow}
      </span>
      <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {lead && (
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {lead}
        </p>
      )}
    </div>
  );
}
