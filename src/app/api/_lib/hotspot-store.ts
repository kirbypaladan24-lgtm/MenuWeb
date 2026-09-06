// Coffee++ hotspot bridge — in-memory session/phone/event store.
//
// "Open Hotspot" (Scanner view) turns this admin app into the LOCAL server
// for a separate phone scanner app: the laptop hosts a Wi-Fi hotspot, the
// phone joins it and posts decoded Order-QR text to /api/hotspot/scan.
// This module holds the live session state every hotspot route shares:
//   - session : the open hotspot (ssid/password/urls) or null
//   - phones  : heartbeat map of scanner phones (auto-expiring)
//   - events  : ring buffer of received phone scans (the Scanner's live feed)
//
// State is process memory — the admin console is a single laptop and the
// session is meant to live for one booth shift. The globalThis guard keeps
// the SAME instance across dev-server hot reloads.
//
// CORS: the phone app runs on a different origin (its own shell), so every
// hotspot route answers with open CORS headers. This is an offline LAN tool
// behind the hotspot's own WPA2 password — consistent with the console's
// no-auth design (see src/lib/auth.ts).

import { NextResponse } from "next/server";
import type { HotspotPhone, HotspotScanEvent, HotspotSession, HotspotScanOutcome } from "@/lib/types";

/** Phones disappear from the status list after this much heartbeat silence. */
const PHONE_TTL_MS = 30_000;
/** How many received scans the live feed keeps (newest kept). */
const EVENT_LIMIT = 100;

/** Shared CORS headers for the phone-facing hotspot routes. */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** JSON response with open CORS (phone app origin). */
export function corsJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

/** 204 for CORS preflights. */
export function corsOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export interface OpenSessionInput {
  mode: HotspotSession["mode"];
  ssid: string;
  password: string;
  autoIp: string | null;
  autoError: string | null;
  serverPort: number;
  urls: string[];
  platform: string;
  instructions: HotspotSession["instructions"];
}

export interface RecordEventInput {
  deviceId: string | null;
  deviceName: string | null;
  outcome: HotspotScanOutcome;
  message: string | null;
  code: string | null;
  order: HotspotScanEvent["order"];
  warnings: string[];
  preview: string;
}

class HotspotStore {
  session: HotspotSession | null = null;
  private phones = new Map<string, HotspotPhone>();
  private events: HotspotScanEvent[] = [];
  private nextEventId = 1;
  private totalScans = 0;

  openSession(input: OpenSessionInput): HotspotSession {
    this.session = {
      active: true,
      mode: input.mode,
      ssid: input.ssid,
      password: input.password,
      openedAt: new Date().toISOString(),
      autoIp: input.autoIp,
      autoError: input.autoError,
      serverPort: input.serverPort,
      urls: input.urls,
      platform: input.platform,
      instructions: input.instructions,
    };
    this.phones.clear();
    this.events = [];
    this.nextEventId = 1;
    this.totalScans = 0;
    return this.session;
  }

  closeSession(): void {
    this.session = null;
    this.phones.clear();
    this.events = [];
    this.nextEventId = 1;
    this.totalScans = 0;
  }

  /** Log one received phone scan (the Scanner's live feed + history). */
  recordEvent(input: RecordEventInput): HotspotScanEvent {
    const event: HotspotScanEvent = {
      id: this.nextEventId++,
      ts: new Date().toISOString(),
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      outcome: input.outcome,
      message: input.message,
      code: input.code,
      order: input.order,
      warnings: input.warnings,
      preview: input.preview,
    };
    this.events.push(event);
    if (this.events.length > EVENT_LIMIT) {
      this.events.splice(0, this.events.length - EVENT_LIMIT);
    }
    this.totalScans += 1;
    if (input.deviceId) {
      const phone = this.phones.get(input.deviceId);
      if (phone) phone.scanCount += 1;
    }
    return event;
  }

  /** Heartbeat / registration of a scanner phone (status + scan calls). */
  touchPhone(deviceId: string, name?: string | null): void {
    if (deviceId === "" || deviceId.startsWith("__")) return; // "__console" = admin UI poll
    const existing = this.phones.get(deviceId);
    const cleanName = (name ?? "").trim().slice(0, 60);
    if (existing) {
      existing.lastSeen = new Date().toISOString();
      if (cleanName !== "") existing.name = cleanName;
    } else {
      this.phones.set(deviceId, {
        deviceId,
        name: cleanName !== "" ? cleanName : deviceId.slice(0, 12),
        lastSeen: new Date().toISOString(),
        scanCount: 0,
      });
    }
  }

  /** Drop phones whose heartbeat went silent. */
  prunePhones(now = Date.now()): void {
    for (const [id, phone] of this.phones) {
      if (now - Date.parse(phone.lastSeen) > PHONE_TTL_MS) {
        this.phones.delete(id);
      }
    }
  }

  listPhones(): HotspotPhone[] {
    this.prunePhones();
    return [...this.phones.values()].sort((a, b) =>
      a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : a.deviceId.localeCompare(b.deviceId)
    );
  }

  /** Events with id > since (admin UI polls with its last seen id). */
  eventsSince(since: number): HotspotScanEvent[] {
    return this.events.filter((e) => e.id > since);
  }

  get lastEventId(): number {
    return this.events.length > 0 ? this.events[this.events.length - 1].id : 0;
  }

  get scanTotal(): number {
    return this.totalScans;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __coffeeppHotspotStore?: HotspotStore;
};

export const hotspotStore: HotspotStore =
  globalStore.__coffeeppHotspotStore ?? (globalStore.__coffeeppHotspotStore = new HotspotStore());
