import { createHash } from "node:crypto";

export function parseIbkrNumber(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "--") return null;
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const cleaned = trimmed.replace(/[,$%\s()]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function parseIbkrDate(value: string | undefined): string | null {
  if (!value) return null;
  const input = value.trim().replace(";", " ");
  if (!input) return null;

  const compact = input.match(/^(\d{4})(\d{2})(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (compact) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = compact;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  }

  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = iso;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  }

  const slash = input.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (slash) {
    const [, month, day, year, hour = "00", minute = "00", second = "00"] = slash;
    return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}T${hour!.padStart(2, "0")}:${minute}:${second}.000Z`;
  }

  const timestamp = Date.parse(input);
  if (Number.isNaN(timestamp)) return null;
  const local = new Date(timestamp);
  return new Date(
    Date.UTC(
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      local.getHours(),
      local.getMinutes(),
      local.getSeconds(),
    ),
  ).toISOString();
}

export function parseStatementPeriod(value: string): { start: string; end: string } | null {
  const candidates = value
    .split(/\s+-\s+|\s+to\s+/i)
    .map((part) => parseIbkrDate(part))
    .filter((part): part is string => part !== null);
  if (candidates.length !== 2) return null;
  return { start: candidates[0]!, end: candidates[1]! };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function stableRecordId(input: {
  section: string;
  accountId: string | null;
  explicitId: string;
  values: Record<string, unknown>;
}): string {
  if (input.explicitId) {
    const normalizedId = input.explicitId.trim().replace(/\s+/g, "_");
    return `IBKR:${input.section}:${input.accountId ?? "UNKNOWN"}:${normalizedId}`.slice(0, 128);
  }
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(input.values)
        .filter(([, value]) => value !== null && value !== "")
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  return `IBKR:${input.section}:${sha256(canonical)}`.slice(0, 128);
}

export function splitRatioFromDescription(description: string): number | null {
  const patterns = [
    /(?:split|stock split).*?(\d+(?:\.\d+)?)\s*(?:for|:|\/|比)\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:for|:|\/|比)\s*(\d+(?:\.\d+)?).*?(?:split|stock split)/i,
  ];
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (!match) continue;
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
      return numerator / denominator;
    }
  }
  return null;
}
