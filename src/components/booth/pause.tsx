"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { PauseCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PALETTES, usePalette } from "@/lib/palettes";
import { cn } from "@/lib/utils";

/**
 * Full-screen pause overlay matching the console's active color palette.
 * Uses <DialogPrimitive.Portal> to break out of all DOM hierarchies and cover everything.
 */
export function PauseConsoleModal() {
  const [open, setOpen] = React.useState(false);
  const { palette } = usePalette();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {/* Trigger Button styled like the console's PaletteMenuButton */}
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 font-semibold"
        >
          <PauseCircle
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-left">
            Pause Console
          </span>
        </Button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        {/* Fullscreen Backdrop matching active theme background */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        {/* Fullscreen Modal Viewport */}
        <DialogPrimitive.Content className="fixed inset-0 z-[100] flex flex-col items-center justify-between p-8 text-center select-none outline-none focus:outline-none">
          {/* Header branding */}
          <div className="flex w-full max-w-sm items-center justify-center border-b border-border/40 pb-6">
            <div
              className="h-10 w-44 bg-foreground"
              style={{
                maskImage: "url(/logo-name.svg)",
                WebkitMaskImage: "url(/logo-name.svg)",
                maskSize: "contain",
                WebkitMaskSize: "contain",
                maskPosition: "center",
                WebkitMaskPosition: "center",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
              }}
              aria-label="Coffee++ Logo"
              role="img"
            />
          </div>

          {/* Central Notice & Palette Swatch Indicator */}
          <div className="flex max-w-md flex-col items-center gap-6 my-auto">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-border/60 bg-card shadow-lg">
              <PauseCircle
                className="h-10 w-10 text-primary"
                strokeWidth={1.75}
              />
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-primary" />
              </span>
            </div>

            <div className="space-y-2">
              <DialogPrimitive.Title className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Booth Console on Pause
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                Ordering and live register operations are currently suspended.
                Tap below to resume sales on this device.
              </DialogPrimitive.Description>
            </div>
          </div>

          {/* Action to Resume Operations */}
          <div className="w-full max-w-xs pt-6 border-t border-border/40">
            <DialogPrimitive.Close asChild>
              <Button
                size="lg"
                className="w-full gap-2 rounded-xl py-6 font-semibold shadow-md transition-all active:scale-95"
              >
                <Play className="h-4 w-4 fill-current" />
                Resume Console
              </Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
