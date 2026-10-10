export type JsonRecord = Record<string, unknown>;

const PAPER_PROOF_CACHE_MS = 65_000;
const paperProofCache = new Map<string, { account: JsonRecord; expiresAt: number }>();
const paperProofInFlight = new Map<string, Promise<JsonRecord>>();

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function unwrapped(value: unknown) {
  const root = record(value);
  const success = record(root.success);
  return Object.keys(success).length ? record(success.value) : root;
}

function booleanValue(value: unknown) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

export function assertIbkrPaperSession(input: {
  accounts: unknown;
  authenticationStatus: unknown;
  expectedAccountId: string;
  ssoValidation: unknown;
}) {
  const validation = unwrapped(input.ssoValidation);
  const authentication = unwrapped(input.authenticationStatus);
  const loginType = Number(validation.LOGIN_TYPE ?? validation.loginType);
  const validationPassed = booleanValue(validation.RESULT ?? validation.result);
  if (
    !validationPassed ||
    loginType !== 2 ||
    !booleanValue(authentication.authenticated) ||
    !booleanValue(authentication.connected)
  ) {
    throw new Error("PAPER_ENVIRONMENT_MISMATCH");
  }

  const rows = Array.isArray(input.accounts) ? (input.accounts as JsonRecord[]) : [];
  const account = rows.find(
    (item) => String(item.accountId ?? item.id ?? "") === input.expectedAccountId,
  );
  const type = String(account?.type ?? account?.accountType ?? "")
    .trim()
    .toUpperCase();
  if (
    !account ||
    !new Set(["DEMO", "PAPER", "PAPER_TRADING"]).has(type) ||
    booleanValue(account.noClientTrading) ||
    (account.brokerageAccess !== undefined && !booleanValue(account.brokerageAccess))
  ) {
    throw new Error("PAPER_ENVIRONMENT_MISMATCH");
  }
  return account;
}

export async function verifiedIbkrPaperAccount(input: {
  cacheKey: string;
  load: () => Promise<{
    accounts: unknown;
    authenticationStatus: unknown;
    expectedAccountId: string;
    ssoValidation: unknown;
  }>;
}) {
  const cached = paperProofCache.get(input.cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.account;
  const active = paperProofInFlight.get(input.cacheKey);
  if (active) return active;

  const proof = input.load().then((snapshot) => {
    const account = assertIbkrPaperSession(snapshot);
    paperProofCache.set(input.cacheKey, {
      account,
      expiresAt: Date.now() + PAPER_PROOF_CACHE_MS,
    });
    return account;
  });
  paperProofInFlight.set(input.cacheKey, proof);
  try {
    return await proof;
  } finally {
    if (paperProofInFlight.get(input.cacheKey) === proof) {
      paperProofInFlight.delete(input.cacheKey);
    }
  }
}

export function invalidateIbkrPaperSession(cacheKey: string) {
  paperProofCache.delete(cacheKey);
}
