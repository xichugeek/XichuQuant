import type {
  AccountPerformance,
  AccountView,
  InstrumentView,
  PositionRiskView,
  ReviewRecord,
  RiskRuleView,
  RiskSummary,
  TradeView,
} from "@xichu-risk/shared";

// DEMO only. These invented instruments and amounts have no relationship to a personal account.
export const mockAccount: AccountView = {
  dataOrigin: "DEMO", id: "account-demo", name: "虚构演示账户 DEMO", broker: "Fictional Demo",
  brokerAccountId: null, baseCurrency: "USD", initialCapital: 108000,
  totalEquity: 120000, cashBalance: 81400, realizedPnlYtd: 18000,
};
export const mockPositions: PositionRiskView[] = [
  ["DLA2", "Fictional Lab Alpha 2x ETF", "LEVERAGED_ETF", "STORAGE", 60, 200, 150],
  ["DLB2", "Fictional Lab Beta 2x ETF", "LEVERAGED_ETF", "STORAGE", 100, 90, 60],
  ["QQQM", "NASDAQ ETF demo", "ETF", "CORE_INDEX", 40, 320, 320],
  ["VOO", "Index ETF demo", "ETF", "CORE_INDEX", 12, 500, 500],
  ["AAPL", "Stock demo", "STOCK", "BIG_TECH", 30, 160, 160],
].map(([symbol, name, assetType, theme, quantity, avgCost, currentPrice]) => {
  const costAmount = Number(quantity) * Number(avgCost);
  const marketValue = Number(quantity) * Number(currentPrice);
  const leveragedETF = assetType === "LEVERAGED_ETF";
  const effectiveExposure = marketValue * (leveragedETF ? 2 : 1);
  return { id: `position-${String(symbol).toLowerCase()}`, symbol: String(symbol), name: String(name),
    assetType: String(assetType), category: leveragedETF ? "HIGH_RISK" : "CORE", theme: String(theme),
    leveragedETF, leverageMultiplier: leveragedETF ? 2 : 1, direction: "LONG", riskTheme: String(theme),
    quantity: Number(quantity), avgCost: Number(avgCost), currentPrice: Number(currentPrice),
    costAmount, marketValue, unrealizedPnl: marketValue - costAmount,
    unrealizedPnlPercent: (marketValue - costAmount) / costAmount * 100,
    positionPercent: marketValue / mockAccount.totalEquity * 100, effectiveExposure,
    effectiveExposurePercent: effectiveExposure / mockAccount.totalEquity * 100,
    riskLevel: leveragedETF ? "DANGER" as const : "LOW" as const,
    suggestedAction: leveragedETF ? "演示：禁止亏损补仓，按预设退出。" : "演示：遵守计划。",
  };
});
const fallbackAlerts: RiskSummary["alerts"] = [{
  code: "LEVERAGED_ETF_TOTAL_MAX", level: "VIOLATION", title: "演示：杠杆 ETF 总仓位超过 10%",
  message: "完全虚构的集中风险场景。", currentValue: 12.5, limitValue: 10, unit: "PERCENT",
  suggestedAction: "演示：暂停新增风险。",
}];
export const mockRiskSummary: RiskSummary = {
  accountId: mockAccount.id, accountName: mockAccount.name, totalEquity: 120000, cashBalance: 81400,
  cashPercent: 81400 / 120000 * 100, positionValue: 38600, positionPercent: 38600 / 120000 * 100,
  leveragedEtfValue: 15000, leveragedEtfPercent: 12.5, grossEffectiveExposure: 53600,
  grossEffectiveExposurePercent: 53600 / 120000 * 100, netDirectionalExposure: 53600,
  netDirectionalExposurePercent: 53600 / 120000 * 100, exposureBySymbol: [], exposureByUnderlying: [],
  exposureByIndustry: [], exposureBySector: [], exposureByRiskTheme: [{
    grossEffectiveExposure: 30000, grossEffectiveExposurePct: 25, key: "SYNTHETIC_LAB",
    netDirectionalExposure: 30000, netDirectionalExposurePct: 25, principal: 15000, principalPct: 12.5,
    symbols: ["DLA2", "DLB2"],
  }], maxRiskThemeEffectiveExposurePercent: 25, maxSinglePositionPercent: 12800 / 120000 * 100,
  storageThemeValue: 15000, storageThemePercent: 12.5, unrealizedPnlTotal: -6000,
  unrealizedLossTotal: 6000, realizedPnlYtd: 18000, annualNetPnl: 12000,
  floatingLossToRealizedProfitPercent: 6000 / 18000 * 100, overallRiskLevel: "VIOLATION",
  messages: fallbackAlerts.map((alert) => alert.message), alerts: fallbackAlerts, positions: mockPositions,
};

export const mockTrades: TradeView[] = [
  {
    id: "trade-1",
    date: "2024-02-05",
    symbol: "DLA2",
    side: "BUY",
    quantity: 60,
    price: 200,
    amount: 12000,
    emotion: "FOMO",
    followedRule: false,
  },
  {
    id: "trade-2",
    date: "2024-02-12",
    symbol: "DLB2",
    side: "BUY",
    quantity: 100,
    price: 90,
    amount: 9000,
    emotion: "REVENGE",
    followedRule: false,
  },
  {
    id: "trade-3",
    date: "2024-01-19",
    symbol: "VOO",
    side: "BUY",
    quantity: 12,
    price: 500,
    amount: 6000,
    emotion: "DISCIPLINED",
    followedRule: true,
  },
];

export const mockInstruments: InstrumentView[] = mockPositions.map((position) => ({
  id: `instrument-${position.symbol.toLowerCase()}`,
  symbol: position.symbol,
  name: position.name,
  market: "US",
  assetType: position.assetType,
  category: position.category,
  theme: position.theme,
  underlyingSymbol:
    position.symbol === "DLA2" ? "DEMO_ALPHA" : position.symbol === "DLB2" ? "DEMO_BETA" : position.symbol,
  riskTheme: position.leveragedETF ? "SYNTHETIC_LAB" : position.theme,
  sector: ["STORAGE", "CORE_INDEX", "BIG_TECH"].includes(position.theme ?? "")
    ? "TECHNOLOGY"
    : position.category,
  industry: position.leveragedETF ? "SYNTHETIC_LAB" : position.category,
  leverageRatio: position.assetType === "LEVERAGED_ETF" ? 2 : null,
  leverageMultiplier: position.assetType === "LEVERAGED_ETF" ? 2 : 1,
  direction: "LONG",
  leveragedETF: position.assetType === "LEVERAGED_ETF",
  isActive: true,
}));

export const mockRules: RiskRuleView[] = [
  {
    id: "rule-1",
    code: "LEVERAGED_ETF_SINGLE_MAX",
    name: "单只杠杆 ETF 最大仓位",
    ruleType: "POSITION_PERCENT",
    limitValue: 5,
    level: "DANGER",
    enabled: true,
  },
  {
    id: "rule-2",
    code: "LEVERAGED_ETF_TOTAL_MAX",
    name: "杠杆 ETF 总仓位上限",
    ruleType: "POSITION_PERCENT",
    limitValue: 10,
    level: "VIOLATION",
    enabled: true,
  },
  {
    id: "rule-3",
    code: "STORAGE_THEME_MAX",
    name: "存储主题仓位上限",
    ruleType: "THEME_PERCENT",
    limitValue: 15,
    level: "DANGER",
    enabled: true,
  },
  {
    id: "rule-4",
    code: "ANNUAL_PROFIT_PROTECTION",
    name: "年度利润保护线",
    ruleType: "PROFIT_PROTECTION",
    limitValue: 50,
    level: "DANGER",
    enabled: true,
  },
  {
    id: "rule-5",
    code: "ENTRY_EXIT_REQUIRED",
    name: "买入必须填写退出条件",
    ruleType: "BOOLEAN",
    limitValue: 1,
    level: "VIOLATION",
    enabled: true,
  },
];

export const mockReviews: ReviewRecord[] = [
  {
    id: "review-seed",
    title: "存储杠杆 ETF 超仓复盘",
    symbol: "DLA2 / DLB2",
    mistakeType: "LEVERAGED_ETF_ABUSE",
    summary: "DLA2 与 DLB2 同属存储主题，叠加杠杆后造成风险集中。",
    lesson: "杠杆产品不能用补仓代替止损，机会仓不能做成主仓。",
    actionRule: "任何杠杆 ETF 总仓位不得超过账户资产的 10%。",
  },
];

const mockPerformanceSeries = [
    ["2026-01-02", 108000, 108000, 0, "SYNTHETIC 起始权益"],
    ["2026-03-16", 114500, 114500, 6500, "SYNTHETIC 账本快照"],
    ["2026-05-08", 126000, 126000, 18000, "SYNTHETIC 权益峰值"],
    ["2026-07-17", 120000, 81400, 18000, "SYNTHETIC 回撤快照"],
  ] as const;

export function getMockAccountPerformance(
  period: AccountPerformance["period"] = "YTD",
): AccountPerformance {
  const latest = new Date("2026-07-17T00:00:00.000Z");
  let cutoff: Date | null = new Date("2026-01-01T00:00:00.000Z");
  if (period === "1M") cutoff = new Date("2026-06-17T00:00:00.000Z");
  if (period === "3M") cutoff = new Date("2026-04-17T00:00:00.000Z");
  if (period === "1Y") {
    cutoff = new Date(latest);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  }
  if (period === "ALL") cutoff = null;
  const raw = mockPerformanceSeries.filter(([date]) => !cutoff || new Date(date) >= cutoff);
  const startEquity = Number(raw[0]?.[1] ?? 120000);
  let peak: number = startEquity;
  let maxDrawdownPercent = 0;
  let profitPeriods = 0;
  let lossPeriods = 0;
  const series = raw.map(([date, equity, cashBalance, realizedPnlYtd, note], index) => {
    peak = Math.max(peak, equity);
    const drawdownPercent = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    maxDrawdownPercent = Math.min(maxDrawdownPercent, drawdownPercent);
    if (index > 0) {
      const change = equity - (raw[index - 1]?.[1] ?? equity);
      if (change > 0) {
        profitPeriods += 1;
      } else if (change < 0) {
        lossPeriods += 1;
      }
    }
    return {
      date,
      equity,
      cashBalance,
      realizedPnlYtd,
      periodPnl: equity - startEquity,
      periodReturnPercent: ((equity - startEquity) / startEquity) * 100,
      drawdownPercent,
      note,
    };
  });
  const currentEquity = series.at(-1)?.equity ?? 120000;
  const periodPnl = currentEquity - startEquity;
  const measuredPeriods = profitPeriods + lossPeriods;
  return {
    dataOrigin: "DEMO",
    returnsVerified: true,
    returnsStatus: "SYNTHETIC_NO_EXTERNAL_CASH_FLOWS",
    accountId: mockAccount.id,
    accountName: mockAccount.name,
    period,
    periodLabel: { "1M": "近 1 月", "3M": "近 3 月", YTD: "今年", "1Y": "近 1 年", ALL: "全部" }[
      period
    ],
    initialCapital: 108000,
    periodStartEquity: startEquity,
    currentEquity,
    totalNetPnl: currentEquity - 108000,
    totalReturnPercent: ((currentEquity - 108000) / 108000) * 100,
    periodPnl,
    periodReturnPercent: (periodPnl / startEquity) * 100,
    realizedPnlYtd: 18000,
    unrealizedPnl: -6000,
    cashBalance: 81400,
    cashPercent: 81400 / 120000 * 100,
    peakEquity: Math.max(startEquity, ...series.map((point) => point.equity)),
    maxDrawdownPercent,
    profitPeriods,
    lossPeriods,
    winRatePercent: measuredPeriods > 0 ? (profitPeriods / measuredPeriods) * 100 : 0,
    profitFactor: null,
    series,
  };
}

export const mockAccountPerformance = getMockAccountPerformance();
