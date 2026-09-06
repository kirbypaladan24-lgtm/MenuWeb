"use client";

// Coffee++ "Open Hotspot" panel — the Scanner's SECOND scanning option.
//
// Poor laptop cameras (glare, autofocus, lighting) make customer Order QRs
// hard to read, so this panel turns the admin laptop into the local server:
//   1. "Open Hotspot" hosts a Wi-Fi hotspot (auto via NetworkManager on
//      Linux, otherwise short manual steps for Windows/macOS);
//   2. a separate phone scanner app joins that Wi-Fi, scans customer Order
//      QRs with the phone camera and POSTs the decoded text to
//      /api/hotspot/scan on THIS laptop — fully offline, no internet;
//   3. received scans stream into the same result card + SERVE/ABORT flow
//      the camera uses (scanner.tsx applies each event), and land in the
//      live feed below. The laptop stays the source of truth; the phone is
//      just a sharper pair of eyes. The camera scanner keeps working the
//      whole time.
//
// The panel polls /api/hotspot/status (withEvents=1) every 2s while open,
// remembers the booth's Wi-Fi name/password in localStorage, and shows a
// Wi-Fi join QR so the phone's own camera app can join the network.

import * as React from "react";
import QRCode from "qrcode";
import Image from "next/image";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  Radio,
  RefreshCw,
  SearchX,
  Settings2,
  Smartphone,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatPeso, formatTime, shortOrderId } from "@/lib/format";
import type {
  HotspotPhone,
  HotspotScanEvent,
  HotspotScanOutcome,
  HotspotSession,
  HotspotStatusResponse,
} from "@/lib/types";
import { callOutName, useApiError } from "./booth-utils";

const POLL_MS = 2_000;
const DEFAULT_SSID = "CoffeePP-Booth";
const SSID_STORAGE_KEY = "coffeepp.hotspot.ssid";
const PASSWORD_STORAGE_KEY = "coffeepp.hotspot.password";
const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

function randomPassword(len = 8): string {
  const bytes = new Uint32Array(len);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => PASSWORD_CHARS[n % PASSWORD_CHARS.length]).join("");
}

/** Escape the reserved characters of the Wi-Fi QR payload format. */
function wifiEscape(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** Standard "join this Wi-Fi" QR payload (iOS/Android camera apps read it). */
function wifiQrPayload(ssid: string, password: string): string {
  return `WIFI:T:WPA;S:${wifiEscape(ssid)};P:${wifiEscape(password)};;`;
}

function lastSeenLabel(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function mergeEvents(
  prev: HotspotScanEvent[],
  incoming: HotspotScanEvent[]
): HotspotScanEvent[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

function CopyValueButton({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // http / older browsers — hidden textarea fallback
        const area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      toast({ title: "✓ Copied", description: value });
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Copy failed", description: value, variant: "destructive" });
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={() => void handleCopy()}
      aria-label={ariaLabel}
      title={value}
    >
      {copied ? (
        <Check className="h-4 w-4 text-success" aria-hidden />
      ) : (
        <Copy className="h-4 w-4" aria-hidden />
      )}
      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

function describeEvent(ev: HotspotScanEvent): string {
  const order = ev.order;
  switch (ev.outcome) {
    case "registered":
      return order
        ? `${shortOrderId(order.orderId)} · ${callOutName(order)} · ${formatPeso(order.total)}${
            ev.warnings.length > 0 ? ` · ${ev.warnings.length} warning${ev.warnings.length > 1 ? "s" : ""}` : ""
          }`
        : (ev.message ?? "Order registered");
    case "lookup-waiting":
      return order
        ? `${shortOrderId(order.orderId)} · ${callOutName(order)} — already in line`
        : (ev.message ?? "Already in line");
    case "lookup-served":
      return order
        ? `${shortOrderId(order.orderId)} — already served`
        : (ev.message ?? "Already served");
    case "lookup-aborted":
      return order
        ? `${shortOrderId(order.orderId)} — already aborted`
        : (ev.message ?? "Already aborted");
    case "not-found":
      return ev.message ?? "Order not registered yet";
    case "invalid":
      return ev.message ?? `Not a Coffee++ order (${ev.preview}…)`;
    case "error":
      return ev.message
        ? `${ev.message}${ev.code ? ` (${ev.code})` : ""}`
        : "The scan was rejected";
  }
}

const OUTCOME_META: Record<
  HotspotScanOutcome,
  { icon: typeof CheckCircle2; className: string; label: string }
> = {
  registered: { icon: CheckCircle2, className: "text-success", label: "Registered" },
  "lookup-waiting": { icon: Clock, className: "text-primary", label: "Already in line" },
  "lookup-served": { icon: CheckCircle2, className: "text-success", label: "Already served" },
  "lookup-aborted": { icon: Ban, className: "text-muted-foreground", label: "Already aborted" },
  "not-found": { icon: SearchX, className: "text-warning-foreground", label: "Not found" },
  invalid: { icon: Ban, className: "text-destructive", label: "Invalid" },
  error: { icon: AlertTriangle, className: "text-destructive", label: "Rejected" },
};

function ScanRow({ ev, onPick }: { ev: HotspotScanEvent; onPick: (ev: HotspotScanEvent) => void }) {
  const meta = OUTCOME_META[ev.outcome];
  const Icon = meta.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(ev)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-left transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${meta.label}: ${describeEvent(ev)}`}
      >
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {formatTime(ev.ts)}
        </span>
        <Icon className={cn("h-4 w-4 shrink-0", meta.className)} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {describeEvent(ev)}
        </span>
        {ev.deviceName && (
          <span className="hidden max-w-24 shrink-0 truncate text-[10px] text-muted-foreground sm:inline">
            {ev.deviceName}
          </span>
        )}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Hotspot panel                                                       */
/* ------------------------------------------------------------------ */

export interface HotspotPanelProps {
  /**
   * A scan arrived from a phone (auto = straight from the live poll;
   * false = the operator clicked a feed row). scanner.tsx routes it into
   * the same result card + SERVE/ABORT flow the camera uses.
   */
  onScanEvent: (ev: HotspotScanEvent, auto: boolean) => void;
}

export function HotspotPanel({ onScanEvent }: HotspotPanelProps) {
  const { toast } = useToast();
  const apiError = useApiError();

  const [session, setSession] = React.useState<HotspotSession | null>(null);
  const [phones, setPhones] = React.useState<HotspotPhone[]>([]);
  const [events, setEvents] = React.useState<HotspotScanEvent[]>([]);
  const [totalScans, setTotalScans] = React.useState(0);
  const [busy, setBusy] = React.useState<"open" | "close" | null>(null);
  const [customize, setCustomize] = React.useState(false);
  const [ssid, setSsid] = React.useState(DEFAULT_SSID);
  const [password, setPassword] = React.useState("");
  const [qrSrc, setQrSrc] = React.useState<string | null>(null);

  // Load the booth's remembered Wi-Fi values (or generate a fresh password).
  React.useEffect(() => {
    let savedSsid: string | null = null;
    let savedPassword: string | null = null;
    try {
      savedSsid = window.localStorage.getItem(SSID_STORAGE_KEY);
      savedPassword = window.localStorage.getItem(PASSWORD_STORAGE_KEY);
    } catch {
      // private mode etc. — fall through to defaults
    }
    if (savedSsid && savedSsid.trim() !== "") setSsid(savedSsid.trim().slice(0, 32));
    if (savedPassword && savedPassword.length >= 8) setPassword(savedPassword);
    else setPassword(randomPassword());
  }, []);

  // Persist them for the next shift.
  React.useEffect(() => {
    if (password === "") return;
    try {
      window.localStorage.setItem(SSID_STORAGE_KEY, ssid);
      window.localStorage.setItem(PASSWORD_STORAGE_KEY, password);
    } catch {
      // ignore storage failures
    }
  }, [ssid, password]);

  // Probe once on mount — the hotspot may already be open (view switch).
  React.useEffect(() => {
    let cancelled = false;
    void apiFetch<HotspotStatusResponse>(
      "/api/hotspot/status?withEvents=1&since=0&deviceId=__console"
    )
      .then((res) => {
        if (cancelled || !res.hotspot?.active) return;
        setSession(res.hotspot);
        setPhones(res.phones ?? []);
        setEvents(res.events ?? []);
        setTotalScans(res.totalScans ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the scan-event callback fresh without restarting the poll loop.
  const onScanEventRef = React.useRef(onScanEvent);
  React.useEffect(() => {
    onScanEventRef.current = onScanEvent;
  });

  // Live poll while the hotspot is open: session + phones + new events.
  // The first poll only initializes the feed cursor — history is shown but
  // never auto-opens (the operator saw those scans already).
  React.useEffect(() => {
    if (!session?.active) return;
    let stopped = false;
    let first = true;
    let cursor = 0;

    async function poll() {
      try {
        const res = await apiFetch<HotspotStatusResponse>(
          `/api/hotspot/status?withEvents=1&since=${cursor}&deviceId=__console`
        );
        if (stopped) return;
        if (!res.hotspot?.active) {
          // The server lost the session (restart / closed elsewhere) —
          // collapse the panel instead of showing a stale "active" state.
          setSession(null);
          setPhones([]);
          setEvents([]);
          setTotalScans(0);
          return;
        }
        setPhones(res.phones ?? []);
        setTotalScans(res.totalScans ?? 0);
        const incoming = res.events ?? [];
        if (first) {
          first = false;
          cursor = res.lastEventId;
        } else {
          cursor = res.lastEventId;
          for (const ev of incoming) onScanEventRef.current(ev, true);
        }
        setEvents((prev) => mergeEvents(prev, incoming));
      } catch {
        // Transient poll failure — the next tick catches up.
      }
    }

    void poll();
    const timer = window.setInterval(() => {
      if (!document.hidden) void poll();
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [session?.active]);

  // Wi-Fi join QR for the current session credentials.
  React.useEffect(() => {
    if (!session?.active) {
      setQrSrc(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(wifiQrPayload(session.ssid, session.password), {
      width: 512,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000FF", light: "#FFFFFFFF" },
    })
      .then((src) => {
        if (!cancelled) setQrSrc(src);
      })
      .catch(() => {
        if (!cancelled) setQrSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.active, session?.ssid, session?.password]);

  async function openHotspot() {
    if (busy !== null) return;
    setBusy("open");
    try {
      const res = await apiFetch<HotspotStatusResponse>("/api/hotspot/open", {
        method: "POST",
        json: { ssid: ssid.trim(), password },
      });
      setSession(res.hotspot ?? null);
      setPhones(res.phones ?? []);
      setEvents(res.events ?? []);
      setTotalScans(res.totalScans ?? 0);
      if (res.hotspot?.active) {
        toast({
          title: "✓ Hotspot open",
          description:
            res.hotspot.mode === "auto"
              ? `Wi-Fi “${res.hotspot.ssid}” is broadcasting — join it on the scanner phone.`
              : `Session started — follow the Wi-Fi setup steps, then join the phone to “${res.hotspot.ssid}”.`,
        });
      }
    } catch (err) {
      apiError(err, "Could not open the hotspot.");
    } finally {
      setBusy(null);
    }
  }

  async function closeHotspot() {
    if (busy !== null) return;
    setBusy("close");
    try {
      await apiFetch<{ ok: boolean }>("/api/hotspot/close", {
        method: "POST",
        json: {},
      });
      setSession(null);
      setPhones([]);
      setEvents([]);
      setTotalScans(0);
      toast({
        title: "Hotspot closed",
        description: "Phone scanning is off — the laptop camera scanner was never affected.",
      });
    } catch (err) {
      apiError(err, "Could not close the hotspot.");
    } finally {
      setBusy(null);
    }
  }

  const canOpen = ssid.trim() !== "" && password.length >= 8 && password.length <= 63;

  /* ---------------- Collapsed: the "Open Hotspot" affordance --------- */
  if (!session?.active) {
    return (
      <Card className="w-full">
        <CardContent className="p-4">
          <div className="flex items-start gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wifi className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">Scan with a phone</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Camera struggling with glare or tiny QRs? Turn this laptop into a Wi-Fi
                hotspot and let a phone camera do the scanning — fully offline, this
                laptop stays in charge.
              </p>
            </div>
          </div>

          {customize && (
            <div className="mt-3 space-y-3 rounded-lg border bg-secondary/40 p-3">
              <div className="grid gap-1.5">
                <label
                  htmlFor="hotspot-ssid"
                  className="text-xs font-semibold text-foreground"
                >
                  Wi-Fi name
                </label>
                <Input
                  id="hotspot-ssid"
                  value={ssid}
                  onChange={(e) => setSsid(e.target.value)}
                  maxLength={32}
                  autoComplete="off"
                  className="h-10"
                  aria-describedby="hotspot-ssid-hint"
                />
                <p id="hotspot-ssid-hint" className="text-[11px] text-muted-foreground">
                  Broadcast as the hotspot network name.
                </p>
              </div>
              <div className="grid gap-1.5">
                <label
                  htmlFor="hotspot-password"
                  className="text-xs font-semibold text-foreground"
                >
                  Wi-Fi password (WPA2)
                </label>
                <div className="flex gap-2">
                  <Input
                    id="hotspot-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={63}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-10 flex-1 font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-10 shrink-0"
                    onClick={() => setPassword(randomPassword())}
                    aria-label="Generate a new random password"
                    title="Generate a new random password"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  8–63 characters — remembered for next time.
                </p>
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              className="h-11 flex-1 text-base font-semibold"
              onClick={() => void openHotspot()}
              disabled={busy !== null || !canOpen}
            >
              {busy === "open" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Wifi aria-hidden />
              )}
              Open Hotspot
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-11 shrink-0"
              onClick={() => setCustomize((c) => !c)}
              aria-expanded={customize}
              aria-label="Customize the Wi-Fi name and password"
              title="Customize the Wi-Fi name and password"
            >
              <Settings2 aria-hidden />
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            Wi-Fi: <span className="font-semibold">{ssid}</span> ·{" "}
            <span className="font-mono">{password}</span> — tap ⚙ to change
          </p>
        </CardContent>
      </Card>
    );
  }

  /* ---------------- Open: the live phone-scanner console ------------- */
  const connectedPhones = phones.filter(
    (p) => Date.now() - Date.parse(p.lastSeen) < 10_000
  );

  return (
    <Card className="w-full border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2.5">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wifi className="h-5 w-5" aria-hidden />
            <span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-success"
              aria-hidden
            />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">Hotspot active</CardTitle>
            <CardDescription>
              Open since {formatTime(session.openedAt)} · the camera scanner keeps
              working
            </CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant={session.mode === "auto" ? "default" : "secondary"}>
            {session.mode === "auto" ? "Wi-Fi auto-configured" : "Manual Wi-Fi setup"}
          </Badge>
          {connectedPhones.length > 0 && (
            <Badge variant="outline" className="gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
              {connectedPhones.length} phone{connectedPhones.length > 1 ? "s" : ""} connected
            </Badge>
          )}
          <Badge variant="outline">
            {totalScans} scan{totalScans === 1 ? "" : "s"} received
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 1 — join the Wi-Fi */}
        <div className="flex flex-col items-center gap-2.5 rounded-xl border bg-secondary/30 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Phone setup · 1 — join the Wi-Fi
          </p>
          <div className="rounded-lg bg-white p-2">
            {qrSrc ? (
              <Image
                src={qrSrc}
                alt={`QR code that joins the ${session.ssid} Wi-Fi network`}
                width={288}
                height={288}
                className="h-36 w-36"
                unoptimized
              />
            ) : (
              <div className="flex h-36 w-36 items-center justify-center rounded-lg border-2 border-dashed border-border text-xs text-muted-foreground">
                Generating QR…
              </div>
            )}
          </div>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            Scan this with the phone&apos;s camera app to join — or type the details
            below.
          </p>
          <dl className="w-full space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="shrink-0 text-muted-foreground">Wi-Fi name</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="truncate font-semibold text-foreground">
                  {session.ssid}
                </span>
                <CopyValueButton value={session.ssid} ariaLabel="Copy the Wi-Fi name" />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="shrink-0 text-muted-foreground">Password</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono font-semibold text-foreground">
                  {session.password}
                </span>
                <CopyValueButton value={session.password} ariaLabel="Copy the Wi-Fi password" />
              </dd>
            </div>
          </dl>
        </div>

        {/* 2 — point the scanner app at this server */}
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Phone setup · 2 — scanner app server
          </p>
          {session.urls.map((url, i) => (
            <div
              key={url}
              className="flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-1.5"
            >
              <span className="min-w-0 truncate font-mono text-sm font-semibold text-foreground">
                {url}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {i === 0 && session.urls.length > 1 && (
                  <Badge variant="secondary">most likely</Badge>
                )}
                <CopyValueButton value={url} ariaLabel="Copy the server address" />
              </span>
            </div>
          ))}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {session.urls.length > 1
              ? "If several are listed, use the one the phone can reach (usually the first)."
              : "Enter this address once in the phone scanner app's settings."}
          </p>
        </div>

        {/* Manual setup steps / auto-setup status */}
        {session.mode === "manual" && session.instructions ? (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3" role="note">
            <p className="flex items-start gap-2 text-sm font-semibold text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {session.instructions.title}
            </p>
            <ol className="ml-4 list-decimal space-y-1 text-xs leading-relaxed text-warning-foreground">
              {session.instructions.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="text-[11px] italic leading-relaxed text-warning-foreground/80">
              {session.instructions.note}
            </p>
            {session.autoError && (
              <p className="text-[11px] leading-relaxed text-warning-foreground/80">
                Auto-setup note: {session.autoError}
              </p>
            )}
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success" role="note">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Wi-Fi hotspot is broadcasting — join it on the scanner phone and start
            scanning. Scans open below, same as the camera.
          </p>
        )}

        {/* Scanner phones */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Radio className="h-3.5 w-3.5" aria-hidden />
            Scanner phones
          </p>
          {phones.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              No phone connected yet — it appears here (and stays live) the moment the
              scanner app talks to this server.
            </p>
          ) : (
            <ul className="space-y-1">
              {phones.map((phone) => {
                const fresh = Date.now() - Date.parse(phone.lastSeen) < 10_000;
                return (
                  <li
                    key={phone.deviceId}
                    className="flex min-h-9 items-center justify-between gap-2 rounded-lg border px-3 py-1 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          fresh ? "bg-success" : "bg-muted-foreground/40"
                        )}
                        aria-hidden
                      />
                      <Smartphone
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="truncate font-medium text-foreground">
                        {phone.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {phone.scanCount} scanned · {lastSeenLabel(phone.lastSeen)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Live feed of received scans */}
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Received scans — {events.length > 0 ? `${events.length} shown` : "waiting for the first"}
          </p>
          {events.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs leading-relaxed text-muted-foreground">
              Scans from the phone land here and open the same order card as the
              camera — confirm SERVE on the laptop as usual.
            </p>
          ) : (
            <ul
              className="max-h-64 space-y-1 overflow-y-auto scroll-thin pr-1"
              aria-label="Scans received from phones"
            >
              {events.map((ev) => (
                <ScanRow
                  key={ev.id}
                  ev={ev}
                  onPick={(e) => onScanEventRef.current(e, false)}
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full border-destructive/40 text-base font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void closeHotspot()}
          disabled={busy === "close"}
        >
          {busy === "close" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <WifiOff aria-hidden />
          )}
          Close Hotspot
        </Button>
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Phone scanning is a second option — the laptop camera keeps scanning
          normally while the hotspot is open.
        </p>
      </CardFooter>
    </Card>
  );
}
