import { canonicalSection, normalizeHeader } from "./ibkr-field-map";
import type { IbkrAdapterResult, IbkrCsvAdapter } from "./ibkr-adapter";

export class FlexQueryAdapter implements IbkrCsvAdapter {
  canParse(rows: string[][]): boolean {
    if (rows.length < 2) return false;
    const headers = rows[0]!.map(normalizeHeader);
    return (
      headers.includes("accountid") ||
      headers.includes("symbol") ||
      headers.includes("transactionid")
    );
  }

  parse(rows: string[][]): IbkrAdapterResult {
    const headers = rows[0]!;
    const accountIds = new Set<string>();
    const section = inferFlexSection(headers);
    const records = rows.slice(1).map((row, index) => {
      const values = Object.fromEntries(
        headers.map((header, column) => [header, row[column] ?? ""]),
      );
      const accountEntry = Object.entries(values).find(
        ([key]) => normalizeHeader(key) === "accountid",
      );
      if (accountEntry?.[1]) accountIds.add(accountEntry[1]);
      return { section, sourceRow: index + 2, values };
    });
    return {
      adapter: "FLEX_QUERY",
      accountIds: [...accountIds],
      statementStart: null,
      statementEnd: null,
      records,
      ignoredRows: 1,
    };
  }
}

function inferFlexSection(headers: string[]): string {
  const normalized = new Set(headers.map(normalizeHeader));
  if (
    normalized.has("tradeid") ||
    normalized.has("ibexecutionid") ||
    normalized.has("tradeprice")
  ) {
    return "TRADES";
  }
  if (
    normalized.has("positionvalue") ||
    normalized.has("unrealizedpnl") ||
    normalized.has("markprice")
  ) {
    return "OPEN_POSITIONS";
  }
  if (normalized.has("corporateactiontype") || normalized.has("principaladjustmentfactor")) {
    return "CORPORATE_ACTIONS";
  }
  if (normalized.has("transactionid") || normalized.has("amount")) return "CASH_TRANSACTIONS";
  return canonicalSection("Unknown Flex Query");
}
