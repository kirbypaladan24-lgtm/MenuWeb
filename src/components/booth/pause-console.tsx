"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Lock, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { usePause } from "@/lib/pause-context";

export function PauseConsoleButton() {
  const { pauseConsole } = usePause();

  return (
    <Button
      onClick={pauseConsole}
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2 font-semibold transition-colors hover:bg-muted/50"
    >
      <PauseCircle
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-left">Pause Console</span>
    </Button>
  );
}

export function GlobalPauseModal() {
  const { isPaused, resumeConsole } = usePause();
  const [pin, setPin] = React.useState("");
  const [isError, setIsError] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const EXPECTED_PIN = process.env.NEXT_PUBLIC_PIN || "0000";

  React.useEffect(() => {
    if (isPaused) {
      setPin("");
      setIsError(false);
      const timeout = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timeout);
    }
  }, [isPaused]);

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "");

    if (value.length <= 4) {
      setPin(value);
      if (isError) setIsError(false);
    }

    if (value.length === 4) {
      if (value === EXPECTED_PIN) {
        resumeConsole();
        setPin("");
      } else {
        setIsError(true);
        setTimeout(() => {
          setPin("");
          setIsError(false);
        }, 500);
      }
    }
  };

  const handleContainerClick = () => inputRef.current?.focus();

  return (
    <DialogPrimitive.Root open={isPaused}>
      {/* initial={false} prevents the animation on initial mount (hard refresh) */}
      <AnimatePresence initial={false}>
        {isPaused && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
                animate={{ opacity: 1, backdropFilter: "blur(12px)" }}
                exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="fixed inset-0 z-[100] bg-background/90"
              />
            </DialogPrimitive.Overlay>

            <DialogPrimitive.Content
              asChild
              forceMount
              onInteractOutside={(e) => e.preventDefault()}
              onEscapeKeyDown={(e) => e.preventDefault()}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 15 }}
                transition={{ type: "spring", bounce: 0, duration: 0.4 }}
                className="fixed inset-0 z-[100] flex flex-col items-center justify-between p-8 text-center select-none outline-none focus:outline-none"
              >
                <div className="flex w-full max-w-sm items-center justify-center border-b border-border/40 pb-6">
                  <div
                    className="h-10 w-44 bg-foreground"
                    style={{
                      maskImage: "url(/logo-name.svg)",
                      WebkitMaskImage: "url(/logo-name.svg)",
                      maskSize: "contain",
                      maskRepeat: "no-repeat",
                      maskPosition: "center",
                    }}
                    role="img"
                  />
                </div>

                <div className="flex w-full max-w-md flex-col items-center gap-8 my-auto">
                  <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl border border-border/50 bg-gradient-to-b from-card to-muted shadow-2xl">
                    <Lock
                      className="h-10 w-10 text-primary"
                      strokeWidth={1.75}
                    />
                    <span className="absolute -top-1 -right-1 flex h-4 w-4">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
                      <span className="relative inline-flex h-4 w-4 rounded-full bg-primary" />
                    </span>
                  </div>

                  <div className="space-y-3">
                    <DialogPrimitive.Title className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                      Console Paused
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="text-sm leading-relaxed text-muted-foreground sm:text-base max-w-[280px] mx-auto">
                      Operations are suspended. Enter your manager PIN to
                      resume.
                    </DialogPrimitive.Description>
                  </div>

                  <div
                    className="flex flex-col items-center gap-4 mt-4 cursor-text"
                    onClick={handleContainerClick}
                  >
                    <input
                      ref={inputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      value={pin}
                      onChange={handlePinChange}
                      className="opacity-0 absolute w-0 h-0 pointer-events-none"
                    />

                    <motion.div
                      className="flex gap-3"
                      animate={isError ? { x: [-10, 10, -10, 10, 0] } : {}}
                      transition={{ duration: 0.4 }}
                    >
                      {[0, 1, 2, 3].map((index) => {
                        const digit = pin[index];
                        const isActive = pin.length === index;

                        return (
                          <div
                            key={index}
                            className={cn(
                              "flex h-16 w-14 items-center justify-center rounded-xl border-2 text-2xl font-bold transition-all duration-200",
                              isError &&
                                "border-destructive text-destructive bg-destructive/10",
                              digit &&
                                !isError &&
                                "border-primary text-foreground bg-primary/5",
                              isActive &&
                                !isError &&
                                "border-primary ring-4 ring-primary/20",
                              !digit &&
                                !isActive &&
                                !isError &&
                                "border-border bg-card text-muted-foreground",
                            )}
                          >
                            <AnimatePresence mode="popLayout">
                              {digit && (
                                <motion.span
                                  initial={{ scale: 0.5, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  exit={{ scale: 0.5, opacity: 0 }}
                                >
                                  •
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </motion.div>

                    <div className="h-4">
                      <AnimatePresence>
                        {isError && (
                          <motion.p
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="text-sm font-medium text-destructive"
                          >
                            Incorrect PIN. Try again.
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                <div className="w-full max-w-xs pt-6 border-t border-border/40">
                  <Button
                    variant="ghost"
                    size="lg"
                    className="w-full gap-2 rounded-xl py-6 font-semibold text-muted-foreground hover:text-foreground transition-all"
                    onClick={() => inputRef.current?.focus()}
                  >
                    Need Help?
                  </Button>
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
