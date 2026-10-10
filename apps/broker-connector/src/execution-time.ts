/** TWS execution timestamps use the login timezone, not the server's timezone. */
export function parseExecutionTime(value: string | undefined, configuredZone?: string) {
  const text = (value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const instant = Date.parse(text);
    if (Number.isFinite(instant)) return new Date(instant).toISOString();
  }
  const match = /^(\d{4})(\d{2})(\d{2})[ -]+(\d{2}):(\d{2}):(\d{2})(?:\s+([A-Za-z_]+\/[A-Za-z_]+|UTC|GMT))?$/.exec(text);
  if (!match) throw new Error("Execution timestamp missing or unrecognized; refusing to fabricate a time");
  const [, year, month, day, hour, minute, second, suppliedZone] = match;
  const zone = suppliedZone ?? configuredZone;
  if (!zone) throw new Error("Zoneless TWS execution requires IBKR_TWS_EXECUTION_TIMEZONE");
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const wallAt = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  };
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt++) instant += wall - wallAt(instant);
  if (wallAt(instant) !== wall || wallAt(instant - 3600000) === wall || wallAt(instant + 3600000) === wall) {
    throw new Error("Execution timestamp is nonexistent or ambiguous during a DST transition");
  }
  return new Date(instant).toISOString();
}
