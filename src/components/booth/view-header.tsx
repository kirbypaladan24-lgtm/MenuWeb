"use client";

import * as React from "react";

/** Page header inside the booth shell: display-font title + description + action. */
export function ViewHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6 ${className ?? ""}`}
    >
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
