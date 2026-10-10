import type { NormalizedMarketRow, ParsedMarketRecord } from "./market-data-parser.service";

export function marketDataKey(row: Pick<NormalizedMarketRow, "source" | "symbol" | "tradeDate">): string {
  return `${row.symbol}|${row.tradeDate.toISOString().slice(0, 10)}|${row.source}`;
}

export function markMarketDataDuplicates(
  records: ParsedMarketRecord[],
  existingKeys: ReadonlySet<string>,
) {
  const seen = new Set<string>();
  return records.map((record) => {
    const key = record.normalized ? marketDataKey(record.normalized) : "";
    const duplicate = key !== "" && (seen.has(key) || existingKeys.has(key));
    if (key) seen.add(key);
    return {
      ...record,
      errors: duplicate ? [...record.errors, "symbol + tradeDate + source 已存在"] : record.errors,
      status: duplicate ? ("DUPLICATE" as const) : record.status,
    };
  });
}
