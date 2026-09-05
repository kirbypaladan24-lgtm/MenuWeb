import * as React from "react";
import { cn } from "@/lib/utils";
import { Coffee } from "lucide-react";

/** Intentional empty state — icon, title, description */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        {icon ?? <Coffee className="h-6 w-6" aria-hidden />}
      </div>
      <div className="space-y-1">
        <p className="font-display text-lg font-semibold text-foreground">
          {title}
        </p>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
