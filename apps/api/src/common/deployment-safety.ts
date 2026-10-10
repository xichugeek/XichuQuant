import type { PrismaClient } from "@prisma/client";
import { trustedProxyPolicy } from "./trusted-proxy";

export function publicDemoSessionLimit(value = "100") {
  if (!/^\d+$/.test(value) || Number(value) < 2 || Number(value) > 500) {
    throw new Error("PUBLIC_DEMO_MAX_SESSIONS must be an integer between 2 and 500.");
  }
  return Number(value);
}

export function assertPublicDemoConfiguration(env: NodeJS.ProcessEnv) {
  if (env.PUBLIC_DEMO_READ_ONLY !== "true") return;
  publicDemoSessionLimit(env.PUBLIC_DEMO_MAX_SESSIONS);
  if (!env.TRUSTED_PROXY_IPS || env.REQUIRE_HTTPS !== "true") {
    throw new Error("Public Demo requires HTTPS and explicit TRUSTED_PROXY_IPS.");
  }
  trustedProxyPolicy(env.TRUSTED_PROXY_IPS);
  const databases = [...(env.DATABASE_URL ?? "").matchAll(/(?:^|;)database=([^;]*)/gi)];
  if (env.NODE_ENV !== "production" || env.XICHURISK_DATA_MODE !== "DEMO" ||
    databases.length !== 1 || !/^XichuQuantDemo_[A-Za-z0-9_]+$/.test(databases[0]?.[1] ?? "") ||
    env.BROKER_CONNECTOR_MODE !== "OFFLINE" || env.BROKER_CONNECTOR_ENVIRONMENT !== "DISABLED" ||
    env.IBKR_TWS_API_READ_ONLY !== "true" ||
    [env.IBKR_PAPER_ACCOUNT_ID, env.BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST, env.IBKR_PAPER_BASE_URL,
      env.IBKR_READONLY_BASE_URL, env.MARKET_DATA_HTTP_BASE_URL, env.MARKET_DATA_HTTP_API_KEY, env.FRED_API_KEY].some(Boolean)) {
    throw new Error("Public Demo requires production, a dedicated DEMO database, Broker OFFLINE/DISABLED, no external credentials and TWS read-only.");
  }
}

export function publicDemoMethodAllowed(method: string, path: string) {
  return ["GET", "HEAD", "OPTIONS"].includes(method) ||
    (method === "POST" && ["/auth/login", "/auth/logout"].includes(path));
}

export async function assertPublicDemoDatabase(prisma: Pick<PrismaClient, "account" | "brokerAccount" | "marketDataDaily" | "brokerConnection">) {
  const [accounts, unsafeAccounts, unsafeBrokerAccounts, unsafeBars, enabledConnections] = await Promise.all([
    prisma.account.count(), prisma.account.count({ where: { OR: [{ dataOrigin: { not: "DEMO" } }, { note: { not: "DEMO_SEED_COMPLETE_V1_11" } }, { note: null }] } }),
    prisma.brokerAccount.count({ where: { dataOrigin: { not: "DEMO" } } }),
    prisma.marketDataDaily.count({ where: { dataOrigin: { not: "SYNTHETIC" } } }),
    prisma.brokerConnection.count({ where: { OR: [{ enabled: true }, { runMode: { not: "OFFLINE" } }] } }),
  ]);
  if (accounts !== 1 || unsafeAccounts || unsafeBrokerAccounts || unsafeBars || enabledConnections) {
    throw new Error("Public Demo refuses uninitialized, non-DEMO or broker-enabled database contents.");
  }
}
