// Coffee++ client API wrapper (browser-side) — no auth: the console runs
// only on the booth laptop, so requests carry no credentials.
"use client";

import type { ApiErrorBody, Order } from "./types";

export class ApiError extends Error {
  status: number;
  code?: string;
  order?: Order;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error || "Something went wrong");
    this.status = status;
    this.code = body.code;
    this.order = body.order;
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!res.ok) {
      throw new ApiError(res.status, { error: `Request failed (${res.status})` });
    }
    // Binary response (xlsx / json backup downloads)
    return res as unknown as T;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, data as ApiErrorBody);
  }
  return data as T;
}
