// POST /api/hotspot/scan — THE phone-scanner endpoint.
//
// The phone scanner app (a separate application running on a phone joined
// to this laptop's hotspot) decodes a customer's Order QR with the phone
// camera and POSTs the decoded text here. This admin app is the local
// server AND the source of truth: the text goes through the exact same
// pipeline as the laptop's camera scanner —
//
//   full Order-QR JSON  → registerOrderFromPayload() (re-priced, warnings)
//                          (re-scan = another copy, same as the camera)
//   bare "ORD-…" id     → lookup of an already-registered order
//   anything else       → invalid
//
// The phone ALWAYS gets a JSON answer it can render (ok / outcome /
// message / order), and every scan lands in the live feed the Scanner
// panel polls — the operator confirms SERVE/ABORT on the laptop exactly
// like a camera scan. Works fully offline over the local network.
//
// Body: { payload: string | object, deviceId?: string, deviceName?: string }
import { requireRole } from "@/lib/auth";
import { errorResponse, fail, HttpError, readJson, unauthorized } from "@/app/api/_lib/http";
import { registerOrderFromPayload } from "@/app/api/_lib/register-order";
import { findOrderRow, serializeOrder } from "@/app/api/_lib/service";
import { corsJson, corsOptions, hotspotStore } from "@/app/api/_lib/hotspot-store";
import type { HotspotScanOutcome, Order } from "@/lib/types";

export const dynamic = "force-dynamic";

const ORDER_ID_RE = /^ORD-[A-Z0-9]{1,10}(-\d+)?$/i;
const MAX_PAYLOAD_CHARS = 8_000;

/** Server-side twin of the client's parseOrderQr() decision tree. */
type ScanAction =
  | { kind: "register"; body: Record<string, unknown> }
  | { kind: "lookup"; orderId: string }
  | { kind: "invalid"; message: string };

function parseScanPayload(raw: string): ScanAction {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "invalid", message: "The scan was empty." };
  if (trimmed.length > MAX_PAYLOAD_CHARS) {
    return { kind: "invalid", message: "The scanned text is too long to be an Order QR." };
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { kind: "invalid", message: "The QR JSON is not an order." };
      }
      return { kind: "register", body: parsed as Record<string, unknown> };
    } catch {
      return { kind: "invalid", message: "The QR text is not valid JSON — it is not a Coffee++ Order QR." };
    }
  }

  // Bare Order ID (legacy numeric "7"/"ORD-0007" or alphanumeric "ORD-K7F2Q9").
  const upper = trimmed.toUpperCase();
  if (/^\d{1,4}$/.test(upper)) return { kind: "lookup", orderId: `ORD-${upper.padStart(4, "0")}` };
  if (/^ORD-\d{1,4}$/.test(upper)) {
    return { kind: "lookup", orderId: `ORD-${upper.slice(4).padStart(4, "0")}` };
  }
  if (ORDER_ID_RE.test(upper)) return { kind: "lookup", orderId: upper };

  return {
    kind: "invalid",
    message: "This QR code is not a Coffee++ order. Ask the customer for their Order QR.",
  };
}

function preview(raw: unknown): string {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw) ?? "";
  return text.slice(0, 40);
}

export async function POST(req: Request) {
  try {
    const session = requireRole(req, "STAFF");
    if (!session) return unauthorized();

    const body = await readJson(req);
    if (!body) fail(400, "Invalid JSON body");

    // payload: the decoded QR text (string) — or an already-parsed object.
    const rawPayload: unknown = body.payload;
    if (typeof rawPayload !== "string" && (rawPayload === null || typeof rawPayload !== "object")) {
      fail(400, "payload must be the decoded QR text (string) or the parsed order object");
    }
    const deviceId =
      typeof body.deviceId === "string" ? body.deviceId.trim().slice(0, 40) : null;
    const deviceName =
      typeof body.deviceName === "string" ? body.deviceName.trim().slice(0, 60) : null;
    if (deviceId) hotspotStore.touchPhone(deviceId, deviceName);

    const action: ScanAction =
      typeof rawPayload === "string"
        ? parseScanPayload(rawPayload)
        : { kind: "register", body: rawPayload as Record<string, unknown> };

    const log = (
      outcome: HotspotScanOutcome,
      extra: {
        message?: string | null;
        code?: string | null;
        order?: Order | null;
        warnings?: string[];
      }
    ) => {
      hotspotStore.recordEvent({
        deviceId,
        deviceName,
        outcome,
        message: extra.message ?? null,
        code: extra.code ?? null,
        order: extra.order ?? null,
        warnings: extra.warnings ?? [],
        preview: preview(rawPayload),
      });
    };

    // ---- Full Order-QR JSON → register (shared pipeline) --------------
    if (action.kind === "register") {
      try {
        const { order, warnings } = await registerOrderFromPayload(action.body);
        log("registered", { order, warnings });
        return corsJson(
          {
            ok: true,
            outcome: "registered",
            order,
            warnings,
            message: "Order registered — it is in the waiting line.",
          },
          201
        );
      } catch (err) {
        if (err instanceof HttpError) {
          log("error", { message: err.body.error, code: err.body.code ?? null });
          return corsJson(
            {
              ok: false,
              outcome: "error",
              error: err.body.error,
              code: err.body.code ?? null,
              message: err.body.error,
            },
            err.status
          );
        }
        throw err;
      }
    }

    // ---- Bare Order ID → lookup --------------------------------------
    if (action.kind === "lookup") {
      const row = await findOrderRow(action.orderId);
      if (!row) {
        const message = `No registered order matches ${action.orderId}. Scan the customer's full Order QR.`;
        log("not-found", { message });
        return corsJson(
          { ok: false, outcome: "not-found", message },
          404
        );
      }
      const order = serializeOrder(row);
      if (order.orderStatus === "WAITING" || order.orderStatus === "PENDING") {
        const message = "Already in line — this order was registered earlier.";
        log("lookup-waiting", { order, message });
        return corsJson({ ok: true, outcome: "lookup-waiting", order, message });
      }
      const served = order.orderStatus === "SERVED";
      const message = `Order ${order.orderId} was already ${
        served ? "served" : "aborted"
      }${order.completedAt ? " earlier" : ""}.`;
      log(served ? "lookup-served" : "lookup-aborted", { order, message });
      return corsJson(
        { ok: true, outcome: served ? "lookup-served" : "lookup-aborted", order, message }
      );
    }

    // ---- Anything else → invalid -------------------------------------
    log("invalid", { message: action.message });
    return corsJson(
      { ok: false, outcome: "invalid", message: action.message },
      400
    );
  } catch (err) {
    return errorResponse(err, "POST /api/hotspot/scan");
  }
}

export async function OPTIONS() {
  return corsOptions();
}
