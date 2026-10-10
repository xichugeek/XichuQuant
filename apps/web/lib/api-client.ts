export const API_BASE_URL = typeof window === "undefined"
  ? (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5089")
  : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5089");

export type DataSource = "api" | "mock";

export type ApiData<T> = {
  data: T;
  source: DataSource;
};

export async function fetchWithFallback<T>(path: string, fallback: T): Promise<ApiData<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    return { data: (await response.json()) as T, source: "api" };
  } catch {
    return { data: fallback, source: "mock" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>(path, "POST", body);
}

export async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`API 请求失败 (${response.status})`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function patchJson<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>(path, "PATCH", body);
}

async function requestJson<T>(path: string, method: "PATCH" | "POST", body?: unknown): Promise<T> {
  const csrfToken = readBrowserCookie("xichu_csrf");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(payload?.message) ? payload.message.join("；") : payload?.message;
    throw new Error(message ?? `API 请求失败 (${response.status})`);
  }
  return (await response.json()) as T;
}

function readBrowserCookie(name: string) {
  if (typeof document === "undefined") return "";
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}
