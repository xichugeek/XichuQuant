import { headers } from "next/headers";
import type { ApiData } from "./api-client";

// Only server pages import this module; cookies are forwarded to the configured API,
// never to an address supplied by an HTTP request or an imported document.
export async function fetchWithFallback<T>(path: string, fallback: T): Promise<ApiData<T>> {
  try {
    const incoming = await headers();
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5089"}${path}`, {
      cache: "no-store", signal: AbortSignal.timeout(1800),
      headers: { Accept: "application/json", Cookie: incoming.get("cookie") ?? "",
        ...(incoming.get("x-forwarded-for") ? { "X-Forwarded-For": incoming.get("x-forwarded-for")! } : {}),
        ...(incoming.get("x-forwarded-proto") ? { "X-Forwarded-Proto": incoming.get("x-forwarded-proto")! } : {}) },
    });
    if (!response.ok) throw new Error("API data unavailable");
    return { data: await response.json() as T, source: "api" };
  } catch {
    // Lists of fictional examples are permitted only in an explicitly configured demo.
    return { data: process.env.XICHURISK_DATA_MODE !== "DEMO" && Array.isArray(fallback) ? [] as T : fallback, source: "mock" };
  }
}
