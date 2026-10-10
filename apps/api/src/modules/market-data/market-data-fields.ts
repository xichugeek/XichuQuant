export const MARKET_DATA_FIELDS = {
  adjustedClose: ["Adjusted Close", "Adj Close", "Adj. Close", "AdjustedClose"],
  close: ["Close", "Close Price"],
  currency: ["Currency", "CCY"],
  dividend: ["Dividend", "Dividends", "Cash Dividend"],
  high: ["High", "High Price"],
  low: ["Low", "Low Price"],
  open: ["Open", "Open Price"],
  source: ["Source", "Provider"],
  splitFactor: ["Split Factor", "SplitFactor", "Stock Splits", "Split"],
  symbol: ["Symbol", "Ticker", "Security"],
  tradeDate: ["Date", "Trade Date", "TradeDate", "Timestamp"],
  volume: ["Volume", "Total Volume"],
} as const;

export function normalizeMarketHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function resolveMarketField(headers: string[], aliases: readonly string[]) {
  const aliasSet = new Set(aliases.map(normalizeMarketHeader));
  return headers.find((header) => aliasSet.has(normalizeMarketHeader(header)));
}
