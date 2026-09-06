// POST /api/hotspot/close — "Close Hotspot" button.
//
// Tears the bridge down: switches the laptop's OS hotspot off again
// (NetworkManager profile on Linux; Mobile Hotspot / Hosted Network on
// Windows), then clears the in-memory session, phone heartbeats and scan
// feed. Closing is always safe — the laptop camera scanner never depended
// on it. Manual-mode hotspots are the operator's own and are left running.
import { requireRole } from "@/lib/auth";
import { errorResponse, unauthorized } from "@/app/api/_lib/http";
import { corsJson, corsOptions, hotspotStore } from "@/app/api/_lib/hotspot-store";
import {
  disableLinuxHotspot,
  disableWindowsHostedNetwork,
  disableWindowsMobileHotspot,
} from "@/app/api/_lib/hotspot-os";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const wasAuto = hotspotStore.session?.mode === "auto";
    const platform = hotspotStore.session?.platform ?? process.platform;
    hotspotStore.closeSession();

    // Best-effort OS teardown (manual-mode hotspots are the operator's own).
    let networkDisabled = false;
    if (wasAuto) {
      if (platform === "win32") {
        networkDisabled = (await disableWindowsMobileHotspot()) || (await disableWindowsHostedNetwork());
      } else {
        networkDisabled = await disableLinuxHotspot();
      }
    }

    return corsJson({ ok: true, closed: true, networkDisabled });
  } catch (err) {
    return errorResponse(err, "POST /api/hotspot/close");
  }
}

export async function OPTIONS() {
  return corsOptions();
}
