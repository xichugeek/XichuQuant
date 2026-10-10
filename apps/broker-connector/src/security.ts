const SENSITIVE_KEY =
  /password|secret|token|cookie|authorization|session|accountnumber|externalaccountid/i;

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitive(item),
    ]),
  );
}

export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "未知连接错误";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(password|secret|token|cookie|authorization|session)=([^;&\s]+)/gi, "$1=[REDACTED]")
    .replace(/\b(?:DU|U)(?=[A-Z0-9]{5,20}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5,20}\b/gi, "[REDACTED_ACCOUNT]");
}

export function connectorResponsePayload(status: number, payload: unknown) {
  return status >= 400 ? redactSensitive(payload) : payload;
}
