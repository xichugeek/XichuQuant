import { readFileSync } from "node:fs";
import path from "node:path";

const BROKER_ENV_KEYS = new Set([
  "BROKER_CONNECTOR_ENVIRONMENT",
  "BROKER_CONNECTOR_MODE",
  "BROKER_CONNECTOR_PORT",
  "BROKER_CONNECTOR_HOST",
  "BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST",
  "IBKR_GATEWAY_CA_CERT_PATH",
  "IBKR_PAPER_ACCOUNT_ID",
  "IBKR_PAPER_BASE_URL",
  "IBKR_PAPER_TRANSPORT",
  "IBKR_READONLY_BASE_URL",
  "IBKR_TWS_API_READ_ONLY",
  "IBKR_TWS_CLIENT_ID",
  "IBKR_TWS_HOST",
  "IBKR_TWS_PORT",
  "IBKR_TWS_TIMEOUT_MS",
  "IBKR_TWS_EXECUTION_TIMEZONE",
]);

export function parseBrokerEnvironment(content: string) {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!BROKER_ENV_KEYS.has(key)) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadBrokerEnvironment(envPath = path.resolve(__dirname, "../../../.env")) {
  if (process.env.XICHURISK_ENV_ISOLATED === "true") return false;
  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  for (const [key, value] of Object.entries(parseBrokerEnvironment(content))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}
