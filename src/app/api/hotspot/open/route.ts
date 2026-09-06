// POST /api/hotspot/open — "Open Hotspot" button (Scanner view).
//
// Starts the local phone-scanner bridge:
//   1. tries to bring the laptop's Wi-Fi hotspot up AUTOMATICALLY — a REAL
//      hotspot other devices can see and join:
//        Linux   → NetworkManager shared AP (nmcli, fully automatic)
//        Windows → Mobile Hotspot (WinRT, no UAC) → legacy Hosted Network
//                  (netsh, one UAC approval, works offline) — plus a
//                  Windows Firewall rule so phones can reach the server
//   2. falls back to MANUAL mode (numbered steps per platform) with the
//      actual reason auto-setup failed — the local receive server + scan
//      feed run either way;
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
  enableWindowsHostedNetwork,
  enableWindowsMobileHotspot,
  ensureWindowsFirewallRule,
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

    // ---- Bring the real hotspot up ------------------------------------
    let mode: "auto" | "manual" = "manual";
    let autoIp: string | null = null;
    let autoError: string | null = null;
    let autoMethod: string | null = null;
    let firewallHint = false;
    let urls: string[] = [];

    if (platform === "linux") {
      const hasNmcli = await nmcliAvailable();
      if (!hasNmcli) {
        autoError =
          "NetworkManager (nmcli) is not available on this machine — the Wi-Fi hotspot has to be turned on manually.";
      } else {
        const iface = await findWifiIface();
        if (!iface) {
          autoError = "No Wi-Fi adapter was found — the hotspot must be turned on manually.";
        } else {
          const enabled = await enableLinuxHotspot({ ssid, password, iface });
          if (enabled.ok) {
            mode = "auto";
            autoMethod = enabled.method;
            autoIp = enabled.ip;
            if (enabled.appliedSsid) ssid = enabled.appliedSsid;
            if (enabled.appliedPassword) password = enabled.appliedPassword;
            if (enabled.ip) urls.push(`http://${enabled.ip}:${serverPort}`);
          } else {
            autoError = `Automatic hotspot failed: ${enabled.error ?? "unknown error"} — turn it on manually.`;
          }
        }
      }
    } else if (platform === "win32") {
      // 1 — Windows Mobile Hotspot (the Settings switch, no admin needed).
      const mobile = await enableWindowsMobileHotspot({ ssid, password });
      if (mobile.ok) {
        mode = "auto";
        autoMethod = mobile.method;
        autoIp = mobile.ip;
        if (mobile.appliedSsid) ssid = mobile.appliedSsid;
        if (mobile.appliedPassword) password = mobile.appliedPassword;
        if (mobile.ip) urls.push(`http://${mobile.ip}:${serverPort}`);
      } else {
        // 2 — legacy Hosted Network (offline-capable, one UAC approval).
        const hosted = await enableWindowsHostedNetwork({ ssid, password, port: serverPort });
        if (hosted.ok) {
          mode = "auto";
          autoMethod = hosted.method;
          autoIp = hosted.ip;
          if (hosted.ip) urls.push(`http://${hosted.ip}:${serverPort}`);
        } else {
          const reason = mobile.error && hosted.error
            ? `${mobile.error}; also tried the Hosted Network: ${hosted.error}`
            : (hosted.error ?? mobile.error ?? "Windows could not start a hotspot");
          autoError = `${reason}. Use the manual steps below — or connect this PC to any network (Wi-Fi/Ethernet) and press Open Hotspot again, so Windows can share it.`;
        }
      }

      // Phones must be able to REACH the server: Windows Firewall blocks
      // inbound by default. Best effort — a declined UAC only downgrades
      // to a hint, never to manual mode.
      const fw = await ensureWindowsFirewallRule(serverPort);
      if (fw === null) firewallHint = true;
    } else {
      autoError = `Automatic hotspot setup isn't supported on ${platform} — use the manual steps below.`;
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
      autoMethod,
      firewallHint,
      serverPort,
      urls,
      platform,
      instructions: manualInstructions(platform),
    });

    return corsJson(statusResponse());
  } catch (err) {
    return errorResponse(err, "POST /api/hotspot/open");
  }
}

export async function OPTIONS() {
  return corsOptions();
}
