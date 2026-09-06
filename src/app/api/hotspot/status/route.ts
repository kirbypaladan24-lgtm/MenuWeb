// GET /api/hotspot/status — shared by the admin Scanner panel AND the phone
// scanner app:
//
//   phone   : GET /api/hotspot/status?deviceId=abc123&deviceName=Pixel
//             → heartbeat ("am I still talking to the booth?") + session info
//             (ssid, whether the bridge is open). The server remembers the
//             phone and shows it live on the Scanner panel.
//   console : GET /api/hotspot/status?withEvents=1&since=<lastId>&deviceId=__console
//             → same + the scan feed (events after `since`); polled every 2s
//             while the panel is open. "__console" is never tracked as a phone.
//
// CORS-open: the phone app lives on its own origin.
import { requireRole } from "@/lib/auth";
import { errorResponse, unauthorized } from "@/app/api/_lib/http";
import { corsJson, corsOptions, hotspotStore } from "@/app/api/_lib/hotspot-store";
import type { HotspotStatusResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const url = new URL(req.url);
    const deviceId = url.searchParams.get("deviceId");
    const deviceName = url.searchParams.get("deviceName");
    const withEvents = url.searchParams.get("withEvents") === "1";
    const sinceRaw = Number(url.searchParams.get("since") ?? "0");
    const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? Math.floor(sinceRaw) : 0;

    if (deviceId) hotspotStore.touchPhone(deviceId, deviceName);

    const response: HotspotStatusResponse = {
      hotspot: hotspotStore.session,
      phones: hotspotStore.listPhones(),
      lastEventId: hotspotStore.lastEventId,
      totalScans: hotspotStore.scanTotal,
    };
    if (withEvents) {
      response.events = hotspotStore.eventsSince(since);
    }

    return corsJson(response);
  } catch (err) {
    return errorResponse(err, "GET /api/hotspot/status");
  }
}

export async function OPTIONS() {
  return corsOptions();
}
