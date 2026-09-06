"use client";

// Coffee++ "Open Hotspot" panel — the Scanner's SECOND scanning option.
//
// Poor laptop cameras (glare, autofocus, lighting) make customer Order QRs
// hard to read, so this panel turns the admin laptop into the local server:
//   1. "Open Hotspot" hosts a REAL Wi-Fi hotspot on this laptop (auto:
//      NetworkManager on Linux · Windows Mobile Hotspot / Hosted Network
//      on Windows — it pops up in other devices' Wi-Fi lists);
//   2. a separate phone scanner app joins that Wi-Fi, scans customer Order
//      QRs with the phone camera and POSTs the decoded text to
//      /api/hotspot/scan on THIS laptop — fully offline, no internet;
//   3. received scans stream into the same result card + SERVE/ABORT flow
//      the camera uses (scanner.tsx applies each event), and land in the
//      live feed below. The laptop stays the source of truth; the phone is
//      just a sharper pair of eyes. The camera scanner keeps working the
//      whole time.
//
// The open panel is deliberately BIG: it owns the full-width strip under
// the scanner pair and shows the large "scanner server link" QR (the web
// link the phone app talks to). Joining the booth Wi-Fi itself is done by
// hand on the phone — the operator types the real hotspot password — so
// no join-the-Wi-Fi QR or credentials are shown here.
//
// The panel polls /api/hotspot/status (withEvents=1) every 2s while open,
// remembers the booth's Wi-Fi name/password in localStorage, and collapses
// into a one-row affordance when the hotspot is closed.

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
  QrCode as QrCodeIcon,
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

/** One of the two big square QR tiles (Wi-Fi join / server link). */
function QrTile({
  src,
  alt,
  label,
}: {
  src: string | null;
  alt: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-xl bg-white p-2.5 shadow-sm">
        {src ? (
          <Image
            src={src}
            alt={alt}
            width={384}
            height={384}
            className="h-44 w-44 md:h-52 md:w-52"
            unoptimized
          />
        ) : (
          <div className="flex h-44 w-44 items-center justify-center rounded-lg border-2 border-dashed border-border text-xs text-muted-foreground md:h-52 md:w-52">
            Generating QR…
          </div>
        )}
      </div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
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
  const [serverQrSrc, setServerQrSrc] = React.useState<string | null>(null);

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

  // The one big QR: the scanner server web link the phone app needs.
  // (Joining the booth Wi-Fi is done by hand on the phone — with the real
  // hotspot password — so no join-the-Wi-Fi QR is shown here.)
  React.useEffect(() => {
    if (!session?.active) {
      setServerQrSrc(null);
      return;
    }
    let cancelled = false;
    const opts = {
      width: 512,
      margin: 1,
      errorCorrectionLevel: "M" as const,
      color: { dark: "#000000FF", light: "#FFFFFFFF" },
    };
    const serverUrl = session.urls[0] ?? "";
    if (serverUrl !== "") {
      QRCode.toDataURL(serverUrl, opts)
        .then((src) => {
          if (!cancelled) setServerQrSrc(src);
        })
        .catch(() => {
          if (!cancelled) setServerQrSrc(null);
        });
    } else {
      setServerQrSrc(null);
    }
    return () => {
      cancelled = true;
    };
  }, [session?.active, session?.urls]);

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
              ? `Wi-Fi “${res.hotspot.ssid}” is broadcasting — it already pops up in nearby devices' Wi-Fi lists.`
              : `Session started — turn the laptop's Wi-Fi hotspot on (steps inside), then join “${res.hotspot.ssid}” on the phone.`,
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
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Wifi className="h-5.5 w-5.5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">Scan with a phone</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Camera struggling with glare or tiny QRs? Turn this laptop&apos;s Wi-Fi
                  hotspot on — it pops up on the scanner phone — and let the phone camera
                  do the scanning. Fully offline; this laptop stays in charge.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                className="h-12 flex-1 px-6 text-base font-semibold sm:flex-none"
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
                className="h-12 w-12 shrink-0"
                onClick={() => setCustomize((c) => !c)}
                aria-expanded={customize}
                aria-label="Customize the Wi-Fi name and password"
                title="Customize the Wi-Fi name and password"
              >
                <Settings2 aria-hidden />
              </Button>
            </div>
          </div>

          {customize && (
            <div className="mt-4 space-y-3 rounded-lg border bg-secondary/40 p-3">
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

          <p className="mt-3 text-center text-[11px] text-muted-foreground">
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
  const primaryUrl = session.urls[0] ?? null;
  const otherUrls = session.urls.slice(1);

  return (
    <Card className="w-full border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wifi className="h-5.5 w-5.5" aria-hidden />
              <span
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-success"
                aria-hidden
              />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">Hotspot active</CardTitle>
              <CardDescription>
                Broadcasting since {formatTime(session.openedAt)} · the camera scanner
                keeps working
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={session.mode === "auto" ? "default" : "secondary"}>
              {session.mode === "auto"
                ? `Hotspot on · ${session.autoMethod ?? "auto-configured"}`
                : "Manual Wi-Fi setup"}
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
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* The one phone-setup step: this laptop's server link. Joining the
            booth Wi-Fi is done by hand on the phone (Wi-Fi settings + the
            real hotspot password), so the panel doesn't show credentials. */}
        <section className="rounded-xl border bg-secondary/30 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Phone setup — scanner server link
          </p>
          <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
            <QrTile
              src={serverQrSrc}
              alt={
                primaryUrl
                  ? `QR code of the scanner server web link ${primaryUrl}`
                  : "QR code of the scanner server web link"
              }
              label="Scan the link"
            />
            <div className="w-full min-w-0 flex-1 space-y-2">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Join the booth Wi-Fi on the phone first (Android settings, the
                real hotspot password), then let the phone scanner app scan
                this link — or type it — once in its settings:
              </p>
              {primaryUrl ? (
                <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-1.5">
                  <span className="min-w-0 truncate font-mono text-sm font-bold text-foreground">
                    {primaryUrl}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {session.urls.length > 1 && (
                      <Badge variant="secondary">most likely</Badge>
                    )}
                    <CopyValueButton value={primaryUrl} ariaLabel="Copy the server address" />
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No local address found yet — it appears once the laptop joins a network.
                </p>
              )}
              {otherUrls.length > 0 && (
                <ul className="space-y-1">
                  {otherUrls.map((url) => (
                    <li
                      key={url}
                      className="flex min-h-9 items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-1"
                    >
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                        {url}
                      </span>
                      <CopyValueButton value={url} ariaLabel="Copy the alternate server address" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

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
                Why automatic setup didn&apos;t work: {session.autoError}
              </p>
            )}
          </div>
        ) : (
          <p
            className="flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success"
            role="note"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            The Wi-Fi hotspot is broadcasting — other devices can see{" "}
            <span className="font-semibold">{session.ssid}</span> in their Wi-Fi lists
            right now. Join it on the scanner phone and start scanning; scans open
            below, same as the camera.
          </p>
        )}

        {/* Windows Firewall couldn't be opened automatically — the most
            common "phone joined but can't connect" cause. */}
        {session.firewallHint && (
          <p
            className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning-foreground"
            role="note"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Windows Firewall approval was skipped, so the phone may join the Wi-Fi but
            not reach the server. Fix once: Windows Security → Firewall &amp; network
            protection → Allow an app through firewall → tick{" "}
            <span className="font-semibold">Node.js</span> for Private AND Public — or
            relaunch this console as Administrator and reopen the hotspot.
          </p>
        )}

        {/* Scanner phones + received scans, side by side on wide screens */}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <Radio className="h-3.5 w-3.5" aria-hidden />
              Scanner phones
            </p>
            {phones.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-xs leading-relaxed text-muted-foreground">
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
          </section>

          <section className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <QrCodeIcon className="h-3.5 w-3.5" aria-hidden />
              Received scans — {events.length > 0 ? `${events.length} shown` : "waiting for the first"}
            </p>
            {events.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-xs leading-relaxed text-muted-foreground">
                Scans from the phone land here and open the same order card as the
                camera — confirm SERVE on the laptop as usual.
              </p>
            ) : (
              <ul
                className="max-h-80 space-y-1 overflow-y-auto scroll-thin pr-1"
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
          </section>
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
