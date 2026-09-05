"use client";

// QR scanner — the fastest path from customer QR to served drink.
// The customer site creates orders entirely OFFLINE; their Order QR embeds
// the full order JSON. Scanning it here REGISTERS the order
// (POST /api/orders/register) — the booth console's own waiting line,
// serve and abort flows then take over. Camera scanning via getUserMedia +
// jsQR, with an always-visible manual entry (paste the QR payload or type
// an Order ID) and a Manual Order dialog for walk-ins / camera failure.
//
// CONTINUOUS CAMERA: the camera NEVER closes — it starts once when the view
// mounts and keeps previewing/decoding across every phase (result, served,
// aborted, error, Manual Order dialog). A seen-code guard makes one
// physical QR fire exactly one action while it stays in view, so the
// operator can scan back-to-back customers without touching anything;
// presenting the SAME QR again (after taking it away) still registers
// another copy, as before.

import * as React from "react";
import jsQR from "jsqr";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CameraOff,
  CheckCircle2,
  ClipboardList,
  Coffee,
  Loader2,
  Mail,
  Minus,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  SearchX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/shared/status-badge";
import { apiFetch, ApiError } from "@/lib/api";
import { parseOrderQr, type QrOrderPayload } from "@/lib/qr";
import { useToast } from "@/hooks/use-toast";
import {
  formatDateTime,
  formatPeso,
  formatTime,
  paymentMethodLabel,
  shortOrderId,
} from "@/lib/format";
import type { Order, OrderStatus, PaymentMethod, Product, Temperature } from "@/lib/types";
import { asList, callOutName, unwrapOrder, useApiError } from "./booth-utils";
import { ViewHeader } from "./view-header";
import { AbortConfirm } from "./abort-confirm";
import { ServeConfirm } from "./serve-confirm";
import { WebMenuQR } from "./web-menu-qr";

type Phase = "scan" | "looking-up" | "result" | "served" | "aborted" | "error";

interface ErrorInfo {
  kind: "invalid" | "not-found" | "served" | "aborted" | "error";
  title: string;
  message: string;
  order?: Order;
}

const SCAN_INTERVAL_MS = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */
/* Manual Order dialog — walk-in customers / camera failure            */
/* ------------------------------------------------------------------ */

interface ManualOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hand the built payload to the scanner's register flow. */
  onRegister: (payload: QrOrderPayload) => void;
}

function ManualOrderDialog({ open, onOpenChange, onRegister }: ManualOrderDialogProps) {
  const [productId, setProductId] = React.useState("");
  const [temp, setTemp] = React.useState<Temperature>("HOT");
  const [qty, setQty] = React.useState(1);
  const [name, setName] = React.useState("");
  const [alias, setAlias] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [pay, setPay] = React.useState<PaymentMethod>("GCASH");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [emailError, setEmailError] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["booth", "products"],
    queryFn: () => apiFetch<unknown>("/api/products"),
  });
  const products = React.useMemo(() => asList<Product>(data, "products"), [data]);
  const selected = products.find((p) => p.id === productId) ?? null;

  // Reset the form every time the dialog is (re)opened.
  React.useEffect(() => {
    if (open) {
      setProductId("");
      setTemp("HOT");
      setQty(1);
      setName("");
      setAlias("");
      setEmail("");
      setPay("GCASH");
      setNameError(null);
      setEmailError(null);
    }
  }, [open]);

  function selectProduct(id: string) {
    setProductId(id);
    setQty(1); // predictable reset per product
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedAlias = alias.trim();
    const trimmedEmail = email.trim();

    let valid = true;
    if (trimmedName === "") {
      setNameError("Customer name is required.");
      valid = false;
    } else {
      setNameError(null);
    }
    if (trimmedEmail !== "" && !EMAIL_RE.test(trimmedEmail)) {
      setEmailError("That email address doesn't look valid.");
      valid = false;
    } else {
      setEmailError(null);
    }
    if (!selected || !valid) return;

    // No id — the server assigns the next sequential ORD-####.
    const subtotal = selected.price * qty;
    const payload: QrOrderPayload = {
      v: 1,
      name: trimmedName,
      ...(trimmedAlias !== "" ? { alias: trimmedAlias } : {}),
      email: trimmedEmail,
      items: [
        {
          pid: selected.id,
          q: qty,
          n: selected.name,
          t: selected.hasTemperature ? temp : (selected.defaultTemperature ?? null),
          s: subtotal,
        },
      ],
      total: subtotal,
      pay,
    };
    onOpenChange(false);
    onRegister(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-thin sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Manual Order</DialogTitle>
          <DialogDescription>
            For walk-in customers or when the camera can&apos;t read the QR. The
            Order ID is assigned automatically.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {/* Product */}
          <div className="grid gap-2">
            <Label htmlFor="manual-product">Product</Label>
            <Select value={productId} onValueChange={selectProduct}>
              <SelectTrigger id="manual-product" className="h-11 w-full" aria-label="Choose a product">
                <SelectValue placeholder="Choose a product…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id} disabled={!p.available}>
                    {p.name} — {formatPeso(p.price)}
                    {!p.available ? " (unavailable)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-muted-foreground">
                {selected.available
                  ? `${formatPeso(selected.price)} each`
                  : "Currently unavailable — registering will flag a warning."}
              </p>
            )}
          </div>

          {/* Temperature — fixed-temp items show what the customer gets */}
          {selected?.hasTemperature && (
            <div className="grid gap-2">
              <Label>Temperature</Label>
              <ToggleGroup
                type="single"
                value={temp}
                onValueChange={(v) => {
                  if (v === "HOT" || v === "COLD") setTemp(v);
                }}
                className="w-full"
                variant="outline"
              >
                <ToggleGroupItem value="HOT" className="h-11 flex-1 text-sm font-semibold" aria-label="Hot">
                  HOT
                </ToggleGroupItem>
                <ToggleGroupItem value="COLD" className="h-11 flex-1 text-sm font-semibold" aria-label="Cold">
                  COLD
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          {!selected?.hasTemperature && selected?.defaultTemperature && (
            <p
              className="rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm font-semibold text-secondary-foreground"
              role="note"
            >
              Served {selected.defaultTemperature === "HOT" ? "hot ☕ (no temperature choice)" : "cold ❄ (no temperature choice)"}
            </p>
          )}

          {/* Quantity */}
          <div className="grid gap-2">
            <span className="text-sm font-medium leading-none text-foreground">
              Quantity
            </span>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-11 w-11"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                aria-label="Decrease quantity"
              >
                <Minus aria-hidden />
              </Button>
              <span
                id="manual-qty"
                className="w-10 text-center text-xl font-bold tabular-nums"
                aria-live="polite"
              >
                {qty}
              </span>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-11"
                onClick={() => setQty((q) => q + 1)}
                aria-label="Increase quantity"
              >
                <Plus aria-hidden />
              </Button>
              <span className="text-xs text-muted-foreground">no limit</span>
            </div>
          </div>

          {/* Call-out name (optional — what the staff shouts) */}
          <div className="grid gap-2">
            <Label htmlFor="manual-alias">
              Call-out Name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="manual-alias"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="What to shout when it's ready — e.g. Kirby"
              className="h-11"
              disabled={!selected}
              maxLength={40}
              autoComplete="off"
            />
          </div>

          {/* Customer name */}
          <div className="grid gap-2">
            <Label htmlFor="manual-name">Customer Name</Label>
            <Input
              id="manual-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="Walk-in customer"
              className="h-11"
              disabled={!selected}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "manual-name-error" : undefined}
              autoComplete="off"
            />
            {nameError && (
              <p id="manual-name-error" className="text-xs font-medium text-destructive">
                {nameError}
              </p>
            )}
          </div>

          {/* Email (optional) */}
          <div className="grid gap-2">
            <Label htmlFor="manual-email">
              Email <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="manual-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              placeholder="customer@school.edu"
              className="h-11"
              disabled={!selected}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "manual-email-error" : undefined}
              autoComplete="off"
            />
            {emailError && (
              <p id="manual-email-error" className="text-xs font-medium text-destructive">
                {emailError}
              </p>
            )}
          </div>

          {/* Payment */}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-foreground">Payment</legend>
            <RadioGroup
              value={pay}
              onValueChange={(v) => setPay(v === "BOOTH" ? "BOOTH" : "GCASH")}
              className="grid grid-cols-2 gap-2"
            >
              <div className="flex h-12 items-center gap-2 rounded-lg border px-3 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/10">
                <RadioGroupItem value="GCASH" id="manual-pay-gcash" aria-label="Pay with GCash" />
                <Label htmlFor="manual-pay-gcash" className="cursor-pointer font-medium">
                  GCash
                </Label>
              </div>
              <div className="flex h-12 items-center gap-2 rounded-lg border px-3 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/10">
                <RadioGroupItem value="BOOTH" id="manual-pay-booth" aria-label="Pay at the booth" />
                <Label htmlFor="manual-pay-booth" className="cursor-pointer font-medium">
                  Pay at Booth
                </Label>
              </div>
            </RadioGroup>
          </fieldset>

          {/* Total */}
          <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2.5">
            <span className="text-sm font-medium text-secondary-foreground">
              Total{selected ? ` — ${qty} × ${formatPeso(selected.price)}` : ""}
            </span>
            <span className="text-lg font-bold text-secondary-foreground">
              {selected ? formatPeso(selected.price * qty) : "—"}
            </span>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-11">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="h-11 flex-1 font-semibold" disabled={!selected}>
              <ClipboardList aria-hidden />
              Create Order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Scanner                                                             */
/* ------------------------------------------------------------------ */

export default function Scanner() {
  const { toast } = useToast();
  const apiError = useApiError();

  const [phase, setPhase] = React.useState<Phase>("scan");
  const [order, setOrder] = React.useState<Order | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<ErrorInfo | null>(null);
  const [camStatus, setCamStatus] = React.useState<"starting" | "active" | "error">(
    "starting"
  );
  const [camMessage, setCamMessage] = React.useState<string | null>(null);
  const [manualId, setManualId] = React.useState("");
  const [manualOpen, setManualOpen] = React.useState(false);
  const [serveOpen, setServeOpen] = React.useState(false);
  const [abortOpen, setAbortOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<"register" | "lookup" | null>(null);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const lastScanRef = React.useRef(0);
  const handleDetectedRef = React.useRef<(text: string) => void>(() => {});
  // Mirror of `phase` the rAF loop can read without re-running the camera effect.
  const phaseRef = React.useRef<Phase>("scan");
  // Seen-code guard: the QR text currently (or recently) in front of the
  // camera. One physical QR fires one action; the lock clears ~0.6s after
  // the code leaves the view, so re-presenting the same QR later still
  // registers another copy of the order (the duplicate-scan feature).
  const seenCodeRef = React.useRef<{ code: string | null; missed: number }>({
    code: null,
    missed: 0,
  });

  // Keep the detection handler fresh for the rAF loop without restarting the camera.
  React.useEffect(() => {
    handleDetectedRef.current = handleDetected;
  });

  // Keep phaseRef in sync for the rAF loop.
  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Camera lifecycle: acquire ONCE on mount and keep it alive across every
  // phase (scan / result / served / aborted / error) and the Manual Order
  // dialog — the stream is only released when the view unmounts.
  React.useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamStatus("error");
        setCamMessage(
          "Camera is not supported in this browser. Use the manual entry below."
        );
        return;
      }
      setCamStatus("starting");
      setCamMessage(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute("playsinline", "true");
          video.play().catch(() => undefined);
        }
        setCamStatus("active");
      } catch (err) {
        if (cancelled) return;
        setCamStatus("error");
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setCamMessage(
            "Camera permission was denied. Allow camera access in your browser, or use the manual entry below."
          );
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setCamMessage("No usable camera was found. Use the manual entry below.");
        } else {
          setCamMessage("Camera is unavailable. Use the manual entry below.");
        }
      }
    }

    // Always-on rAF loop: previews every frame and decodes whenever the
    // camera has one. A decoded text only triggers an action when it is a
    // NEW code (different from seenCodeRef.code) and no request is in
    // flight — that is what makes back-to-back continuous scanning safe.
    const tick = (ts: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (
        video &&
        canvas &&
        video.readyState >= 2 &&
        ts - lastScanRef.current >= SCAN_INTERVAL_MS
      ) {
        lastScanRef.current = ts;
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w > 0 && h > 0) {
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            let text: string | null = null;
            try {
              ctx.drawImage(video, 0, 0, w, h);
              const imageData = ctx.getImageData(0, 0, w, h);
              const code = jsQR(imageData.data, w, h, {
                inversionAttempts: "attemptBoth",
              });
              text = code?.data ?? null;
            } catch {
              // Ignore single-frame decode errors.
            }
            // Seen-code guard — see seenCodeRef above.
            const seen = seenCodeRef.current;
            if (text && text.trim()) {
              seen.missed = 0;
              const isNewCode = seen.code !== text;
              seen.code = text;
              if (isNewCode && phaseRef.current !== "looking-up") {
                handleDetectedRef.current(text);
              }
            } else if (seen.code !== null) {
              seen.missed += 1;
              // ~0.6s with no QR in view clears the lock (5 ticks × 120ms).
              if (seen.missed >= 5) {
                seen.code = null;
                seen.missed = 0;
              }
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    void startCamera();
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // Mount-only camera lifecycle: the loop reads phase via phaseRef, so it
    // never needs to re-run.
  }, []);

  function resetScanner() {
    setOrder(null);
    setNote(null);
    setWarnings([]);
    setErrorInfo(null);
    setManualId("");
    setPhase("scan");
    setBusy(null);
  }

  function handleDetected(text: string) {
    const raw = text.trim();
    if (!raw) return;
    // Block re-entrancy immediately (before React commits the phase state)
    // so a second QR decoded in the same instant can't double-fire.
    phaseRef.current = "looking-up";
    // Accepts the v2 full-data JSON QR (registers the order) or a bare
    // ORD-#### code (looks up an already-registered order).
    const parsed = parseOrderQr(raw);
    if (!parsed) {
      setPhase("error");
      setErrorInfo({
        kind: "invalid",
        title: "Invalid QR code",
        message: `This QR code is not a Coffee++ order. Scanned text: “${raw.slice(0, 40)}”.`,
      });
      return;
    }
    if (parsed.payload) void handleRegister(parsed.payload);
    else void handleLookup(parsed.orderId);
  }

  /** Register a full QR payload (or a manually built order) as a new order. */
  async function handleRegister(payload: QrOrderPayload) {
    setPhase("looking-up");
    setBusy("register");
    setNote(null);
    setWarnings([]);
    try {
      const res = await apiFetch<{ order?: unknown; warnings?: unknown }>(
        "/api/orders/register",
        { method: "POST", json: payload }
      );
      const registered = unwrapOrder(res);
      const resWarnings = Array.isArray(res?.warnings)
        ? (res.warnings as unknown[]).filter(
            (w): w is string => typeof w === "string"
          )
        : [];
      setOrder(registered);
      setWarnings(resWarnings);
      setNote("Order registered — it is now in the waiting line.");
      setPhase("result");
      toast({
        title: "✓ Order registered",
        description: `${shortOrderId(registered.orderId)} · ${callOutName(registered)} · ${formatPeso(registered.total)} · ${paymentMethodLabel(registered.paymentMethod)}.${resWarnings.length > 0 ? " Check the warnings." : ""}`,
      });
    } catch (err) {
      handleOrderError(err, "register");
    } finally {
      setBusy(null);
    }
  }

  /** Look up an already-registered order by bare id (legacy / manual). */
  async function handleLookup(orderId: string) {
    setPhase("looking-up");
    setBusy("lookup");
    setNote(null);
    setWarnings([]);
    try {
      const res = await apiFetch<unknown>(`/api/orders/${orderId}`);
      const found = unwrapOrder(res);
      if (found.orderStatus === "WAITING" || found.orderStatus === "PENDING") {
        setOrder(found);
        setNote("Already in line — this order was registered earlier.");
        setPhase("result");
      } else {
        setDoneErrorCard(found);
      }
    } catch (err) {
      handleOrderError(err, "lookup");
    } finally {
      setBusy(null);
    }
  }

  function setDoneErrorCard(found: Order) {
    const done: OrderStatus = found.orderStatus;
    setPhase("error");
    setErrorInfo({
      kind: done === "SERVED" ? "served" : "aborted",
      title: done === "SERVED" ? "Order already served" : "Order already aborted",
      message: `Order ${shortOrderId(found.orderId)} was ${done === "SERVED" ? "served" : "aborted"}${found.completedAt ? ` at ${formatDateTime(found.completedAt)}` : ""}.${done === "ABORTED" ? " Aborted orders are not counted as sales." : ""}`,
      order: found,
    });
  }

  /** Shared error routing for register + lookup requests. */
  function handleOrderError(err: unknown, mode: "register" | "lookup") {
    if (err instanceof ApiError && err.order) {
      const o = unwrapOrder(err.order);
      if (o.orderStatus === "WAITING" || o.orderStatus === "PENDING") {
        setOrder(o);
        setWarnings([]);
        setNote("Already in line — this order was registered earlier.");
        setPhase("result");
        return;
      }
      setDoneErrorCard(o);
      return;
    }
    if (err instanceof ApiError && err.status === 404 && mode === "lookup") {
      setPhase("error");
      setErrorInfo({
        kind: "not-found",
        title: "Order not registered yet",
        message:
          "No registered order matches this ID. Scan the customer's full Order QR, or create a Manual Order.",
      });
      return;
    }
    apiError(
      err,
      mode === "register" ? "Could not register this order." : "Could not look up this order."
    );
    resetScanner();
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (phase === "looking-up") return;
    const raw = manualId.trim();
    if (!raw) return;
    // Manual entry accepts a pasted QR payload (JSON) OR an order id.
    const parsed = parseOrderQr(raw);
    if (!parsed) {
      setPhase("error");
      setErrorInfo({
        kind: "invalid",
        title: "Invalid entry",
        message:
          "Paste a full Order QR payload (starts with “{”) or type an Order ID like ORD-0007 / ORD-K7F2Q9.",
      });
      return;
    }
    if (parsed.payload) void handleRegister(parsed.payload);
    else void handleLookup(parsed.orderId);
  }

  const handleServed = React.useCallback((updated: Order) => {
    setOrder(updated);
    setNote(null);
    setWarnings([]);
    setPhase("served");
  }, []);

  const handleAborted = React.useCallback((updated: Order) => {
    setOrder(updated);
    setPhase("aborted");
  }, []);

  const errorTone =
    errorInfo?.kind === "served"
      ? "success"
      : "destructive";

  return (
    <div>
      <ViewHeader
        title="Scanner"
        description="Scan a customer's Order QR to register their order — it carries their call-out name, email, items and total. The camera stays live the whole time, so you can scan back-to-back without closing anything. Want more of the same order? Scan the same QR again — each scan adds another copy. No camera? Paste the payload or type the Order ID below."
      />

      {/* Scanner + customer web-menu QR — side by side as a centered pair
          on large screens (the web-menu QR sits to the LEFT of the scanner,
          the pair stays centered on the page with a generous gap between
          the two); stacked with the scanner first on small screens. */}
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-center lg:gap-16">
        {/* The scanner itself — camera + manual entry (the primary tool) */}
        <div className="order-1 mx-auto flex w-full max-w-sm flex-col gap-4 lg:order-2 lg:mx-0">
          {/* Camera view — NEVER unmounts: it previews through every phase
              so back-to-back scanning works without restart delays. */}
          <div className="w-full space-y-2">
            <div className="relative aspect-square overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                playsInline
                muted
                autoPlay
                aria-label="Camera view for QR scanning"
              />
              <canvas ref={canvasRef} className="hidden" aria-hidden />
              {/* scan frame */}
              <div
                className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/50"
                aria-hidden
              />
              {camStatus === "starting" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-sm font-medium text-white">
                  <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
                  Starting camera…
                </div>
              )}
              {camStatus === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-6 text-center text-sm text-white">
                  <CameraOff className="h-8 w-8" aria-hidden />
                  <p>{camMessage ?? "Camera unavailable. Use the manual entry below."}</p>
                </div>
              )}
              {phase === "looking-up" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-sm font-semibold text-white">
                  <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
                  {busy === "register" ? "Registering order…" : "Looking up order…"}
                </div>
              )}
              {camStatus === "active" && (
                <p className="absolute inset-x-0 bottom-3 text-center text-xs font-semibold uppercase tracking-widest text-white/80">
                  {phase === "scan"
                    ? "Point camera at Order QR"
                    : "Camera stays live — scan the next QR anytime"}
                </p>
              )}
            </div>
            <p className="sr-only">Camera status: {camStatus}</p>
          </div>

          {/* Manual entry — always visible fallback (QR payload or Order ID) */}
          <div className="w-full space-y-2">
            <form onSubmit={submitManual} className="space-y-2">
              <div className="flex gap-2">
                <Input
                  id="manual-order-id"
                  aria-label="Order ID or QR payload"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="Paste QR payload or Order ID"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={phase === "looking-up"}
                  className="h-12 flex-1 text-base font-medium"
                />
                <Button
                  type="submit"
                  className="h-12 px-5 text-base font-semibold"
                  disabled={phase === "looking-up" || !manualId.trim()}
                >
                  {phase === "looking-up" ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Search aria-hidden />
                  )}
                  Submit
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Paste the customer&apos;s QR payload (JSON) or type their Order ID —
                works even without a camera.
              </p>
            </form>
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base font-semibold"
              onClick={() => setManualOpen(true)}
            >
              <ClipboardList aria-hidden />
              Manual Order
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Walk-in customer or camera trouble? Create a Manual Order — the ID
              is assigned automatically.
            </p>
          </div>
        </div>

        {/* Customer web-menu QR — to the LEFT of the scanner; walk-bys scan
            it to order from their phone */}
        <div className="order-2 mx-auto w-full max-w-sm lg:order-1 lg:mx-0">
          <WebMenuQR />
        </div>
      </div>

      {/* Result */}
      {phase === "result" && order && (
        <Card className="mx-auto mt-6 w-full max-w-md animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Order
                </p>
                <p className="font-display text-3xl font-bold leading-tight text-foreground">
                  {shortOrderId(order.orderId)}
                </p>
                <p className="mt-1 font-display text-xl font-bold leading-tight text-primary">
                  <span className="break-words line-clamp-2">{callOutName(order)}</span>
                </p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {order.customerName || "Walk-in"} · {order.orderId}
                </p>
                {order.customerEmail && (
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{order.customerEmail}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <OrderStatusBadge status={order.orderStatus} />
                <PaymentStatusBadge status={order.paymentStatus} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1.5">
              {order.items.map((item, i) => (
                <li
                  key={`${item.productId}-${item.temperature ?? "x"}-${i}`}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span className="font-medium text-foreground">
                    {item.quantity} × {item.productName}
                    {item.temperature && (
                      <span className="text-muted-foreground"> — {item.temperature}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {formatPeso(item.subtotal)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-semibold text-foreground">Total</span>
              <span className="text-xl font-bold text-foreground">
                {formatPeso(order.total)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                Payment:{" "}
                <span className="font-medium text-foreground">
                  {paymentMethodLabel(order.paymentMethod)}
                </span>
              </span>
              {order.scannedAt && (
                <span>
                  Scanned:{" "}
                  <span className="font-medium text-foreground">
                    {formatTime(order.scannedAt)}
                  </span>
                </span>
              )}
            </div>
            {warnings.length > 0 && (
              <ul
                className="space-y-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5"
                role="note"
                aria-label="Registration warnings"
              >
                {warnings.map((w, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs font-medium text-warning-foreground"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
            {note && (
              <p className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground">
                {note}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <div className="grid w-full grid-cols-2 gap-2">
              <Button className="h-12 text-base font-semibold" onClick={() => setServeOpen(true)}>
                <Coffee aria-hidden />
                SERVE
              </Button>
              <Button
                variant="outline"
                className="h-12 border-destructive/40 text-base font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setAbortOpen(true)}
              >
                <Ban aria-hidden />
                ABORT
              </Button>
            </div>
            <Button variant="ghost" className="w-full" onClick={resetScanner}>
              <RotateCcw aria-hidden />
              Scan Another
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Served success */}
      {phase === "served" && order && (
        <Card className="mx-auto mt-6 w-full max-w-md border-success/40 animate-in fade-in zoom-in-95 duration-200">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-9 w-9" aria-hidden />
            </div>
            <p className="font-display text-2xl font-bold text-success">✓ ORDER SERVED</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Order {shortOrderId(order.orderId)} · {formatPeso(order.total)} ·{" "}
              {paymentMethodLabel(order.paymentMethod)}
              {order.completedAt ? ` · completed at ${formatTime(order.completedAt)}` : ""}
            </p>
            <Button className="mt-2 h-12 w-full max-w-xs text-base font-semibold" onClick={resetScanner}>
              <ScanLine aria-hidden />
              Scan Another Order
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Aborted state */}
      {phase === "aborted" && order && (
        <Card className="mx-auto mt-6 w-full max-w-md border-destructive/40 animate-in fade-in zoom-in-95 duration-200">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <Ban className="h-9 w-9" aria-hidden />
            </div>
            <p className="font-display text-2xl font-bold text-destructive">ORDER ABORTED</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Order {shortOrderId(order.orderId)} was not counted as a sale
              {order.abortReason ? ` — ${order.abortReason}` : ""}.
            </p>
            <Button className="mt-2 h-12 w-full max-w-xs text-base font-semibold" onClick={resetScanner}>
              <ScanLine aria-hidden />
              Scan Another Order
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {phase === "error" && errorInfo && (
        <Card
          className={`mx-auto mt-6 w-full max-w-md animate-in fade-in zoom-in-95 duration-200 ${
            errorTone === "success" ? "border-success/40" : "border-destructive/40"
          }`}
        >
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-full ${
                errorTone === "success"
                  ? "bg-success/15 text-success"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {errorInfo.kind === "not-found" ? (
                <SearchX className="h-9 w-9" aria-hidden />
              ) : errorInfo.kind === "served" ? (
                <CheckCircle2 className="h-9 w-9" aria-hidden />
              ) : (
                <Ban className="h-9 w-9" aria-hidden />
              )}
            </div>
            <p className="font-display text-xl font-bold text-foreground">
              {errorInfo.title}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">{errorInfo.message}</p>
            <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
              <Button className="h-12 text-base font-semibold" onClick={resetScanner}>
                <ScanLine aria-hidden />
                Scan Another
              </Button>
              {errorInfo.kind === "not-found" && (
                <Button
                  variant="outline"
                  className="h-12 text-base font-semibold"
                  onClick={() => {
                    resetScanner();
                    setManualOpen(true);
                  }}
                >
                  <ClipboardList aria-hidden />
                  Create Manual Order
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Order dialog */}
      <ManualOrderDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onRegister={(payload) => void handleRegister(payload)}
      />

      {order && (
        <>
          <ServeConfirm
            order={order}
            open={serveOpen}
            onOpenChange={setServeOpen}
            onDone={handleServed}
          />
          <AbortConfirm
            order={order}
            open={abortOpen}
            onOpenChange={setAbortOpen}
            onDone={handleAborted}
          />
        </>
      )}
    </div>
  );
}
