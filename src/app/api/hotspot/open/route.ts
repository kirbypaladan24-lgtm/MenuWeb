// POST /api/hotspot/open — "Open Hotspot" button (Scanner view).
//
// Starts the local phone-scanner bridge:
//   1. tries to bring the laptop's Wi-Fi hotspot up AUTOMATICALLY
//      (Linux + NetworkManager via nmcli: shared AP, WPA2);
//   2. falls back to MANUAL mode (numbered steps per platform) — the local
//      receive server + scan feed run either way;
//   3. returns the session (ssid/password/urls) the Scanner panel shows.
//
// The phone scanner app joins the hotspot and posts decoded Order-QR text
// to /api/hotspot/scan — fully offline, this laptop stays the source of
// truth. Idempotent: opening while already open just returns the session.
import { requireRole } from "@/lib/auth";
import { errorResponse, fail, readJson, unauthorized } from "@/app/api/_lib/http";
import { corsJson, corsOptions, hotspotStore } from "@/app/api/_lib/hotspot-store";
import {
  enableLinuxHotspot,
  findWifiIface,
  localCandidateUrls,
  manualInstructions,
  nmcliAvailable,
} from "@/app/api/_lib/hotspot-os";
import type { HotspotStatusResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT_SSID = "CoffeePP-Booth";
const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

function randomPassword(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)];
  }
  return out;
}

function statusResponse(): HotspotStatusResponse {
  return {
    hotspot: hotspotStore.session,
    phones: hotspotStore.listPhones(),
    events: hotspotStore.eventsSince(0),
    lastEventId: hotspotStore.lastEventId,
    totalScans: hotspotStore.scanTotal,
  };
}

export async function POST(req: Request) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const body = (await readJson(req)) ?? {};

    // Idempotent — the panel may re-open after a view switch.
    if (hotspotStore.session?.active) {
      return corsJson(statusResponse());
    }

    // Wi-Fi name / password (optional overrides — the panel remembers
    // the booth's last values and sends them back).
    let ssid = DEFAULT_SSID;
    if (typeof body.ssid === "string" && body.ssid.trim() !== "") {
      ssid = body.ssid.trim().slice(0, 32);
    }
    let password = "";
    if (typeof body.password === "string" && body.password !== "") {
      password = body.password;
    }
    if (password !== "" && (password.length < 8 || password.length > 63)) {
      fail(400, "Wi-Fi password must be 8–63 characters (WPA2).", "PASSWORD_INVALID");
    }
    if (password === "") password = randomPassword();

    const serverPort = Number(process.env.PORT ?? 3000) || 3000;
    const platform = process.platform;

    // ---- Automatic hotspot (Linux + NetworkManager) ------------------
    let mode: "auto" | "manual" = "manual";
    let autoIp: string | null = null;
    let autoError: string | null = null;
    let urls: string[] = [];

    if (platform === "linux") {
      const hasNmcli = await nmcliAvailable();
      if (hasNmcli) {
        const iface = await findWifiIface();
        if (!iface) {
          autoError = "No Wi-Fi adapter was found — start the hotspot manually.";
        } else {
          const enabled = await enableLinuxHotspot({ ssid, password, iface });
          if (enabled.ok) {
            mode = "auto";
            autoIp = enabled.ip;
            if (enabled.ip) urls.push(`http://${enabled.ip}:${serverPort}`);
          } else {
            autoError = `Hotspot could not be started automatically (${enabled.error}). Start it manually.`;
          }
        }
      }
    }

    // Always include every local address as candidates (definitive first).
    for (const candidate of localCandidateUrls(serverPort)) {
      if (!urls.includes(candidate.url)) urls.push(candidate.url);
    }

    hotspotStore.openSession({
      mode,
      ssid,
      password,
      autoIp,
      autoError,
      serverPort,
      urls,
      platform,
      instructions: mode === "manual" ? manualInstructions(platform) : null,
    });

    return corsJson(statusResponse());
  } catch (err) {
    return errorResponse(err, "POST /api/hotspot/open");
  }
}

export async function OPTIONS() {
  return corsOptions();
}
