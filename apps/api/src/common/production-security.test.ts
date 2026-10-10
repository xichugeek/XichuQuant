import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { ProductionSecurityMiddleware } from "./production-security.middleware";

function fixture(extra: Record<string, string> = {}) {
  const values = { NODE_ENV: "production", PUBLIC_DEMO_READ_ONLY: "true", WEB_ORIGIN: "https://example.test", ...extra };
  const sessions = new Map<string, { csrfHash: string; expiresAt: Date; lastSeenAt: Date; revokedAt: Date | null }>();
  const middleware = new ProductionSecurityMiddleware({ get: (key: string, fallback: unknown) => values[key as keyof typeof values] ?? fallback } as never,
    { userSession: { findUnique: async ({ where }: { where: { tokenHash: string } }) => sessions.get(where.tokenHash) } } as never);
  return { middleware, sessions };
}
async function request(middleware: ProductionSecurityMiddleware, method = "POST", path = "/auth/login", patch: Record<string, unknown> = {}) {
  let status = 200;
  let reached = false;
  const headers = { origin: "https://example.test", ...((patch.headers ?? {}) as Record<string, string>) };
  await middleware.use({ method, originalUrl: path, path, secure: true, ip: "192.0.2.20", socket: {}, ...patch, headers,
    header: (key: string) => headers[key as keyof typeof headers] } as never,
    { setHeader: () => undefined, status: (value: number) => { status = value; return { json: () => undefined }; } } as never,
    () => { reached = true; });
  return { status, reached };
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("Forged X-Forwarded-Proto does not make an untrusted HTTP request secure", async () => {
  const { middleware } = fixture();
  assert.equal((await request(middleware, "POST", "/auth/login", { secure: false, headers: { "x-forwarded-proto": "https" } })).status, 426);
  assert.equal((await request(middleware)).reached, true);
});
test("Login rate limit counts successful and failed requests per resolved visitor IP", async () => {
  const { middleware } = fixture();
  for (let i = 0; i < 10; i++) assert.equal((await request(middleware)).reached, true);
  assert.equal((await request(middleware)).status, 429);
  assert.equal((await request(middleware, "POST", "/auth/login?attempt=2", { headers: { "x-forwarded-for": "198.51.100.99" } })).status, 429);
  assert.equal((await request(middleware, "POST", "/auth/login", { ip: "192.0.2.21" })).reached, true);
});
test("Public Demo has a global login budget across distinct visitor addresses", async () => {
  const { middleware } = fixture();
  for (let i = 0; i < 60; i++) assert.equal((await request(middleware, "POST", "/auth/login", { ip: `192.0.2.${i + 1}` })).reached, true);
  assert.equal((await request(middleware, "POST", "/auth/login", { ip: "198.51.100.1" })).status, 429);
});
test("Ordinary deployments do not receive the global Demo login budget", async () => {
  const { middleware } = fixture({ PUBLIC_DEMO_READ_ONLY: "false" });
  for (let i = 0; i < 61; i++) assert.equal((await request(middleware, "POST", "/auth/login", { ip: `192.0.2.${i + 1}` })).reached, true);
});
test("Missing, revoked and expired sessions are rejected", async () => {
  const { middleware, sessions } = fixture();
  const headers = { cookie: "xichu_session=synthetic-session" };
  assert.equal((await request(middleware, "GET", "/auth/session", { headers })).status, 401);
  sessions.set(hash("synthetic-session"), { csrfHash: hash("synthetic-csrf"), expiresAt: new Date(Date.now() - 1), lastSeenAt: new Date(), revokedAt: null });
  assert.equal((await request(middleware, "GET", "/auth/session", { headers })).status, 401);
  sessions.get(hash("synthetic-session"))!.expiresAt = new Date(Date.now() + 60_000);
  sessions.get(hash("synthetic-session"))!.revokedAt = new Date();
  assert.equal((await request(middleware, "GET", "/auth/session", { headers })).status, 401);
});
test("Logout requires the current session's own CSRF cookie and token", async () => {
  const { middleware, sessions } = fixture();
  sessions.set(hash("synthetic-session"), { csrfHash: hash("synthetic-csrf-A"), expiresAt: new Date(Date.now() + 60_000), lastSeenAt: new Date(), revokedAt: null });
  const headers = { cookie: "xichu_session=synthetic-session; xichu_csrf=synthetic-csrf-B", "x-csrf-token": "synthetic-csrf-B" };
  assert.equal((await request(middleware, "POST", "/auth/logout", { headers })).status, 403);
  assert.equal((await request(middleware, "POST", "/auth/logout", { headers: { cookie: "xichu_session=synthetic-session; xichu_csrf=synthetic-csrf-A", "x-csrf-token": "synthetic-csrf-A" } })).reached, true);
});
test("Every business mutation verb is rejected in Public Demo before session lookup", async () => {
  const { middleware } = fixture();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const path of ["/imports/preview", "/backtests/run", "/paper-execution/orders", "/broker-sync/run", "/risk-rules/one", "/auth/login/", "/auth/logout/extra"]) {
      assert.equal((await request(middleware, method, path)).status, 403);
    }
  }
});
