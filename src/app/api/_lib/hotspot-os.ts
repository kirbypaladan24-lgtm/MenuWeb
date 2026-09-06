// Coffee++ hotspot bridge — OS integration.
//
// Bringing the laptop's Wi-Fi hotspot up is an OS job, so "Open Hotspot"
// tries to do it FOR the operator when it can, and otherwise shows short
// per-platform manual steps (the local server + scan feed work either way):
//
//   Linux + NetworkManager (nmcli)  → fully automatic:
//     - find the Wi-Fi interface
//     - create/reuse a shared AP connection profile (WPA2, ipv4.method shared)
//     - bring it up and read the hotspot IP (typically 10.42.0.1)
//   Windows / macOS / Linux w/o nmcli → manual mode:
//     - numbered steps (Mobile hotspot / Internet Sharing)
//     - the panel lists every local IPv4 so the phone app's server address
//       is still one tap away.
//
// Everything here runs offline — 127.0.0.1 and the hotspot subnet only.

import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";

/** Fixed NetworkManager connection profile name for the booth hotspot. */
export const HOTSPOT_PROFILE = "CoffeePP-Booth";

/* ------------------------------------------------------------------ */
/* Process helpers                                                     */
/* ------------------------------------------------------------------ */

interface RunResult {
  ok: boolean;
  out: string;
  err: string;
}

function run(cmd: string, args: string[], timeoutMs = 10_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 512 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          out: String(stdout ?? "").trim(),
          err: String(stderr ?? "").trim(),
        });
      }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Linux + NetworkManager (nmcli)                                      */
/* ------------------------------------------------------------------ */

/** Is NetworkManager's CLI available at all? */
export async function nmcliAvailable(): Promise<boolean> {
  const res = await run("nmcli", ["--version"], 6_000);
  return res.ok;
}

/** First Wi-Fi device name (wlan0 …), or null when there is none. */
export async function findWifiIface(): Promise<string | null> {
  const res = await run("nmcli", ["-t", "-f", "DEVICE,TYPE", "device", "status"], 6_000);
  if (!res.ok) return null;
  for (const line of res.out.split("\n")) {
    const [device, type] = line.split(":");
    if (device && type === "wifi") return device;
  }
  return null;
}

export interface NmcliEnableResult {
  ok: boolean;
  ip: string | null;
  error: string | null;
}

/**
 * Create/reuse the shared AP profile and bring it up.
 * The WPA2 password travels as an nmcli argument — it is visible in the
 * process list for a moment, which is fine on the single-user booth laptop.
 */
export async function enableLinuxHotspot(opts: {
  ssid: string;
  password: string;
  iface: string;
}): Promise<NmcliEnableResult> {
  const { ssid, password, iface } = opts;

  // 1. Profile (reuse when it already exists, e.g. a previous session).
  let add = await run("nmcli", [
    "con",
    "add",
    "type",
    "wifi",
    "ifname",
    iface,
    "con-name",
    HOTSPOT_PROFILE,
    "ssid",
    ssid,
    "autoconnect",
    "no",
  ]);
  if (!add.ok && !/already exists/i.test(add.err)) {
    return { ok: false, ip: null, error: add.err || "nmcli could not create the hotspot profile" };
  }

  // 2. Access-point + shared IPv4 + WPA2 PSK.
  const modify = await run("nmcli", [
    "con",
    "modify",
    HOTSPOT_PROFILE,
    "802-11-wireless.mode",
    "ap",
    "802-11-wireless.band",
    "bg",
    "802-11-wireless.ssid",
    ssid,
    "ipv4.method",
    "shared",
    "wifi-sec.key-mgmt",
    "wpa-psk",
    "wifi-sec.psk",
    password,
  ]);
  if (!modify.ok) {
    return { ok: false, ip: null, error: modify.err || "nmcli could not configure the hotspot profile" };
  }

  // 3. Bring it up (allow time for the shared subnet to settle).
  const up = await run("nmcli", ["con", "up", HOTSPOT_PROFILE], 30_000);
  if (!up.ok) {
    return { ok: false, ip: null, error: up.err || "nmcli could not start the hotspot" };
  }

  // 4. Read the hotspot IP (retry — the address can take a moment).
  let ip: string | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const show = await run("nmcli", ["-g", "IP4.ADDRESS", "con", "show", HOTSPOT_PROFILE], 6_000);
    if (show.ok) {
      const first = show.out.split("\n")[0]?.trim() ?? "";
      const match = /^(\d{1,3}(?:\.\d{1,3}){3})\//.exec(first);
      if (match) {
        ip = match[1];
        break;
      }
    }
    await sleep(400);
  }

  return { ok: true, ip, error: null };
}

/** Tear the auto-created profile down (best effort). */
export async function disableLinuxHotspot(): Promise<boolean> {
  await run("nmcli", ["con", "down", HOTSPOT_PROFILE], 15_000); // ignore errors
  const del = await run("nmcli", ["con", "delete", HOTSPOT_PROFILE], 10_000);
  return del.ok || /not found/i.test(del.err);
}

/* ------------------------------------------------------------------ */
/* Local server addresses                                              */
/* ------------------------------------------------------------------ */

export interface LocalUrl {
  url: string;
  ip: string;
  /** Lower = more likely to be the hotspot subnet. */
  rank: number;
}

/**
 * Every private IPv4 this laptop answers on, ranked so hotspot-typical
 * subnets float to the top:
 *   10.42.x.x      NetworkManager "shared" AP (auto mode)
 *   192.168.137.x  Windows Mobile hotspot default
 *   192.168.x.x    ordinary LAN / phone-hotspot client subnet
 *   10.x.x.x / 172.16–31.x.x other private ranges
 */
export function localCandidateUrls(port: number): LocalUrl[] {
  const seen = new Set<string>();
  const urls: LocalUrl[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const ip = net.address;
      if (seen.has(ip)) continue;
      seen.add(ip);
      let rank = 5;
      if (ip.startsWith("10.42.")) rank = 0;
      else if (ip.startsWith("192.168.137.")) rank = 1;
      else if (ip.startsWith("192.168.")) rank = 2;
      else if (ip.startsWith("10.")) rank = 3;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) rank = 4;
      urls.push({ url: `http://${ip}:${port}`, ip, rank });
    }
  }
  urls.sort((a, b) => a.rank - b.rank || a.ip.localeCompare(b.ip));
  return urls.slice(0, 5);
}

/* ------------------------------------------------------------------ */
/* Manual setup instructions (Windows / macOS / Linux fallback)         */
/* ------------------------------------------------------------------ */

export interface ManualInstructions {
  title: string;
  steps: string[];
  note: string;
}

export function manualInstructions(platform: NodeJS.Platform): ManualInstructions {
  if (platform === "win32") {
    return {
      title: "Turn on Windows Mobile Hotspot",
      steps: [
        "Open Settings → Network & internet → Mobile hotspot and switch it On.",
        "Tap Edit and set the Network name / Password to the values shown here (or keep your own).",
        "On the scanner phone, join that Wi-Fi network, then open the scanner app and point it at the server address below.",
      ],
      note: "No internet needed — the hotspot builds its own local network.",
    };
  }
  if (platform === "darwin") {
    return {
      title: "Turn on macOS Internet Sharing",
      steps: [
        "Open System Settings → General → Sharing → Internet Sharing.",
        "Set Wi-Fi Options (network name + password — use the values shown here), share from Wi-Fi (or Ethernet) to computers using Wi-Fi, then switch it On.",
        "On the scanner phone, join that Wi-Fi network, then open the scanner app and point it at the server address below.",
      ],
      note: "No internet needed — sharing still creates the local network.",
    };
  }
  return {
    title: "Turn on a Linux Wi-Fi hotspot",
    steps: [
      "Open Wi-Fi settings and switch on Hotspot / Access Point mode (GNOME: Wi-Fi → ⋮ → Turn On Hotspot · KDE: Wi-Fi → Use as Hotspot).",
      "Use the network name / password shown here (or your own — then update the phone).",
      "On the scanner phone, join that Wi-Fi network, then open the scanner app and point it at the server address below.",
    ],
    note: "CLI alternative: nmcli device wifi hotspot ifname <wifi-iface> ssid <name> password <pass>",
  };
}
