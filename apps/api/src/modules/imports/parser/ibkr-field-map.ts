export const IBKR_FIELDS = {
  accountId: ["Account ID", "AccountId", "Account", "Account Number"],
  action: ["Buy/Sell", "Transaction Type", "Type", "Action"],
  amount: ["Amount", "Cash Amount"],
  assetClass: ["Asset Class", "Asset Category", "AssetCategory"],
  closePrice: ["Close Price", "C. Price", "Mark Price", "Current Price"],
  commission: ["IB Commission", "Comm/Fee", "Commission", "Commissions"],
  corporateActionType: ["Corporate Action Type", "Type"],
  costBasis: ["Cost Basis", "Basis", "Cost Basis Money"],
  currency: ["Currency", "Currency Primary", "IB Commission Currency"],
  dateTime: ["Date/Time", "Date", "Trade Date", "Activity Date", "Report Date"],
  description: ["Description", "Activity Description", "Transaction Description"],
  executionId: ["IB Execution ID", "Execution ID", "Exec ID"],
  externalId: ["Transaction ID", "Trade ID", "IB Execution ID", "External Execution ID"],
  fxRateToBase: ["FX Rate to Base", "FXRateToBase", "Conversion Rate"],
  marketValue: ["Position Value", "Value", "Current Market Value", "Market Value"],
  netCash: ["Net Cash", "NetCash"],
  position: ["Position", "Quantity", "Current Quantity"],
  price: ["Trade Price", "T. Price", "Price"],
  proceeds: ["Proceeds", "Trade Money"],
  quantity: ["Quantity", "Trade Quantity"],
  realizedPnl: ["Realized PNL", "Realized P/L", "Realized P&L"],
  reportDate: ["Report Date", "Statement Date"],
  symbol: ["Symbol", "Underlying Symbol"],
  taxes: ["Taxes", "Tax/Fee", "Transaction Tax"],
  tradeId: ["Trade ID", "IB Trade ID"],
  unrealizedPnl: ["Unrealized PNL", "Unrealized P/L", "Unrealized P&L"],
} as const;

export const IBKR_SECTION_ALIASES: Record<string, string> = {
  "account information": "ACCOUNT_INFORMATION",
  "cash report": "CASH_REPORT",
  "cash transactions": "CASH_TRANSACTIONS",
  "combined deposits and withdrawals": "DEPOSITS_WITHDRAWALS",
  "combined dividends": "DIVIDENDS",
  "combined fees": "FEES",
  "combined interest": "INTEREST",
  "corporate actions": "CORPORATE_ACTIONS",
  "deposits & withdrawals": "DEPOSITS_WITHDRAWALS",
  "deposits and withdrawals": "DEPOSITS_WITHDRAWALS",
  dividends: "DIVIDENDS",
  fees: "FEES",
  "forex p/l details": "FOREX_PNL",
  interest: "INTEREST",
  "net asset value": "NAV",
  "net asset value (nav) in base currency": "NAV",
  "net asset value (nav) summary in base": "NAV",
  "open positions": "OPEN_POSITIONS",
  "positions and mark-to-market profit and loss": "OPEN_POSITIONS",
  statement: "STATEMENT",
  trades: "TRADES",
  "transaction fees": "FEES",
  "withholding tax": "WITHHOLDING_TAX",
};

export const INFORMATIONAL_SECTIONS = new Set([
  "ACCOUNT_INFORMATION",
  "STATEMENT",
  "CODES",
  "FINANCIAL_INSTRUMENT_INFORMATION",
  "CHANGE_IN_NAV",
  "REALIZED_UNREALIZED_SUMMARY",
]);

export function canonicalSection(section: string): string {
  const normalized = section.trim().toLowerCase().replace(/\s+/g, " ");
  return IBKR_SECTION_ALIASES[normalized] ?? normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export function getField(record: Record<string, string>, aliases: readonly string[]): string {
  for (const alias of aliases) {
    const direct = record[alias];
    if (direct !== undefined && direct !== "") return direct;
    const normalizedAlias = normalizeHeader(alias);
    const match = Object.entries(record).find(([key, value]) => {
      return value !== "" && normalizeHeader(key) === normalizedAlias;
    });
    if (match) return match[1];
  }
  return "";
}

export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
