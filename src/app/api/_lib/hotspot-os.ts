// Coffee++ hotspot bridge — OS integration.
//
// "Open Hotspot" must turn on a REAL hotspot on the booth laptop — one other
// devices can see in their Wi-Fi list and join. This module drives the OS:
//
//   Linux + NetworkManager (nmcli) → fully automatic, no prompts:
//     - find the Wi-Fi interface
//     - create/reuse a shared AP connection profile (WPA2, ipv4.method shared)
//     - bring it up and read the hotspot IP (typically 10.42.0.1)
//
//   Windows → two automatic attempts, then manual steps:
//     1. Windows "Mobile Hotspot" (WinRT tethering API, PowerShell) — the
//        same switch as Settings → Network & internet → Mobile hotspot.
//        Needs a connection Windows can share (any internet profile).
//     2. Legacy "Hosted Network" (netsh wlan …) — works fully OFFLINE when
//        the Wi-Fi driver supports it; needs ONE UAC approval because it
//        also opens the server port in Windows Firewall.
//     Both paths get a firewall rule so phones can actually reach the
//     local server (Windows blocks inbound by default).
//
//   macOS / anything else → manual mode with numbered steps.
//
// Everything here runs offline — loopback and the hotspot subnet only.
import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Fixed NetworkManager connection profile name for the booth hotspot. */
export const HOTSPOT_PROFILE = "CoffeePP-Booth";
/** Fixed Windows firewall rule name (so re-adding replaces, not duplicates). */
export const FIREWALL_RULE_NAME = "CoffeePP Booth Server";

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
/* Shared enable/disable result                                        */
/* ------------------------------------------------------------------ */

export interface HotspotEnableResult {
  ok: boolean;
  /** Hotspot host IP when known (10.42.0.1 / 192.168.137.1 …). */
  ip: string | null;
  error: string | null;
  /** Human label of what actually hosts the AP (shown in the panel). */
  method: string | null;
  /** Credentials the OS actually applied (Windows may keep its own). */
  appliedSsid: string | null;
  appliedPassword: string | null;
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

/**
 * Create/reuse the shared AP profile and bring it up.
 * The WPA2 password travels as an nmcli argument — it is visible in the
 * process list for a moment, which is fine on the single-user booth laptop.
 */
export async function enableLinuxHotspot(opts: {
  ssid: string;
  password: string;
  iface: string;
}): Promise<HotspotEnableResult> {
  const { ssid, password, iface } = opts;

  // 1. Profile (reuse when it already exists, e.g. a previous session).
  const add = await run("nmcli", [
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
    return {
      ok: false, ip: null,
      error: add.err || "nmcli could not create the hotspot profile",
      method: null, appliedSsid: null, appliedPassword: null,
    };
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
    return {
      ok: false, ip: null,
      error: modify.err || "nmcli could not configure the hotspot profile",
      method: null, appliedSsid: null, appliedPassword: null,
    };
  }

  // 3. Bring it up (allow time for the shared subnet to settle).
  const up = await run("nmcli", ["con", "up", HOTSPOT_PROFILE], 30_000);
  if (!up.ok) {
    return {
      ok: false, ip: null,
      error: up.err || "nmcli could not start the hotspot",
      method: null, appliedSsid: null, appliedPassword: null,
    };
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

  return {
    ok: true, ip, error: null,
    method: "NetworkManager Wi-Fi hotspot",
    appliedSsid: ssid, appliedPassword: password,
  };
}

/** Tear the auto-created profile down (best effort). */
export async function disableLinuxHotspot(): Promise<boolean> {
  await run("nmcli", ["con", "down", HOTSPOT_PROFILE], 15_000); // ignore errors
  const del = await run("nmcli", ["con", "delete", HOTSPOT_PROFILE], 10_000);
  return del.ok || /not found/i.test(del.err);
}

/* ------------------------------------------------------------------ */
/* Windows — PowerShell plumbing                                       */
/* ------------------------------------------------------------------ */

/** Escape a value for single-quoted PowerShell string literals. */
function psQuote(value: string): string {
  return value.replace(/'/g, "''");
}

/** PowerShell -EncodedCommand needs base64 of the UTF-16LE bytes. */
function encodedCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** Run a PowerShell script (Windows PowerShell 5.1 — WinRT-capable). */
function runPowerShell(script: string, timeoutMs = 45_000): Promise<RunResult> {
  return run(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand(script)],
    timeoutMs
  );
}

/** Parse the `CPP:<KEY>:<value>` marker lines our scripts emit. */
function parseMarkers(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^CPP:([A-Z]+):(.*)$/.exec(line.trim());
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** Friendly text for the marker error codes the scripts report. */
function winrtErrorText(code: string): string {
  if (code === "NO_INTERNET_PROFILE") {
    return "Windows Mobile Hotspot needs a connection to share, and this PC has no internet right now";
  }
  if (code.startsWith("CONFIG_REJECTED:")) {
    return `Windows rejected the Wi-Fi name/password (${code.slice("CONFIG_REJECTED:".length)})`;
  }
  if (code.startsWith("START_FAILED:")) {
    return `Windows could not switch the Mobile Hotspot on (${code.slice("START_FAILED:".length).trim() || "unknown error"})`;
  }
  if (code.startsWith("EXCEPTION:")) {
    const detail = code.slice("EXCEPTION:".length).trim();
    return detail !== "" ? `Windows error: ${detail}` : "Windows could not configure the Mobile Hotspot";
  }
  return "Windows could not configure the Mobile Hotspot";
}

/**
 * WinRT tethering scaffold shared by start/stop. Returns the tethering
 * manager pre-bound to the current internet profile, or an error marker.
 */
const WINRT_SETUP = `
$ErrorActionPreference='Stop'
function Emit([string]$k,[string]$v){ Write-Output ('CPP:'+$k+':'+$v) }
`;

/**
 * Windows Mobile Hotspot via the WinRT tethering API — the exact switch
 * from Settings → Network & internet → Mobile hotspot, flipped
 * programmatically (no admin rights needed). Reconfigures the SSID /
 * passphrase to the booth's values, so the network the panel advertises
 * is the one actually broadcasting.
 */
export async function enableWindowsMobileHotspot(opts: {
  ssid: string;
  password: string;
}): Promise<HotspotEnableResult> {
  const ssid = psQuote(opts.ssid);
  const password = psQuote(opts.password);

  const script = `${WINRT_SETUP}
try{
  [void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]
  $profile=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if($null -eq $profile){ Emit 'ERR' 'NO_INTERNET_PROFILE'; return }
  $tm=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($profile)
  $asTaskGeneric=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]
  function Await($op,[Type]$t){ $task=$asTaskGeneric.MakeGenericMethod($t).Invoke($null,@($op)); $task.Wait(-1)|Out-Null; $task.Result }
  # Restart-if-running so a previous session with different credentials
  # ends up broadcasting OUR network name + password.
  if([string]$tm.TetheringOperationalState -eq 'On'){
    $null=Await ($tm.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  }
  $tm.AccessPointConfiguration.Ssid='${ssid}'
  $tm.AccessPointConfiguration.Passphrase='${password}'
  $res=Await ($tm.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  if([string]$res.Status -ne 'Success'){ Emit 'ERR' ('START_FAILED:'+[string]$res.Status+' '+[string]$res.AdditionalErrorMessage); return }
  Emit 'STATE' ([string]$tm.TetheringOperationalState)
  Emit 'SSID' ([string]$tm.AccessPointConfiguration.Ssid)
  Emit 'PASS' ([string]$tm.AccessPointConfiguration.Passphrase)
  Emit 'CLIENTS' ([string]$tm.ClientCount)
  Emit 'OK' 'WINRT'
}catch{ Emit 'ERR' ('EXCEPTION:'+($_.Exception.Message)) }
`;

  const res = await runPowerShell(script, 60_000);
  if (!res.ok) {
    return {
      ok: false, ip: null,
      error: res.err || "PowerShell could not be started to configure the Mobile Hotspot",
      method: null, appliedSsid: null, appliedPassword: null,
    };
  }

  const markers = parseMarkers(res.out);
  const err = markers.get("ERR");
  if (err) {
    return {
      ok: false, ip: null,
      error: winrtErrorText(err),
      method: null, appliedSsid: null, appliedPassword: null,
    };
  }
  if (!markers.has("OK")) {
    return {
      ok: false, ip: null,
      error: "Windows did not confirm the Mobile Hotspot started",
      method: null, appliedSsid: null, appliedPassword: null,
    };
  }

  // The ICS hotspot host address — almost always 192.168.137.1; confirm
  // it actually exists on an interface (give Windows a moment).
  const ip = await waitForHotspotIp();
  return {
    ok: true, ip, error: null,
    method: "Windows Mobile Hotspot",
    appliedSsid: markers.get("SSID") ?? opts.ssid,
    appliedPassword: markers.get("PASS") ?? opts.password,
  };
}

/** Switch the Windows Mobile Hotspot off (best effort, no elevation). */
export async function disableWindowsMobileHotspot(): Promise<boolean> {
  const script = `${WINRT_SETUP}
try{
  [void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]
  $profile=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if($null -eq $profile){ Emit 'STATE' 'NoProfile'; return }
  $tm=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($profile)
  $asTaskGeneric=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]
  function Await($op,[Type]$t){ $task=$asTaskGeneric.MakeGenericMethod($t).Invoke($null,@($op)); $task.Wait(-1)|Out-Null; $task.Result }
  if([string]$tm.TetheringOperationalState -eq 'On'){
    $res=Await ($tm.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    Emit 'STATE' ([string]$tm.TetheringOperationalState)
  } else { Emit 'STATE' ([string]$tm.TetheringOperationalState) }
  Emit 'OK' 'WINRT'
}catch{ Emit 'ERR' ('EXCEPTION:'+($_.Exception.Message)) }
`;
  const res = await runPowerShell(script, 45_000);
  if (!res.ok) return false;
  return parseMarkers(res.out).has("OK");
}

/* ------------------------------------------------------------------ */
/* Windows — legacy Hosted Network (netsh, offline-capable)            */
/* ------------------------------------------------------------------ */

/**
 * Does this machine's Wi-Fi driver still support the legacy hosted
 * network? null = could not be determined (netsh missing/error).
 */
export async function hostedNetworkSupported(): Promise<boolean | null> {
  const res = await run("netsh", ["wlan", "show", "drivers"], 15_000);
  if (!res.ok && res.out === "") return null;
  const text = `${res.out}\n${res.err}`;
  const m = /Hosted network supported\s*:\s*(Yes|No)/i.exec(text);
  if (!m) return null;
  return m[1].toLowerCase() === "yes";
}

/** Is the hosted network currently broadcasting? */
async function hostedNetworkRunning(): Promise<boolean> {
  const res = await run("netsh", ["wlan", "show", "hostednetwork"], 15_000);
  return /Status\s*:\s*Started/i.test(`${res.out}\n${res.err}`);
}

/**
 * Run an elevated PowerShell script (ONE UAC consent) and wait for it.
 * The elevated process runs in its own hidden window, so its stdout can't
 * be captured — scripts write their results to a log file instead. Put the
 * literal placeholder %LOG% in the script body where the log path belongs
 * (typically `$log='%LOG%'`); it is replaced with the real temp path.
 *
 * Returns:
 *   declined : true  → the UAC prompt was declined (nothing ran)
 *   log      : the log file contents (null when it couldn't be read)
 *   exitCode : the elevated process's exit code (null when unknown)
 */
async function runElevatedScript(scriptBody: string): Promise<{
  declined: boolean;
  log: string | null;
  exitCode: number | null;
}> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "coffeepp-"));
    const scriptPath = join(dir, "run.ps1");
    const logPath = join(dir, "log.txt");
    const body = scriptBody.split("%LOG%").join(logPath);
    await writeFile(scriptPath, body, "utf8");

    // Launcher: unelevated PowerShell → Start-Process -Verb RunAs -Wait.
    // (Backslashes are literal inside single-quoted PS strings — safe.)
    const launcher = `
$ErrorActionPreference='Stop'
try{
  $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${psQuote(scriptPath)}')
  Write-Output ('CPP:EXIT:'+$p.ExitCode)
}catch{
  Write-Output ('CPP:ERR:'+$_.Exception.Message)
}
`;
    const res = await runPowerShell(launcher, 90_000);
    if (/The operation was canceled by the user/i.test(res.out + res.err)) {
      return { declined: true, log: null, exitCode: null };
    }
    const markers = parseMarkers(res.out);
    const exitCode = markers.get("EXIT");
    const code = exitCode !== undefined ? Number(exitCode) : null;
    let log: string | null = null;
    try {
      log = await readFile(logPath, "utf8");
    } catch {
      log = null; // script ran but wrote nothing (e.g. crashed early)
    }
    return { declined: false, log, exitCode: Number.isFinite(code) ? code : null };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Legacy Hosted Network path — a REAL Wi-Fi access point that works with
 * no internet at all (pure offline LAN). Needs one UAC approval because
 * netsh + the firewall rule require administrator. The script:
 *   - configures + starts the hosted network with our SSID/WPA2 key
 *   - opens the server port in Windows Firewall (inbound allow)
 * Then we confirm it is actually broadcasting.
 */
export async function enableWindowsHostedNetwork(opts: {
  ssid: string;
  password: string;
  port: number;
}): Promise<HotspotEnableResult> {
  const { port } = opts;
  const ssid = psQuote(opts.ssid);
  const password = psQuote(opts.password);

  const supported = await hostedNetworkSupported();
  if (supported === false) {
    return {
      ok: false, ip: null,
      error: "This PC's Wi-Fi driver can't host a network (Hosted Network unsupported)",
      method: null, appliedSsid: null, appliedPassword: null,
    };
  }

  const scriptBody = `
$ErrorActionPreference='Continue'
$log='%LOG%'
function L([string]$s){ Add-Content -Path $log -Value $s -Encoding UTF8 }
try{
  $out = (netsh wlan set hostednetwork mode=allow ssid='${ssid}' key='${password}' 2>&1 | Out-String).Trim()
  L ('SET:'+$out)
  $out = (netsh wlan start hostednetwork 2>&1 | Out-String).Trim()
  L ('START:'+$out)
  $out = (netsh advfirewall firewall delete rule name="${FIREWALL_RULE_NAME}" 2>&1 | Out-String).Trim()
  L ('FWDEL:'+$out)
  $out = (netsh advfirewall firewall add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow protocol=TCP localport=${port} profile=any 2>&1 | Out-String).Trim()
  L ('FWADD:'+$out)
  if($LASTEXITCODE -eq 0){ L 'CPP:OK:NETSH' } else { L 'CPP:ERR:FWFAIL' }
}catch{ L ('CPP:ERR:EXCEPTION:'+($_.Exception.Message)) }
`;

  const elevated = await runElevatedScript(scriptBody);
  if (elevated.declined) {
    return {
      ok: false, ip: null,
      error: "Administrator approval was declined — the hotspot needs one Yes on the Windows prompt",
      method: null, appliedSsid: null, appliedPassword: null,
    };
  }
  if (!elevated.log || !elevated.log.includes("CPP:OK:NETSH")) {
    return {
      ok: false, ip: null,
      error: "The hosted network could not be started (see Windows Wi-Fi settings — then use the manual steps)",
      method: null, appliedSsid: null, appliedPassword: null,
    };
  }
  if (!(await hostedNetworkRunning())) {
    return {
      ok: false, ip: null,
      error: "Windows accepted the command but the hotspot is not broadcasting",
      method: null, appliedSsid: null, appliedPassword: null,
    };
  }
  const ip = await waitForHotspotIp();
  return {
    ok: true, ip, error: null,
    method: "Windows Hosted Network",
    appliedSsid: opts.ssid, appliedPassword: opts.password,
  };
}

/** Stop the hosted network (best effort; needs elevation — may silently fail). */
export async function disableWindowsHostedNetwork(): Promise<boolean> {
  // netsh stop needs admin — try unelevated first (works when the console
  // itself runs elevated), then a UAC round-trip.
  const direct = await run("netsh", ["wlan", "stop", "hostednetwork"], 15_000);
  if (direct.ok) return true;
  const scriptBody = `
$ErrorActionPreference='Continue'
$log='%LOG%'
function L([string]$s){ Add-Content -Path $log -Value $s -Encoding UTF8 }
try{
  netsh wlan stop hostednetwork | Out-Null
  if($LASTEXITCODE -eq 0){ L 'CPP:OK:NETSH' } else { L 'CPP:ERR:STOPFAIL' }
}catch{ L ('CPP:ERR:EXCEPTION:'+($_.Exception.Message)) }
`;
  const elevated = await runElevatedScript(scriptBody);
  if (elevated.declined) return false;
  return elevated.log !== null && elevated.log.includes("CPP:OK:NETSH");
}

/* ------------------------------------------------------------------ */
/* Windows — firewall rule (so phones can reach the local server)      */
/* ------------------------------------------------------------------ */

/**
 * Allow inbound TCP on the server port. Windows Firewall blocks inbound
 * connections by default, so without this the phone would join the
 * hotspot but never reach the app. Tries without elevation first (works
 * when the console is already elevated), then one UAC round-trip.
 * Returns null when the UAC prompt was declined.
 */
export async function ensureWindowsFirewallRule(port: number): Promise<boolean | null> {
  // Unelevated attempt — silently fails without admin rights.
  const add = await run("netsh", [
    "advfirewall",
    "firewall",
    "add",
    "rule",
    `name=${FIREWALL_RULE_NAME}`,
    "dir=in",
    "action=allow",
    "protocol=TCP",
    `localport=${port}`,
    "profile=any",
  ], 15_000);
  if (add.ok) return true;

  const scriptBody = `
$ErrorActionPreference='Continue'
$log='%LOG%'
function L([string]$s){ Add-Content -Path $log -Value $s -Encoding UTF8 }
try{
  netsh advfirewall firewall delete rule name="${FIREWALL_RULE_NAME}" | Out-Null
  netsh advfirewall firewall add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow protocol=TCP localport=${port} profile=any | Out-Null
  if($LASTEXITCODE -eq 0){ L 'CPP:OK:FW' } else { L 'CPP:ERR:FWFAIL' }
}catch{ L ('CPP:ERR:EXCEPTION:'+($_.Exception.Message)) }
`;
  const elevated = await runElevatedScript(scriptBody);
  if (elevated.declined) return null; // UAC declined
  return elevated.log !== null && elevated.log.includes("CPP:OK:FW");
}

/* ------------------------------------------------------------------ */
/* Hotspot IP polling (shared by the Windows paths)                    */
/* ------------------------------------------------------------------ */

/**
 * Wait briefly for a hotspot-typical host IPv4 to appear (ICS hands the
 * laptop 192.168.137.1; hosted networks may fall back to 169.254.x.x).
 * Returns null when nothing obvious showed up — the caller then relies
 * on the generic candidate list.
 */
async function waitForHotspotIp(): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family !== "IPv4" || net.internal) continue;
        if (net.address.startsWith("192.168.137.")) return net.address;
      }
    }
    if (attempt < 9) await sleep(600);
  }
  return null;
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
 *   192.168.137.x  Windows Mobile hotspot / hosted network (auto mode)
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
/* Manual setup instructions (final fallback for every platform)       */
/* ------------------------------------------------------------------ */

export interface ManualInstructions {
  title: string;
  steps: string[];
  note: string;
}

export function manualInstructions(platform: NodeJS.Platform): ManualInstructions {
  if (platform === "win32") {
    return {
      title: "Turn on the Windows hotspot yourself",
      steps: [
        "Open Settings → Network & internet → Mobile hotspot and switch it On (Windows needs some connection to share — connect to Wi-Fi or plug in Ethernet first).",
        "Tap Edit and set the Network name / Network password to the values shown here (or keep your own — then update them on the phone).",
        "Open Windows Security → Firewall & network protection → Allow an app through firewall → tick Node.js for Private AND Public, so the phone can reach this server.",
        "On the scanner phone, join that Wi-Fi network, then open the scanner app and point it at the server address below.",
      ],
      note: "No internet is needed afterwards — the hotspot is its own local network.",
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
