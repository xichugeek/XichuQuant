export type RiskDisciplineIncidentView = {
  id: string;
  title: string;
  symbols: string[];
  riskTheme: string | null;
  dataGranularity: string;
  openedAt: string;
  firstViolationAt: string | null;
  closedAt: string | null;
  status: string;
  finalRealizedPnl: number | null;
  maximumUnrealizedLoss: number | null;
};

export type TradeDisciplineAnalytics = {
  coverage?: string;
  averageLoss: number | null;
  averageLoserHoldingHours: number | null;
  averageWin: number | null;
  averageWinnerHoldingHours: number | null;
  dispositionEffect: { detected: boolean; flags: string[] };
  leveragedOvernightCount: number;
  losingAddCount: number;
  mae: number;
  maeToRealizedLoss: number | null;
  maxSingleLoss: number | null;
  maxSingleLossToPeakYtdProfitPct: number | null;
  mfe: number;
  mfeCaptureRatio: number | null;
  noStopEntryCount: number;
  profitFactor: number | null;
  stopAmendmentViolationCount: number;
  strategyOutsideTradeCount: number;
  tradeCount: number | null;
};

export type RiskDisciplineDashboard = {
  account: { accountType?: string; equity: number; id: string; name: string };
  auditEvents: Array<{
    id: string;
    actorId: string;
    approvalChainJson: string | null;
    decision: string;
    eventType: string;
    newValueJson: string | null;
    occurredAt: string;
    oldValueJson: string | null;
    reason: string;
    ruleCode: string;
    severity: string;
  }>;
  currentDrawdownPct: number | null;
  grossEffectiveExposure: number;
  grossEffectiveExposurePct: number;
  incidents: RiskDisciplineIncidentView[];
  killSwitch: { level: string; reason: string | null; safetyState: string };
  leveragedEtfPrincipal: number;
  leveragedEtfPrincipalPct: number;
  losingAddEvents: number;
  maxRiskTheme: {
    grossEffectiveExposure: number;
    grossEffectiveExposurePct: number;
    key: string;
    symbols: string[];
  } | null;
  netDirectionalExposure: number;
  netDirectionalExposurePct: number;
  overnightLeveragedExposure: Array<{
    allowOvernight: boolean | null;
    effectiveExposure: number;
    marketValue: number;
    symbol: string;
  }>;
  profitGiveback: {
    currentYtdPnl: number | null;
    peakYtdPnl: number | null;
    profitGivebackAmount: number | null;
    profitGivebackPct: number | null;
    state: string;
  };
  recentTradeRiskBudgets: Array<{
    allowOvernight: boolean | null;
    createdAt: string;
    id: string;
    plannedLoss: number | null;
    plannedLossPct: number | null;
    status: string;
    plannedStopPrice: number | null;
    symbol: string;
  }>;
  stopCompliance: { compliant: number; ratePct: number | null; total: number };
  tradeDiscipline: TradeDisciplineAnalytics;
};

export type IncidentReplay = {
  dataGranularity: string;
  entries: Array<{
    averageCostAfter?: number;
    price: number;
    quantity: number;
    realizedPnlAfter?: number;
    stage: string;
    symbol: string;
    time: string;
  }>;
  finalRealizedPnl: number;
  firstViolationToCloseHours: number | null;
  incident: RiskDisciplineIncidentView;
  maeToRealizedLoss: number | null;
  maximumFavorableExcursion: number;
  maximumUnrealizedLoss: number;
  methodology: string;
  splitAdjustments: Array<{ date: string; ratio: number; source: string; symbol: string }>;
  timeline: Array<{
    accountEquity: number | null;
    accountEquityPercent: number | null;
    costBasis: number;
    dailyMae: number;
    dailyMfe: number;
    date: string;
    effectiveLeverageExposure: number;
    effectiveLeverageExposurePct: number | null;
    marketValue: number;
    unrealizedPnl: number;
  }>;
};

export const mockRiskDisciplineDashboard: RiskDisciplineDashboard = {
  account: { equity: 120000, id: "account-demo", name: "虚构演示账户 DEMO" },
  auditEvents: [
    {
      actorId: "system",
      approvalChainJson: null,
      decision: "BLOCKED",
      eventType: "ORDER_DISCIPLINE_BLOCKED",
      id: "risk-event-memory-theme",
      newValueJson: JSON.stringify({ grossEffectiveExposurePct: 53600 / 120000 * 100 }),
      occurredAt: "2026-07-17T00:00:00.000Z",
      oldValueJson: JSON.stringify({ grossEffectiveExposurePct: 0 }),
      reason: "DLA2 与 DLB2 同属 Synthetic Lab Theme，有效总敞口超过上限。",
      ruleCode: "RISK_THEME_EFFECTIVE_GROSS_MAX",
      severity: "CRITICAL",
    },
  ],
  currentDrawdownPct: (120000 / 126000 - 1) * 100,
  grossEffectiveExposure: 53600,
  grossEffectiveExposurePct: 25,
  incidents: [
    {
      closedAt: "2024-03-16T00:00:00.000Z",
      dataGranularity: "DAILY_MAE_APPROXIMATION",
      finalRealizedPnl: -6000,
      firstViolationAt: "2024-02-12T00:00:00.000Z",
      id: "position-incident-synthetic-lab",
      maximumUnrealizedLoss: -9000,
      openedAt: "2024-02-05T00:00:00.000Z",
      riskTheme: "SYNTHETIC_LAB",
      status: "CLOSED",
      symbols: ["DLA2", "DLB2"],
      title: "Synthetic Lab 2× ETF 亏损补仓事故",
    },
  ],
  killSwitch: { level: "LEVEL_1_NO_NEW_ENTRY", reason: "Profit Giveback Guard", safetyState: "READ_ONLY" },
  leveragedEtfPrincipal: 15000,
  leveragedEtfPrincipalPct: 12.5,
  losingAddEvents: 2,
  maxRiskTheme: {
    grossEffectiveExposure: 30000,
    grossEffectiveExposurePct: 25,
    key: "SYNTHETIC_LAB",
    symbols: ["DLA2", "DLB2"],
  },
  netDirectionalExposure: 53600,
  netDirectionalExposurePct: 53600 / 120000 * 100,
  overnightLeveragedExposure: [
    { allowOvernight: false, effectiveExposure: 18000, marketValue: 9000, symbol: "DLA2" },
    { allowOvernight: null, effectiveExposure: 12000, marketValue: 6000, symbol: "DLB2" },
  ],
  profitGiveback: {
    currentYtdPnl: 12000,
    peakYtdPnl: 18000,
    profitGivebackAmount: 6000,
    profitGivebackPct: 33.33,
    state: "KILL_SWITCH",
  },
  recentTradeRiskBudgets: [
    {
      allowOvernight: false,
      createdAt: "2026-07-17T00:00:00.000Z",
      id: "budget-dla2",
      plannedLoss: 300,
      plannedLossPct: 0.25,
      status: "RISK_REJECTED",
      plannedStopPrice: 148,
      symbol: "DLA2",
    },
  ],
  stopCompliance: { compliant: 1, ratePct: 33.33, total: 3 },
  tradeDiscipline: {
    averageLoss: -3000,
    averageLoserHoldingHours: 240,
    averageWin: 600,
    averageWinnerHoldingHours: 12,
    dispositionEffect: {
      detected: true,
      flags: ["SMALL_WIN_BIG_LOSS", "HOLD_LOSERS_LONGER", "AVERAGE_DOWN_LOSERS"],
    },
    leveragedOvernightCount: 2,
    losingAddCount: 2,
    mae: 9000,
    maeToRealizedLoss: 1.5,
    maxSingleLoss: -3000,
    maxSingleLossToPeakYtdProfitPct: 3000 / 18000 * 100,
    mfe: 900,
    mfeCaptureRatio: null,
    noStopEntryCount: 2,
    profitFactor: 0.2,
    stopAmendmentViolationCount: 1,
    strategyOutsideTradeCount: 1,
    tradeCount: 7,
  },
};

export const emptyRiskDisciplineDashboard: RiskDisciplineDashboard = {
  ...mockRiskDisciplineDashboard,
  account: { accountType: "UNAVAILABLE", equity: 0, id: "unavailable", name: "账户数据暂不可用" },
  auditEvents: [],
  currentDrawdownPct: 0,
  grossEffectiveExposure: 0,
  grossEffectiveExposurePct: 0,
  incidents: [],
  killSwitch: { level: "UNKNOWN", reason: "API 暂不可用", safetyState: "READ_ONLY" },
  leveragedEtfPrincipal: 0,
  leveragedEtfPrincipalPct: 0,
  losingAddEvents: 0,
  maxRiskTheme: null,
  netDirectionalExposure: 0,
  netDirectionalExposurePct: 0,
  overnightLeveragedExposure: [],
  profitGiveback: {
    currentYtdPnl: 0,
    peakYtdPnl: 0,
    profitGivebackAmount: 0,
    profitGivebackPct: 0,
    state: "UNKNOWN",
  },
  recentTradeRiskBudgets: [],
  stopCompliance: { compliant: 0, ratePct: null, total: 0 },
  tradeDiscipline: {
    averageLoss: 0,
    averageLoserHoldingHours: 0,
    averageWin: 0,
    averageWinnerHoldingHours: 0,
    dispositionEffect: { detected: false, flags: [] },
    leveragedOvernightCount: 0,
    losingAddCount: 0,
    mae: 0,
    maeToRealizedLoss: null,
    maxSingleLoss: 0,
    maxSingleLossToPeakYtdProfitPct: null,
    mfe: 0,
    mfeCaptureRatio: null,
    noStopEntryCount: 0,
    profitFactor: null,
    stopAmendmentViolationCount: 0,
    strategyOutsideTradeCount: 0,
    tradeCount: 0,
  },
};

export const mockIncidentReplay: IncidentReplay = {
  dataGranularity: "DAILY_MAE_APPROXIMATION",
  incident: mockRiskDisciplineDashboard.incidents[0]!,
  entries: [
    { averageCostAfter: 200, price: 200, quantity: 60, stage: "INITIAL_ENTRY", symbol: "DLA2", time: "2024-02-05T00:00:00Z" },
    { averageCostAfter: 90, price: 90, quantity: 100, stage: "SCALE_IN", symbol: "DLB2", time: "2024-02-12T00:00:00Z" },
  ], finalRealizedPnl: -6000, firstViolationToCloseHours: 792,
  maximumUnrealizedLoss: -9000, maximumFavorableExcursion: 900, maeToRealizedLoss: 1.5,
  methodology: "SYNTHETIC / Daily MAE approximation：合成 Daily OHLCV，不代表真实账户或精确盘中路径。",
  splitAdjustments: [{ date: "2024-02-20", ratio: 2, source: "SYNTHETIC_CORPORATE_ACTION", symbol: "DLB2" }],
  timeline: [
    { date: "2024-02-12", accountEquity: 126000, accountEquityPercent: 21000 / 126000 * 100,
      costBasis: 21000, marketValue: 21000, effectiveLeverageExposure: 42000,
      effectiveLeverageExposurePct: 42000 / 126000 * 100, dailyMae: -900, dailyMfe: 300, unrealizedPnl: 0 },
    { date: "2024-03-16", accountEquity: 120000, accountEquityPercent: 12.5, costBasis: 21000,
      marketValue: 15000, effectiveLeverageExposure: 30000, effectiveLeverageExposurePct: 25,
      dailyMae: -9000, dailyMfe: 0, unrealizedPnl: -6000 },
  ],
};
