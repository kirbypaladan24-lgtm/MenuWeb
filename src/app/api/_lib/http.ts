// Coffee++ API — shared HTTP helpers (private to src/app/api/**)
import { NextResponse } from "next/server";
import type { ApiErrorBody, Order } from "@/lib/types";

/** Error carrying an HTTP status + JSON body — caught by errorResponse(). */
export class HttpError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, error: string, code?: string, order?: Order) {
    super(error);
    this.name = "HttpError";
    let body: ApiErrorBody = { error };
    if (code !== undefined) body = { ...body, code };
    if (order !== undefined) body = { ...body, order };
    this.status = status;
    this.body = body;
  }
}

/** Throw an HttpError (never returns). */
export function fail(status: number, error: string, code?: string, order?: Order): never {
  throw new HttpError(status, error, code, order);
}

/** Map a thrown error to a JSON response; unknown errors → 500 generic. */
export function errorResponse(err: unknown, label: string): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(err.body, { status: err.status });
  }
  console.error(`[api] ${label}:`, err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Standard 401 body used whenever requireRole() returns null. */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Parse a JSON object body; null when body is missing / not an object. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await req.json();
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Strict-ish integer coercion (accepts 5 or "5", rejects 5.5 / "" / null). */
export function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    if (Number.isInteger(num)) return num;
  }
  return null;
}

export function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Parse an ISO date string → Date, or throw 400. */
export function parseIsoDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || value.trim() === "") {
    fail(400, `${field} must be an ISO date string`);
  }
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    fail(400, `${field} is not a valid date`);
  }
  return date;
}

/** Normalize an order id from a URL param: "ord-0001" → "ORD-0001". */
export function normalizeOrderId(raw: string): string {
  return raw.trim().toUpperCase();
}
