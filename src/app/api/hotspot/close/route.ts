// POST /api/hotspot/close — "Close Hotspot" button.
//
// Tears the bridge down: brings the auto-created NetworkManager hotspot
// profile down (and deletes it) when the session was auto-configured, then
// clears the in-memory session, phone heartbeats and scan feed. Closing is
// always safe — the laptop camera scanner never depended on it.
import { requireRole } from "@/lib/auth";
import { errorResponse, unauthorized } from "@/app/api/_lib/http";
import { corsJson, corsOptions, hotspotStore } from "@/app/api/_lib/hotspot-store";
import { disableLinuxHotspot } from "@/app/api/_lib/hotspot-os";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const wasAuto = hotspotStore.session?.mode === "auto";
    hotspotStore.closeSession();

    // Best-effort OS teardown (manual-mode hotspots are the operator's own).
    let networkDisabled = false;
    if (wasAuto) {
      networkDisabled = await disableLinuxHotspot();
    }

    return corsJson({ ok: true, closed: true, networkDisabled });
  } catch (err) {
    return errorResponse(err, "POST /api/hotspot/close");
  }
}

export async function OPTIONS() {
  return corsOptions();
}
