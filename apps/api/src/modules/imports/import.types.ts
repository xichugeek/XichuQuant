export const IMPORT_RECORD_TYPES = [
  "TRADE",
  "POSITION",
  "COMMISSION",
  "DIVIDEND",
  "WITHHOLDING_TAX",
  "INTEREST",
  "DEPOSIT",
  "WITHDRAWAL",
  "CASH_BALANCE",
  "FX_TRANSACTION",
  "CORPORATE_ACTION",
  "NAV_SNAPSHOT",
  "UNKNOWN",
] as const;

export type ImportRecordType = (typeof IMPORT_RECORD_TYPES)[number];
export type ImportRecordStatus =
  "VALID" | "PENDING" | "DUPLICATE" | "IMPORTED" | "FAILED" | "ROLLED_BACK";

export type AccountMatchStatus = "EXACT" | "UNBOUND" | "MISSING" | "MISMATCH" | "MULTIPLE";

export type NormalizedImportRecord = {
  sourceSection: string;
  sourceRow: number;
  recordType: ImportRecordType;
  externalId: string;
  externalAccountId: string | null;
  transactionDate: string | null;
  symbol: string | null;
  description: string | null;
  assetClass: string | null;
  currency: string;
  action: string | null;
  quantity: number | null;
  price: number | null;
  currentPrice: number | null;
  amount: number | null;
  netCash: number | null;
  commission: number | null;
  taxes: number | null;
  costBasis: number | null;
  marketValue: number | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  fxRateToBase: number | null;
  corporateActionType: string | null;
  splitRatio: number | null;
  raw: Record<string, string>;
  validationErrors: string[];
};

export type ParsedImportFile = {
  adapter: "ACTIVITY_STATEMENT" | "FLEX_QUERY";
  fileHash: string;
  externalAccountIds: string[];
  statementStart: string | null;
  statementEnd: string | null;
  records: NormalizedImportRecord[];
  ignoredRows: number;
};

export type PositionState = {
  instrumentId: string;
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  note?: string | null;
};

export type AccountRollbackState = {
  initialCapital: number;
  totalEquity: number;
  cashBalance: number;
  realizedPnlYtd: number;
  brokerAccountId: string | null;
};

export type SnapshotRollbackState = {
  id: string;
  snapshotDate: string;
  totalEquity: number;
  cashBalance: number;
  realizedPnlYtd: number;
  note: string | null;
  importBatchId: string | null;
} | null;

export type ImportRollbackData = {
  account: AccountRollbackState;
  affectedPositions: Array<{ instrumentId: string; before: PositionState | null }>;
  createdInstrumentIds: string[];
  snapshot: SnapshotRollbackState;
  snapshotDate: string;
};

export type AccountingTrade = {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  commission: number;
  realizedPnl: number | null;
};

export type AccountingPosition = {
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
};
