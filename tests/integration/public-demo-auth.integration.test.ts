import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AuthService } from "../../apps/api/src/modules/auth/auth.service";
import { assertDemoSeedTarget } from "../../database/prisma/seed-safety";
import { assertPublicDemoDatabase } from "../../apps/api/src/common/deployment-safety";

const db = new PrismaClient();
const username = `demo-session-test-${randomBytes(6).toString("hex")}`;
const password = `Synthetic-${randomBytes(16).toString("hex")}!`;
let userId: string;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const auth = (values: Record<string, string> = {}) => {
  const config: Record<string, string> = { PUBLIC_DEMO_READ_ONLY: "true", PUBLIC_DEMO_MAX_SESSIONS: "2", ...values };
  return new AuthService(db as never, { get: (key: string, fallback: unknown) => config[key] ?? fallback } as never);
};

before(async () => {
  assertDemoSeedTarget(process.env.DATABASE_URL, process.env.SEED_DEMO_CONFIRM);
  await assertPublicDemoDatabase(db);
  const salt = randomBytes(16).toString("hex");
  userId = (await db.user.create({ data: { username, passwordHash: `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}` } })).id;
});
after(async () => {
  if (userId) {
    await db.userSession.deleteMany({ where: { userId } });
    await db.loginAttempt.deleteMany({ where: { normalizedUsername: username } });
    await db.user.delete({ where: { id: userId } });
  }
  await db.$disconnect();
});

test("Real SQL: A and B have independent sessions/CSRF; B logout preserves A", async () => {
  const service = auth();
  const a = await service.login(username, password, "192.0.2.10");
  const b = await service.login(username, password, "192.0.2.11");
  assert.notEqual(a.sessionToken, b.sessionToken);
  assert.notEqual(a.csrfToken, b.csrfToken);
  assert.equal((await db.userSession.findUniqueOrThrow({ where: { tokenHash: hash(a.sessionToken) } })).revokedAt, null);
  await service.logout(b.sessionToken);
  assert.ok((await db.userSession.findUniqueOrThrow({ where: { tokenHash: hash(b.sessionToken) } })).revokedAt);
  assert.equal((await db.userSession.findUniqueOrThrow({ where: { tokenHash: hash(a.sessionToken) } })).revokedAt, null);
  assert.ok(a.expiresAt.getTime() <= Date.now() + 3_600_000);
  await service.logout(a.sessionToken);
});
test("Real SQL: full capacity refuses a new login without evicting active visitors", async () => {
  const service = auth();
  const a = await service.login(username, password, "192.0.2.12");
  const b = await service.login(username, password, "192.0.2.13");
  await assert.rejects(service.login(username, password, "192.0.2.14"), { status: 429 });
  assert.equal(await db.userSession.count({ where: { userId, revokedAt: null } }), 2);
  await service.logout(a.sessionToken); await service.logout(b.sessionToken);
});
test("Real SQL: concurrent login transactions cannot exceed the session cap", async () => {
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => auth().login(username, password, `192.0.2.${20 + i}`)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  for (const result of results) if (result.status === "rejected") assert.equal(result.reason.status, 429);
  assert.equal(await db.userSession.count({ where: { userId, revokedAt: null } }), 2);
  for (const result of results) if (result.status === "fulfilled") await auth().logout(result.value.sessionToken);
});
test("Real SQL: expired/revoked sessions and old login attempts are cleaned up", async () => {
  await db.userSession.deleteMany({ where: { userId } });
  const expired = await db.userSession.create({ data: { userId, tokenHash: hash("synthetic-expired-session"), csrfHash: hash("synthetic-expired-csrf"), expiresAt: new Date(Date.now() - 60_000), lastSeenAt: new Date() } });
  const old = await db.loginAttempt.create({ data: { normalizedUsername: username, addressHash: hash("192.0.2.30"), succeeded: false, occurredAt: new Date(Date.now() - 16 * 60_000) } });
  const current = await auth().login(username, password, "192.0.2.30");
  assert.equal(await db.userSession.findUnique({ where: { id: expired.id } }), null);
  assert.equal(await db.loginAttempt.findUnique({ where: { id: old.id } }), null);
  await auth().logout(current.sessionToken);
});
test("Real SQL: ordinary personal deployments still revoke the previous login", async () => {
  const service = auth({ PUBLIC_DEMO_READ_ONLY: "false" });
  const a = await service.login(username, password, "192.0.2.40");
  const b = await service.login(username, password, "192.0.2.40");
  assert.ok((await db.userSession.findUniqueOrThrow({ where: { tokenHash: hash(a.sessionToken) } })).revokedAt);
  assert.equal((await db.userSession.findUniqueOrThrow({ where: { tokenHash: hash(b.sessionToken) } })).revokedAt, null);
  await service.logout(b.sessionToken);
});
test("Real SQL: five bad passwords still lock the visitor/account pair for 15 minutes", async () => {
  for (let i = 0; i < 5; i++) await assert.rejects(auth().login(username, "Synthetic-Wrong-Password!", "192.0.2.50"), { status: 401 });
  await assert.rejects(auth().login(username, password, "192.0.2.50"), { status: 429 });
  const other = await auth().login(username, password, "192.0.2.51");
  await auth().logout(other.sessionToken);
});
