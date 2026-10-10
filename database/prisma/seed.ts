import { assertDemoSeedTarget } from "./seed-safety";
import { validAdminPassword } from "./bootstrap-admin";
import { createHash, randomBytes, scryptSync } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

const instruments = [
  ["QQQM", "Invesco NASDAQ 100 ETF", "ETF", "CORE", "CORE_INDEX", null],
  ["SPY", "SPDR S&P 500 ETF Trust", "ETF", "CORE", "CORE_INDEX", null],
  ["IWM", "iShares Russell 2000 ETF", "ETF", "OPPORTUNITY", "SMALL_CAP", null],
  ["EFA", "iShares MSCI EAFE ETF", "ETF", "DIVERSIFIER", "INTERNATIONAL_EQUITY", null],
  ["TLT", "iShares 20+ Year Treasury Bond ETF", "ETF", "DEFENSIVE", "LONG_TREASURY", null],
  ["GLD", "SPDR Gold Shares", "ETF", "DIVERSIFIER", "GOLD", null],
  ["SHY", "iShares 1-3 Year Treasury Bond ETF", "ETF", "DEFENSIVE", "SHORT_TREASURY", null],
  ["VOO", "Vanguard S&P 500 ETF", "ETF", "CORE", "CORE_INDEX", null],
  ["SCHD", "Schwab US Dividend Equity ETF", "ETF", "DEFENSIVE", "DIVIDEND", null],
  ["AAPL", "Apple", "STOCK", "CORE", "BIG_TECH", null],
  ["GOOG", "Alphabet", "STOCK", "CORE", "BIG_TECH", null],
  ["NVDA", "NVIDIA", "STOCK", "CORE", "AI", null],
  ["MU", "Micron", "STOCK", "OPPORTUNITY", "STORAGE", null],
  ["SNDK", "SanDisk", "STOCK", "OPPORTUNITY", "STORAGE", null],
  ["DLA2", "Fictional Lab Alpha 2x ETF", "LEVERAGED_ETF", "HIGH_RISK", "STORAGE", 2],
  ["DLB2", "Fictional Lab Beta 2x ETF", "LEVERAGED_ETF", "HIGH_RISK", "STORAGE", 2],
  ["TQQQ", "ProShares UltraPro QQQ", "LEVERAGED_ETF", "HIGH_RISK", "CORE_INDEX", 3],
  ["NVDL", "NVIDIA 2x ETF", "LEVERAGED_ETF", "HIGH_RISK", "AI", 2],
  ["TSLL", "Tesla 2x ETF", "LEVERAGED_ETF", "HIGH_RISK", "BIG_TECH", 2],
  ["KO", "Coca-Cola", "STOCK", "DEFENSIVE", "CONSUMER_DEFENSIVE", null],
] as const;

const underlyingBySymbol: Record<string, string> = {
  AAPL: "AAPL",
  GOOG: "GOOG",
  MU: "MU",
  DLA2: "DEMO_ALPHA",
  NVDA: "NVDA",
  NVDL: "NVDA",
  SNDK: "SNDK",
  DLB2: "DEMO_BETA",
  TQQQ: "QQQ",
  TSLL: "TSLA",
};

const riskRules = [
  ["LEVERAGED_ETF_SINGLE_MAX", "单只杠杆 ETF 最大仓位", "POSITION_PERCENT", 5, "DANGER"],
  ["LEVERAGED_ETF_TOTAL_MAX", "杠杆 ETF 总仓位上限", "POSITION_PERCENT", 10, "VIOLATION"],
  ["SINGLE_STOCK_MAX", "单只普通个股最大仓位", "POSITION_PERCENT", 15, "WARNING"],
  ["THEME_MAX", "单一主题仓位上限", "THEME_PERCENT", 20, "WARNING"],
  ["STORAGE_THEME_MAX", "存储主题仓位上限", "THEME_PERCENT", 15, "DANGER"],
  ["LEVERAGED_ETF_LOSS_WARNING", "杠杆 ETF 浮亏警戒线", "LOSS_PERCENT", -10, "WARNING"],
  ["LEVERAGED_ETF_LOSS_DANGER", "杠杆 ETF 浮亏危险线", "LOSS_PERCENT", -15, "DANGER"],
  ["ANNUAL_PROFIT_PROTECTION", "年度利润保护线", "PROFIT_PROTECTION", 50, "DANGER"],
  ["ENTRY_EXIT_REQUIRED", "买入必须填写退出条件", "BOOLEAN", 1, "VIOLATION"],
  ["PAPER_DAILY_LOSS_MAX", "模拟账户单日最大亏损", "PAPER_PERCENT", 5, "DANGER"],
  ["PAPER_ACCOUNT_DRAWDOWN_MAX", "模拟账户最大回撤", "PAPER_PERCENT", 20, "VIOLATION"],
  ["PAPER_CONSECUTIVE_LOSSES_MAX", "模拟账户最大连续亏损次数", "PAPER_COUNT", 5, "DANGER"],
  ["PAPER_MAX_POSITIONS", "模拟账户最大持仓数量", "PAPER_COUNT", 10, "WARNING"],
  ["PAPER_MAX_ORDERS_PER_DAY", "模拟账户每日最大订单数", "PAPER_COUNT", 10, "WARNING"],
  ["MAX_RISK_PER_TRADE_PCT", "普通交易单笔最大计划损失", "ACCOUNT_RISK_PERCENT", 0.5, "VIOLATION"],
  ["LEVERAGED_ETF_MAX_RISK_PER_TRADE_PCT", "杠杆 ETF 单笔最大计划损失", "ACCOUNT_RISK_PERCENT", 0.25, "VIOLATION"],
  ["RISK_THEME_EFFECTIVE_GROSS_MAX_PCT", "单一 Risk Theme 有效总敞口上限", "EFFECTIVE_GROSS_PERCENT", 30, "VIOLATION"],
  ["OVERNIGHT_GAP_STRESS_MAX_LOSS_PCT", "杠杆 ETF 隔夜跳空最大账户损失", "ACCOUNT_RISK_PERCENT", 2, "VIOLATION"],
  ["PROFIT_GIVEBACK_REDUCED_RISK_PCT", "年度利润回吐降风险阈值", "PROFIT_GIVEBACK_PERCENT", 15, "WARNING"],
  ["PROFIT_GIVEBACK_DEFENSIVE_PCT", "年度利润回吐防御阈值", "PROFIT_GIVEBACK_PERCENT", 25, "DANGER"],
  ["PROFIT_GIVEBACK_KILL_SWITCH_PCT", "年度利润回吐熔断阈值", "PROFIT_GIVEBACK_PERCENT", 40, "VIOLATION"],
] as const;

const strategySeeds = [
  {
    code: "BUY_AND_HOLD_AAPL",
    name: "AAPL 买入并持有",
    description: "在首个交易日收盘生成信号，下一交易日开盘买入并持有，作为基准策略。",
    strategyType: "BuyAndHold",
    parameters: { positionPercent: 95 },
    symbols: ["AAPL"],
    enabled: true,
    maxPositionPercent: 95,
    approvalStatus: "BACKTESTED",
  },
  {
    code: "MA_CROSS_20_60_AAPL",
    name: "AAPL 20/60 日均线交叉",
    description: "已退役：长期 QQQ 对照未证明有效；仅保留历史回测复现。",
    strategyType: "MovingAverageCross",
    parameters: { longPeriod: 60, positionPercent: 95, shortPeriod: 20 },
    symbols: ["AAPL"],
    enabled: false,
    maxPositionPercent: 95,
    approvalStatus: "REJECTED",
  },
  {
    code: "RSI_MEAN_REVERSION_AAPL",
    name: "AAPL RSI 均值回归",
    description: "已退役：长期 QQQ 对照未证明有效；仅保留历史回测复现。",
    strategyType: "RsiMeanReversion",
    parameters: { buyThreshold: 35, period: 14, positionPercent: 95, sellThreshold: 65 },
    symbols: ["AAPL"],
    enabled: false,
    maxPositionPercent: 95,
    approvalStatus: "REJECTED",
  },
  {
    code: "TSMOM_120_QQQ_RESEARCH",
    name: "QQQ 时间序列动量 120 日（已拒绝研究候选）",
    description:
      "独立适配自 MIT 许可的 bonnie-mcconnell/backtesting-engine 时间序列动量规则。QQQ 2006-08-21 至 2026-08-21 按 IBKR Pro 美国股票阶梯基础佣金和 0.05% 滑点重算：总收益 1235.31%，低于同费用口径 Buy & Hold 2073.17%；手续费 1339.49 美元，不含随路由变化的外部费用或返佣。保留审计记录但默认停用。来源：https://github.com/bonnie-mcconnell/backtesting-engine",
    strategyType: "TimeSeriesMomentum",
    parameters: {
      lookbackDays: 120,
      positionPercent: 100,
      stopLossCondition: "120 日收益由正转为非正",
      exitCondition: "时间序列动量状态退出",
    },
    symbols: ["QQQ"],
    enabled: false,
    maxPositionPercent: 100,
    approvalStatus: "REJECTED",
  },
  {
    code: "FLC_GUARD_QQQM",
    name: "QQQM 基本面·流动性·拥挤三层防线",
    description:
      "三层框架真实证据模式：SEC 财报、IBKR 盘口、FRED 融资条件和 FINRA/交易所空头持仓必须全部已核验且未过期；缺失数据时禁止开仓，不用模拟值代替。",
    strategyType: "FundamentalLiquidityCrowding",
    parameters: {
      trendPeriod: 120,
      trendSlopeLookback: 20,
      liquidityPeriod: 20,
      minimumDollarVolumeRatio: 0.5,
      maximumIlliquidityMultiple: 3,
      crowdingPeriod: 20,
      maximumCrowdingZScore: 2.5,
      crowdingVolumeMultiple: 1.5,
      dataMode: "REQUIRE_VERIFIED_REAL",
      minimumFundamentalGrowthScore: 0,
      minimumOrderBookImbalance: -0.35,
      maximumFinancialConditionsZ: 1,
      maximumShortInterestPercent: 30,
      maximumDaysToCover: 7,
      fundamentalMaxAgeDays: 140,
      orderBookMaxAgeDays: 1,
      financingMaxAgeDays: 30,
      shortInterestMaxAgeDays: 30,
      positionPercent: 70,
      stopLossCondition: "任一真实证据过期、缺失或越过风险阈值",
      exitCondition: "基本面、盘口、融资条件或空头拥挤任一层失效",
    },
    symbols: ["QQQM"],
    enabled: true,
    maxPositionPercent: 95,
    approvalStatus: "BACKTESTED",
  },
  {
    code: "MULTI_HORIZON_TREND_QQQ_RESEARCH",
    name: "QQQ 多周期趋势组合（已拒绝研究候选）",
    description:
      "已拒绝研究候选：综合约 1、3、6、12 个月趋势，每月只使用当日收盘及此前行情形成目标，下一共同交易日开盘执行。QQQ 2006-08-21 至 2026-08-21 按 IBKR 基础佣金和 0.05% 滑点回测收益 688.73%，低于同口径 Buy & Hold 2073.17%；2023-01-03 至 2026-08-21 留出段收益 86.34%，低于 Buy & Hold 172.67%。方法依据：https://fairmodel.econ.yale.edu/ec439/mosk.pdf",
    strategyType: "MultiHorizonTrend",
    parameters: {
      symbol: "QQQ",
      lookbackDays: [21, 63, 126, 252],
      minimumPositiveHorizons: 3,
      positionPercent: 100,
      stopLossCondition: "至少三个趋势周期不再同时为正",
      exitCondition: "月度复核时多周期正向票数低于三",
    },
    symbols: ["QQQ"],
    enabled: false,
    maxPositionPercent: 100,
    approvalStatus: "REJECTED",
  },
  {
    code: "DUAL_MOMENTUM_MULTI_ASSET_RESEARCH",
    name: "多资产双动量轮动（已拒绝研究候选）",
    description:
      "已拒绝研究候选：每月比较 252 个共同交易日的相对动量，并以 SHY 同期回报作为防御门槛；只在下一共同交易日开盘执行。2006-08-21 至 2026-08-21 收益 360.27%，低于同口径 QQQ Buy & Hold 2073.17%；留出段收益 123.06%，低于 Buy & Hold 172.67%。方法依据：https://papers.ssrn.com/sol3/Papers.cfm?abstract_id=2042750",
    strategyType: "DualMomentumRotation",
    parameters: {
      riskAssets: ["QQQ", "SPY", "IWM", "EFA", "TLT", "GLD"],
      defensiveAsset: "SHY",
      benchmarkSymbol: "QQQ",
      lookbackDays: 252,
      positionPercent: 100,
      stopLossCondition: "月度相对排名或防御门槛发生变化",
      exitCondition: "下一月度复核切换至新的领先资产或 SHY",
    },
    symbols: ["QQQ", "SPY", "IWM", "EFA", "TLT", "GLD", "SHY"],
    enabled: false,
    maxPositionPercent: 100,
    approvalStatus: "REJECTED",
  },
  {
    code: "CORE_SATELLITE_MOMENTUM_QQQ_RESEARCH",
    name: "QQQ 核心＋动量卫星（已拒绝研究候选）",
    description:
      "已拒绝研究候选：保留 QQQ 核心敞口，卫星部分每月在跨资产领先者与 SHY 防御资产之间轮动；下一共同交易日开盘执行。2006-08-21 至 2026-08-21 收益 1252.17%，低于同口径 QQQ Buy & Hold 2073.17%；留出段收益 154.36%，仍低于 Buy & Hold 172.67%。虽然留出段最大回撤和 Sharpe 较好，但不满足本轮提高绝对收益的目标。",
    strategyType: "CoreSatelliteMomentum",
    parameters: {
      coreSymbol: "QQQ",
      corePercent: 70,
      satelliteAssets: ["SPY", "IWM", "EFA", "TLT", "GLD"],
      defensiveAsset: "SHY",
      benchmarkSymbol: "QQQ",
      lookbackDays: 252,
      positionPercent: 100,
      stopLossCondition: "月度卫星相对排名或防御门槛发生变化",
      exitCondition: "核心保持，卫星在下一月度复核时再平衡",
    },
    symbols: ["QQQ", "SPY", "IWM", "EFA", "TLT", "GLD", "SHY"],
    enabled: false,
    maxPositionPercent: 100,
    approvalStatus: "REJECTED",
  },
  {
    code: "BUY_AND_HOLD_QQQM",
    name: "QQQM 买入并持有",
    description: "使用 QQQM 合成 SYNTHETIC 日线验证的组合基准成员；只用于模拟组合。",
    strategyType: "BuyAndHold",
    parameters: { positionPercent: 30 },
    symbols: ["QQQM"],
    enabled: true,
    maxPositionPercent: 95,
    approvalStatus: "BACKTESTED",
  },
  {
    code: "BUY_AND_HOLD_DLA2",
    name: "DLA2 买入并持有（组合风控验收）",
    description: "使用 DLA2 合成 SYNTHETIC 日线验证；组合层仍受 10% 杠杆 ETF 总暴露限制。",
    strategyType: "BuyAndHold",
    parameters: { positionPercent: 10 },
    symbols: ["DLA2"],
    enabled: true,
    maxPositionPercent: 95,
    approvalStatus: "BACKTESTED",
  },
] as const;

const marketResearchSeeds = [
  {
    externalId: "OGxUTvU_St0",
    title: "全网喊泡沫时更像庞氏漏斗：纳指 36500 天花板、6.28 倍杠杆、63% 0DTE 与巴菲特指标",
    url: "https://www.youtube.com/watch?v=OGxUTvU_St0",
    publishedAt: "2026-05-15T01:10:02.000Z",
    durationSeconds: 1421,
    notes: "YouTube 无可用字幕轨；依据烧录中文字幕、标题和关键时间点人工复核。",
    factors: [
      {
        code: "LEVERAGE_RATIO",
        category: "LEVERAGE",
        label: "市场杠杆倍数",
        value: 6.28,
        unit: "X",
        direction: "CONDITIONAL",
        directionScore: 25,
        tailRiskScore: 90,
        confidence: 55,
        horizonDays: 60,
        sourceTimestampSeconds: 125,
        asOfDate: "2026-05-14",
        freshness: "HISTORICAL",
        verificationStatus: "UNVERIFIED",
        includeInAssessment: true,
        evidenceSummary: "视频以 6.28 倍杠杆描述流动性放大与去杠杆风险。",
        officialSourceUrl: null,
        notes: "尚未确认作者采用的精确分子、分母及数据发布日期。",
      },
      {
        code: "SPX_0DTE_SHARE",
        category: "DERIVATIVES",
        label: "标普 500 期权 0DTE 占比",
        value: 63,
        unit: "PERCENT",
        direction: "CONDITIONAL",
        directionScore: 10,
        tailRiskScore: 85,
        confidence: 90,
        horizonDays: 20,
        sourceTimestampSeconds: 142,
        asOfDate: "2026-02-28",
        freshness: "STALE",
        verificationStatus: "VERIFIED",
        includeInAssessment: true,
        evidenceSummary: "视频引用 63%；Cboe 2026 年 2 月月报确认当月 SPX 0DTE 占比创 63% 纪录。",
        officialSourceUrl:
          "https://ir.cboe.com/news/news-details/2026/Cboe-Global-Markets-Reports-Trading-Volume-for-February-2026/default.aspx",
        notes: "这是 2 月记录，不代表视频发布日期或当前日期的即时读数。",
      },
      {
        code: "BUFFETT_INDICATOR",
        category: "VALUATION",
        label: "巴菲特指标",
        value: 225.9,
        unit: "PERCENT",
        direction: "BEARISH",
        directionScore: -40,
        tailRiskScore: 85,
        confidence: 60,
        horizonDays: 120,
        sourceTimestampSeconds: 165,
        asOfDate: "2026-05-14",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: true,
        evidenceSummary: "视频将总市值/GDP 约 225.9% 作为高估值与尾部风险证据。",
        officialSourceUrl: null,
        notes: "不同口径会产生显著差异，尚未复原作者计算表。",
      },
      {
        code: "NDX_CEILING_FORECAST",
        category: "CREATOR_SCENARIO",
        label: "作者给出的纳指上行情景上限",
        value: 36500,
        unit: "POINTS",
        direction: "BULLISH",
        directionScore: 45,
        tailRiskScore: 70,
        confidence: 47.3,
        horizonDays: 120,
        sourceTimestampSeconds: 90,
        asOfDate: "2026-05-14",
        freshness: "HISTORICAL",
        verificationStatus: "UNVERIFIED",
        includeInAssessment: false,
        evidenceSummary: "36500 是作者的情景天花板，不是官方数据或系统目标价。",
        officialSourceUrl: null,
        notes: "为避免循环论证，该预测值不参与本版市场状态聚合。",
      },
      {
        code: "AUGUST_PEAK_PROBABILITY",
        category: "CREATOR_SCENARIO",
        label: "作者给出的 8 月见顶概率",
        value: 47.3,
        unit: "PERCENT",
        direction: "BEARISH",
        directionScore: -20,
        tailRiskScore: 75,
        confidence: 47.3,
        horizonDays: 90,
        sourceTimestampSeconds: 1320,
        asOfDate: "2026-05-14",
        freshness: "HISTORICAL",
        verificationStatus: "UNVERIFIED",
        includeInAssessment: false,
        evidenceSummary: "47.3% 是视频中的作者判断，当前无法复原训练样本和校准过程。",
        officialSourceUrl: null,
        notes: "仅保留为后续到期标签，不作为平台概率输出。",
      },
    ],
  },
  {
    externalId: "MrnjBdgQPLU",
    title: "AI 泡沫洗盘与第二波窗口：融资余额、0DTE、集中度、M2 缺口和纳指趋势",
    url: "https://www.youtube.com/watch?v=MrnjBdgQPLU",
    publishedAt: "2026-08-10T00:09:50.000Z",
    durationSeconds: 1666,
    notes: "YouTube 无可用字幕轨；依据烧录中文字幕、图表、标题和关键时间点人工复核。",
    factors: [
      {
        code: "MARGIN_DEBT_MOM",
        category: "LEVERAGE",
        label: "FINRA 融资余额月环比",
        value: 8.53,
        unit: "PERCENT",
        direction: "CONDITIONAL",
        directionScore: 35,
        tailRiskScore: 85,
        confidence: 95,
        horizonDays: 20,
        sourceTimestampSeconds: 1260,
        asOfDate: "2026-05-31",
        freshness: "LAGGED",
        verificationStatus: "VERIFIED",
        includeInAssessment: true,
        evidenceSummary:
          "视频称融资余额约 1.416 万亿美元、环比 +8.5%；FINRA 2026 年 5 月数据为 1.415557 万亿美元，环比约 +8.53%。",
        officialSourceUrl:
          "https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics",
        notes: "该数值对应 5 月而非 8 月即时状态；6 月、7 月已有后续数据。",
      },
      {
        code: "SPX_0DTE_SHARE",
        category: "DERIVATIVES",
        label: "标普 500 期权 0DTE 占比",
        value: 63,
        unit: "PERCENT",
        direction: "CONDITIONAL",
        directionScore: 10,
        tailRiskScore: 85,
        confidence: 90,
        horizonDays: 20,
        sourceTimestampSeconds: 1290,
        asOfDate: "2026-02-28",
        freshness: "STALE",
        verificationStatus: "VERIFIED",
        includeInAssessment: true,
        evidenceSummary: "63% 可由 Cboe 2026 年 2 月记录核验，但并非视频发布时的当前读数。",
        officialSourceUrl:
          "https://ir.cboe.com/news/news-details/2026/Cboe-Global-Markets-Reports-Trading-Volume-for-February-2026/default.aspx",
        notes: "Cboe 后续公开材料的读数已不同，聚合时按陈旧数据降权。",
      },
      {
        code: "BUFFETT_INDICATOR",
        category: "VALUATION",
        label: "巴菲特指标",
        value: 234,
        unit: "PERCENT",
        direction: "BEARISH",
        directionScore: -40,
        tailRiskScore: 90,
        confidence: 55,
        horizonDays: 120,
        sourceTimestampSeconds: 1320,
        asOfDate: "2026-08-09",
        freshness: "CURRENT",
        verificationStatus: "PARTIAL",
        includeInAssessment: true,
        evidenceSummary: "视频以约 234% 的总市值/GDP 比率说明估值和拥挤风险。",
        officialSourceUrl: null,
        notes: "作者口径未完整披露，不能视为官方当前值。",
      },
      {
        code: "TOP10_CONCENTRATION",
        category: "CONCENTRATION",
        label: "头部十家公司市值集中度",
        value: 39.3,
        unit: "PERCENT",
        direction: "CONDITIONAL",
        directionScore: 15,
        tailRiskScore: 80,
        confidence: 55,
        horizonDays: 60,
        sourceTimestampSeconds: 1350,
        asOfDate: "2026-08-09",
        freshness: "CURRENT",
        verificationStatus: "PARTIAL",
        includeInAssessment: true,
        evidenceSummary: "视频图表给出头部十家公司约 39.3% 的集中度。",
        officialSourceUrl: null,
        notes: "待确认指数范围、自由流通调整和成分股时点。",
      },
      {
        code: "M2_NDX_GAP",
        category: "LIQUIDITY",
        label: "M2 增速与纳指涨幅缺口",
        value: -24.1,
        unit: "PERCENTAGE_POINTS",
        direction: "BEARISH",
        directionScore: -25,
        tailRiskScore: 80,
        confidence: 45,
        horizonDays: 60,
        sourceTimestampSeconds: 1380,
        asOfDate: "2026-06-30",
        freshness: "LAGGED",
        verificationStatus: "PARTIAL",
        includeInAssessment: true,
        evidenceSummary:
          "视频给出 M2 与 NDX 表现缺口约 -24.1 个百分点；FRED 可核验 M2 水平，但差值计算口径未完整披露。",
        officialSourceUrl: "https://fred.stlouisfed.org/series/M2SL",
        notes: "FRED 2026 年 6 月 M2 为 23.1552 万亿美元；仍需复原比较基期。",
      },
      {
        code: "FORWARD_PE",
        category: "VALUATION",
        label: "预期市盈率",
        value: 24.96,
        unit: "X",
        direction: "BEARISH",
        directionScore: -10,
        tailRiskScore: 55,
        confidence: 40,
        horizonDays: 60,
        sourceTimestampSeconds: 1410,
        asOfDate: "2026-08-09",
        freshness: "CURRENT",
        verificationStatus: "UNVERIFIED",
        includeInAssessment: true,
        evidenceSummary: "视频将约 24.96 倍预期市盈率列为尚未触发极值阈值的估值观察项。",
        officialSourceUrl: null,
        notes: "待确认对应指数、盈利预测来源和阈值。",
      },
      {
        code: "DEALER_GAMMA_STATE",
        category: "DERIVATIVES",
        label: "做市商 Gamma 反馈状态",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 30,
        tailRiskScore: 75,
        confidence: 50,
        horizonDays: 10,
        sourceTimestampSeconds: 990,
        asOfDate: "2026-08-09",
        freshness: "CURRENT",
        verificationStatus: "PARTIAL",
        includeInAssessment: true,
        evidenceSummary: "视频描述看涨期权买入、做市商对冲买盘与价格上涨之间的正反馈。",
        officialSourceUrl: null,
        notes: "当前只有机制描述，没有可复算的净 Gamma 暴露序列。",
      },
      {
        code: "NDX_TREND_RECLAIM",
        category: "TECHNICAL",
        label: "纳指趋势修复",
        value: 1,
        unit: "BOOLEAN",
        direction: "BULLISH",
        directionScore: 60,
        tailRiskScore: 40,
        confidence: 70,
        horizonDays: 20,
        sourceTimestampSeconds: 480,
        asOfDate: "2026-07-31",
        freshness: "CURRENT",
        verificationStatus: "PARTIAL",
        includeInAssessment: true,
        evidenceSummary: "视频判断 NDX 已重新站回主要趋势；Nasdaq 官方历史页可用于复算价格序列。",
        officialSourceUrl: "https://indexes.nasdaq.com/Index/History/NDX",
        notes: "趋势算法参数尚未由作者披露，因此只做部分核验。",
      },
      {
        code: "NDX_SECOND_WAVE_ZONE",
        category: "CREATOR_SCENARIO",
        label: "作者给出的第二波观察区间",
        value: 26700,
        unit: "POINTS_FLOOR",
        direction: "BULLISH",
        directionScore: 35,
        tailRiskScore: 65,
        confidence: 50,
        horizonDays: 30,
        sourceTimestampSeconds: 720,
        asOfDate: "2026-08-09",
        freshness: "CURRENT",
        verificationStatus: "UNVERIFIED",
        includeInAssessment: false,
        evidenceSummary: "视频把约 26700—28200 点描述为第二波行情观察区间。",
        officialSourceUrl: null,
        notes: "属于作者情景值，不参与本版状态聚合。",
      },
    ],
  },
  {
    externalId: "Mtbfh5XA6D0",
    title: "基本面管方向、流动性管路径、拥挤管断裂：英国国债、Meta 与 GameStop 三层失控案例",
    url: "https://www.youtube.com/watch?v=Mtbfh5XA6D0",
    publishedAt: "2026-08-09T00:00:00.000Z",
    durationSeconds: 1022,
    notes:
      "YouTube 无可用字幕轨；依据烧录中文字幕、标题和 1:02、1:43、5:07、13:22、15:01 等关键画面人工复核。视频提供的是风险框架而非完整参数策略；平台阈值为明确标注的工程代理参数。",
    factors: [
      {
        code: "THREE_LAYER_DIRECTION",
        category: "FRAMEWORK",
        label: "基本面决定方向",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 50,
        confidence: 95,
        horizonDays: 120,
        sourceTimestampSeconds: 62,
        asOfDate: "2026-08-09",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: false,
        evidenceSummary: "视频将基本面定义为决定中长期方向的第一层，而非短线成交路径。",
        officialSourceUrl: null,
        notes: "当前 OHLCV 数据只能使用长期趋势代理，不能替代财报与经营数据。",
      },
      {
        code: "THREE_LAYER_LIQUIDITY",
        category: "LIQUIDITY",
        label: "流动性决定路径粗糙度",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 80,
        confidence: 95,
        horizonDays: 20,
        sourceTimestampSeconds: 103,
        asOfDate: "2026-08-09",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: false,
        evidenceSummary:
          "视频把流动性路径称为价格运行的粗糙程度，并以保证金链和去杠杆说明冲击放大。",
        officialSourceUrl: null,
        notes: "平台使用成交额比率和 Amihud 比率代理；没有订单簿深度与融资条款数据。",
      },
      {
        code: "THREE_LAYER_CROWDING",
        category: "CROWDING",
        label: "拥挤决定断裂",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 90,
        confidence: 95,
        horizonDays: 10,
        sourceTimestampSeconds: 900,
        asOfDate: "2026-08-09",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: false,
        evidenceSummary: "视频用 GameStop 2021 空头拥挤向上断裂说明同向头寸会放大价格跳跃。",
        officialSourceUrl: null,
        notes: "平台使用价格 Z 分数叠加量能代理；没有借券费率与空头持仓序列。",
      },
      {
        code: "GME_2021_SQUEEZE_MOVE",
        category: "CROWDING",
        label: "GameStop 2021 年 1 月拥挤行情",
        value: 2700,
        unit: "PERCENT_APPROX",
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 95,
        confidence: 90,
        horizonDays: 20,
        sourceTimestampSeconds: 802,
        asOfDate: "2021-01-28",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: false,
        evidenceSummary:
          "视频画面给出 2021 年 1 月 8 日至 28 日约 +2700%，用于说明拥挤层可暂时压过基本面层。",
        officialSourceUrl: null,
        notes: "历史案例仅用于验证机制，不作为当前市场预测因子。",
      },
    ],
  },
  {
    externalId: "TUt6ZwOoP7M",
    title: "量化不是算命：正期望、多因子、反穿越、协整配对、Z 分数与交易成本",
    url: "https://www.youtube.com/watch?v=TUt6ZwOoP7M",
    publishedAt: "2026-07-31T00:00:00.000Z",
    durationSeconds: 1056,
    notes:
      "YouTube 无可导出的字幕轨；依据烧录中文字幕、标题和 2:57、4:43、5:58、7:34、8:05、8:48、11:24、12:41、13:46、14:27、15:51、16:46 等关键画面人工复核。发布日期可确认到 2026-07-31，精确发布时间未确认。视频讲方法论而非可直接执行的完整策略。",
    factors: [
      {
        code: "POSITIVE_EXPECTANCY_EXAMPLE",
        category: "QUANT_METHOD",
        label: "胜率、赔率与单笔期望值",
        value: 0.122,
        unit: "CURRENCY_PER_TRIAL",
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 35,
        confidence: 100,
        horizonDays: null,
        sourceTimestampSeconds: 177,
        asOfDate: "2026-07-31",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: false,
        evidenceSummary:
          "视频用胜率 51%、盈利 1.20、亏损 1.00 的示例说明单次期望值为 0.51×1.20−0.49×1.00=0.122；优势来自可重复的正期望，不来自单次必胜。",
        officialSourceUrl: null,
        notes:
          "这是数学示例，不是任何现有策略的已实现胜率。系统已将扣费后的样本外净单笔期望值加入审批门槛。",
      },
      {
        code: "DYNAMIC_MULTI_FACTOR_STACK",
        category: "QUANT_METHOD",
        label: "价值、波动率与动量的动态权重",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 55,
        confidence: 95,
        horizonDays: null,
        sourceTimestampSeconds: 358,
        asOfDate: "2026-07-31",
        freshness: "HISTORICAL",
        verificationStatus: "UNVERIFIED",
        includeInAssessment: false,
        evidenceSummary:
          "视频明确展示 Value、Volatility、Momentum 三类因子，并强调环境变化后重新计算权重。",
        officialSourceUrl: null,
        notes: "作者未披露因子定义、标准化方式、权重优化目标和再平衡频率，因此不生成策略参数。",
      },
      {
        code: "BACKTEST_DATA_INTEGRITY",
        category: "MODEL_RISK",
        label: "回测反幸存者偏差与反未来穿越",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 100,
        confidence: 100,
        horizonDays: null,
        sourceTimestampSeconds: 528,
        asOfDate: "2026-07-31",
        freshness: "HISTORICAL",
        verificationStatus: "VERIFIED",
        includeInAssessment: false,
        evidenceSummary:
          "视频指出仅保留存续公司会造成幸存者偏差，把 3 月披露数据放入 1 月回测会造成未来信息泄漏。",
        officialSourceUrl: "https://www.federalreserve.gov/boarddocs/srletters/2011/sr1107a1.pdf",
        notes:
          "系统已有时间顺序切分、下一交易日成交、Walk-forward 和 evidence.availableAt 约束；本次继续保留为强制方法规则。",
      },
      {
        code: "COINTEGRATION_HEDGE_RATIO",
        category: "PAIR_TRADING",
        label: "协整检验与对冲比",
        value: 1.3,
        unit: "HEDGE_RATIO_EXAMPLE",
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 85,
        confidence: 90,
        horizonDays: null,
        sourceTimestampSeconds: 684,
        asOfDate: "2026-07-31",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: false,
        evidenceSummary:
          "视频要求先验证两条价格序列的协整关系，再用线性回归估计对冲比；画面示例为 1 股百事对 1.3 股可口可乐。",
        officialSourceUrl: "https://doi.org/10.2307/1913236",
        notes:
          "1:1.3 仅为视频示例。当前单标的回测接口缺少第二腿、借券成本和同步成交模型，不接入交易信号。",
      },
      {
        code: "PAIR_SPREAD_Z_SCORE",
        category: "STANDARDIZATION",
        label: "配对价差 Z 分数",
        value: null,
        unit: "Z_SCORE",
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 75,
        confidence: 95,
        horizonDays: null,
        sourceTimestampSeconds: 761,
        asOfDate: "2026-07-31",
        freshness: "HISTORICAL",
        verificationStatus: "VERIFIED",
        includeInAssessment: false,
        evidenceSummary:
          "视频用（当前价差−历史均值）/历史标准差，把不同波动尺度的配对价差转成统一的 Z 分数。",
        officialSourceUrl: "https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm",
        notes: "作者没有给出滚动窗口、开仓 Z 阈值、平仓阈值和结构失效条件，系统不猜测这些参数。",
      },
      {
        code: "STREAMING_FACTOR_RECOMPUTE",
        category: "DATA_PIPELINE",
        label: "流式行情驱动重新计算",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 70,
        confidence: 90,
        horizonDays: null,
        sourceTimestampSeconds: 826,
        asOfDate: "2026-07-31",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: false,
        evidenceSummary:
          "视频强调价格与订单簿是持续更新的数据流，因子状态应按新信息重新计算，而不是把静态名称当作信号。",
        officialSourceUrl: "https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/",
        notes:
          "IBKR 官方接口支持 top-of-book 流。当前 connector 未在线且缺少行情订阅时，系统必须保持 OFFLINE，不回退到伪实时数据。",
      },
      {
        code: "HFT_LATENCY_BOUNDARY",
        category: "EXECUTION",
        label: "低延迟执行边界",
        value: 0.01,
        unit: "SECONDS_EXAMPLE",
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 95,
        confidence: 45,
        horizonDays: null,
        sourceTimestampSeconds: 867,
        asOfDate: "2026-07-31",
        freshness: "HISTORICAL",
        verificationStatus: "UNVERIFIED",
        includeInAssessment: false,
        evidenceSummary:
          "视频用人工约 3 秒、算法约 0.01 秒的画面示例说明短周期优势可能取决于谁先到达市场。",
        officialSourceUrl: null,
        notes:
          "数值是视频演示，未披露测量口径。本项目是风险与模拟交易平台，不具备共址、FIX 直连或高频撮合能力。",
      },
      {
        code: "BID_ASK_SPREAD_COST",
        category: "EXECUTION",
        label: "买卖价差与立即成交成本",
        value: 0.01,
        unit: "CURRENCY_EXAMPLE",
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 90,
        confidence: 90,
        horizonDays: null,
        sourceTimestampSeconds: 951,
        asOfDate: "2026-07-31",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: false,
        evidenceSummary:
          "视频用 10.00 与 10.01 的报价示例说明，为立即成交支付的价差会吞噬策略优势。",
        officialSourceUrl: "https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/",
        notes:
          "现有回测以 slippageRate 作为工程代理，并新增 5 倍滑点压力场景；真实价差仍需 IBKR bid/ask 历史或流式数据。",
      },
      {
        code: "EXPLAINABLE_QUANT_LOGIC",
        category: "MODEL_GOVERNANCE",
        label: "可解释的策略逻辑",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 80,
        confidence: 95,
        horizonDays: null,
        sourceTimestampSeconds: 1006,
        asOfDate: "2026-07-31",
        freshness: "HISTORICAL",
        verificationStatus: "VERIFIED",
        includeInAssessment: false,
        evidenceSummary:
          "视频结论是算法只是把人类逻辑写成数学并接入数据，关键是稳定、可解释、可验证的底层因果假设。",
        officialSourceUrl: "https://www.federalreserve.gov/boarddocs/srletters/2011/sr1107a1.pdf",
        notes:
          "系统继续保存参数快照、代码版本、输入来源、警告、审批条件和人工决定，不允许视频观点直接触发下单。",
      },
    ],
  },
  {
    externalId: "6V5dlBcfCnY",
    title: "止损簇与显示流动性：盘口挂单不等于可成交流动性",
    url: "https://www.youtube.com/watch?v=6V5dlBcfCnY",
    publishedAt: "2026-07-29T00:31:41.000Z",
    durationSeconds: 1004,
    notes:
      "标题、烧录字幕和页面元数据已人工复核。视频标题中的 3%、1% 和 2% 未找到可复算口径，因此不入库为数值因子；只保留可由 SEC 执法案例核验的微观结构风险。",
    factors: [
      {
        code: "DISPLAYED_LIQUIDITY_EXECUTION_GAP",
        category: "MARKET_MICROSTRUCTURE",
        label: "显示流动性不等于可执行流动性",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 90,
        confidence: 90,
        horizonDays: null,
        sourceTimestampSeconds: 0,
        asOfDate: "2026-07-28",
        freshness: "HISTORICAL",
        verificationStatus: "VERIFIED",
        includeInAssessment: false,
        evidenceSummary:
          "视频把止损簇和可撤挂单视为执行风险；SEC 的 spoofing 执法材料确认，无真实成交意图的订单可制造虚假供需并在真实订单成交后撤销。",
        officialSourceUrl: "https://www.sec.gov/newsroom/press-releases/2024-160",
        notes:
          "当前系统只有 OHLCV 和 top-of-book 接口，没有历史逐笔新增、修改、撤单事件，不能实现幌骗检测或据此生成信号。",
      },
    ],
  },
  {
    externalId: "IpFEs8pqvoo",
    title: "不猜方向、改测脆弱度：高压状态的左尾分布与三类触发条件",
    url: "https://www.youtube.com/watch?v=IpFEs8pqvoo",
    publishedAt: "2026-06-19T01:00:59.000Z",
    durationSeconds: 1062,
    notes:
      "YouTube 无可导出字幕轨；依据标题、烧录中文字幕及 8:50、12:23、15:55 等关键画面人工复核。系统只落地分布型风险度量，不把脆弱度误写成方向预测。",
    factors: [
      {
        code: "TAIL_RISK_NOT_DIRECTION",
        category: "MODEL_RISK",
        label: "尾部脆弱度不等于方向预测",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 100,
        confidence: 100,
        horizonDays: null,
        sourceTimestampSeconds: 530,
        asOfDate: "2024-02-05",
        freshness: "HISTORICAL",
        verificationStatus: "VERIFIED",
        includeInAssessment: false,
        evidenceSummary:
          "视频展示高压样本的左尾更厚，并强调“变脆”不等于“必跌”。Basel 市场风险术语把 Expected Shortfall 定义为超过 VaR 后潜在损失的平均值。",
        officialSourceUrl:
          "https://www.bis.org/basel_framework/chapter/MAR/10.htm?inforce=20230101&published=20200327&tldate=20500705",
        notes:
          "量化引擎新增历史 95% VaR、95% Expected Shortfall 和最差单日收益，只用于描述已观察样本的左尾，不输出未来概率。",
      },
      {
        code: "HIGH_PRESSURE_LEFT_TAIL_EXAMPLE",
        category: "CREATOR_EXAMPLE",
        label: "作者高压样本 5% 分位示例",
        value: -8.4,
        unit: "PERCENT",
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 95,
        confidence: 45,
        horizonDays: null,
        sourceTimestampSeconds: 530,
        asOfDate: "2024-02-05",
        freshness: "HISTORICAL",
        verificationStatus: "UNVERIFIED",
        includeInAssessment: false,
        evidenceSummary: "视频图表标注高压样本的 5% 分位为 -8.4%。",
        officialSourceUrl: null,
        notes:
          "作者没有披露样本区间、资产集合、压力指数构造和复算数据；数值仅存证，不参与系统阈值或聚合。",
      },
      {
        code: "PRESSURE_THREE_INPUT_FRAMEWORK",
        category: "LIQUIDITY",
        label: "银行流动性、短端利率与波动率联合触发",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 90,
        confidence: 75,
        horizonDays: null,
        sourceTimestampSeconds: 743,
        asOfDate: "2024-02-05",
        freshness: "HISTORICAL",
        verificationStatus: "PARTIAL",
        includeInAssessment: false,
        evidenceSummary:
          "视频把银行流动性、短端利率、波动率列为压力翻升的三类输入，并提示观察多个因子同时进入高分位。",
        officialSourceUrl: null,
        notes:
          "画面未披露具体序列、窗口和分位阈值，系统不猜测 2-of-3 的工程参数；待数据定义确认后再进入验证。",
      },
    ],
  },
  {
    externalId: "QggkUtXNkPo",
    title: "市场操纵雷达：幌骗订单、撤单事件与可执行流动性",
    url: "https://www.youtube.com/watch?v=QggkUtXNkPo",
    publishedAt: "2026-06-10T01:39:47.000Z",
    durationSeconds: 1085,
    notes:
      "YouTube 无可导出字幕轨；依据标题、页面标签及 7:13 等烧录字幕画面人工复核。视频声称的八项雷达和三十五个阈值未完整披露，不复制不可审计阈值。",
    factors: [
      {
        code: "SPOOFING_CANCEL_EVENT_RISK",
        category: "MARKET_MICROSTRUCTURE",
        label: "幌骗订单与撤单事件风险",
        value: null,
        unit: null,
        direction: "CONDITIONAL",
        directionScore: 0,
        tailRiskScore: 95,
        confidence: 95,
        horizonDays: null,
        sourceTimestampSeconds: 433,
        asOfDate: "2026-06-09",
        freshness: "HISTORICAL",
        verificationStatus: "VERIFIED",
        includeInAssessment: false,
        evidenceSummary:
          "视频以幌骗和闪崩说明显示盘口可能被非真实订单扭曲；SEC 将 spoofing 描述为在一侧放置无意成交订单、借此改善另一侧真实订单成交，再撤销虚假订单。",
        officialSourceUrl: "https://www.sec.gov/newsroom/press-releases/2024-160",
        notes:
          "幌骗是意图型违法行为，不能仅凭高撤单率自动认定。当前项目缺少 MBO/逐笔订单生命周期数据，因此只归档风险，不生成告警或交易信号。",
      },
    ],
  },
] as const;

const marketResearchReviewedArchiveSeeds = [
  [
    "EfAxMEgi14w",
    "负 Gamma 与流动性级联",
    "2026-06-08T01:10:03.000Z",
    977,
    "复核分类：可核验的定性机制。实际播放并检查烧录字幕；关键画面 0:59、7:01、11:02、15:01。作者未公开可复算的头寸、窗口或阈值，系统只归档负 Gamma 对冲反馈，不复制案例数值。",
  ],
  [
    "gZvL7b3WhHU",
    "量化 NLP 叙事流水线",
    "2026-05-28T01:00:31.000Z",
    1013,
    "复核分类：仅有方法描述。实际播放并检查烧录字幕；视频展示叙事/NLP 流水线，但未公开语料、标签、权重、验证集或阈值，因此不生成因子。",
  ],
  [
    "TWokF_gzpX0",
    "NQ 高频订单流与顶部换手",
    "2026-05-10T04:00:29.000Z",
    1001,
    "复核分类：可核验的数据要求。实际播放并检查烧录字幕；关键画面约 1:01。所述逐笔新增、修改、撤单和队列优先级需要 MBO 订单生命周期数据；项目只有 OHLCV/top-of-book，不实现伪造检测。",
  ],
  [
    "ADhiNdyCQB8",
    "HFT、CTA 拥挤与流动性级联",
    "2026-05-09T00:50:58.000Z",
    972,
    "复核分类：作者案例与预测。实际播放并检查烧录字幕；3–5 倍及情景概率缺少可复算输入、样本和验证，未写入因子、阈值或信号。",
  ],
  [
    "mbboVQ8NoWc",
    "正态分布、订单簿与交易复盘",
    "2025-06-20T03:10:32.000Z",
    846,
    "复核分类：可核验的模型风险。实际播放并检查烧录字幕；关键画面约 3:01。视频未公开分布检验、样本窗口或阈值，仅归档正态假设可能低估厚尾风险。",
  ],
  [
    "gSIbRp7B-Ak",
    "指标失效、假突破与做市决策",
    "2025-06-13T04:38:20.000Z",
    924,
    "复核分类：作者经验法则。实际播放并检查烧录字幕；70% 与三分之一等说法没有公开样本、定义和样本外验证，不生成参数或因子。",
  ],
  [
    "fle-cB5TgmA",
    "主动/被动订单与连续价格形成",
    "2025-05-23T01:31:49.000Z",
    846,
    "复核分类：仅有方法描述。实际播放并检查烧录字幕；主动/被动订单和价格形成概念未给出可复算参数，且逐笔队列分析存在 MBO 数据缺口，因此不生成因子。",
  ],
  [
    "7U_hjr-dkwI",
    "金融指标分类与交易逻辑验证",
    "2025-01-17T07:05:52.000Z",
    582,
    "复核分类：仅有方法描述。实际播放并检查烧录字幕；未公开可复现数据集、公式参数或样本外结果，因子保持为空。",
  ],
  [
    "bdBMTDxrqRg",
    "套利交易、日元融资与多腿执行风险",
    "2024-08-24T18:20:40.000Z",
    1437,
    "复核分类：可核验的定性机制。实际播放并检查烧录字幕；关键画面约 15:00 与 22:03。现金/期货基差和融资套利的案例没有完整参数，仅归档多腿融资、汇率与去杠杆风险。",
  ],
  [
    "BBeLGBchxxA",
    "代币化美股与国债的结算、净额和流动性风险",
    "2026-07-21T00:41:54.000Z",
    1025,
    "复核分类：可核验的市场基础设施机制。实际播放并检查烧录字幕；关键画面约 6:50 与 11:06。作者的收益倍数属于案例，不采用；只归档失去净额后的流动性需求。",
  ],
  [
    "-ygfl-fSZxQ",
    "傅里叶周期与政治事件交易案例",
    "2026-07-12T00:27:33.000Z",
    1110,
    "复核分类：作者案例。实际播放并检查烧录字幕；频谱方法未公开序列、采样频率、窗口、显著性检验和样本外结果，不生成周期参数或预测。",
  ],
  [
    "ZRpFikRXMsg",
    "异常期权活动与内幕交易监测案例",
    "2026-07-08T00:33:52.000Z",
    1187,
    "复核分类：作者案例。实际播放并检查烧录字幕；异常期权活动本身不能证明交易意图或违法行为，未公开可复算监测阈值，不生成操纵或内幕信号。",
  ],
  [
    "lxTdF1ASpjY",
    "黄金、实际利率与 Gamma 情景分析",
    "2026-07-05T00:14:16.000Z",
    1237,
    "复核分类：作者预测。实际播放并检查烧录字幕；价格目标、路径和概率缺少完整输入及样本外验证，全部仅归档，不生成参数、概率或订单。",
  ],
  [
    "oRCl5Vu4hxE",
    "零售交易生存、波动率缩放与止损风险",
    "2026-04-24T01:18:52.000Z",
    906,
    "复核分类：仅有方法描述。实际播放并检查烧录字幕；未公开可复算窗口和阈值，且内容与既有止损簇及执行风险来源重叠，不新增因子。",
  ],
  [
    "uizc4-CuZfY",
    "黄金实际收益率、CTA 与 TIPS 情景",
    "2026-03-31T00:44:32.000Z",
    1048,
    "复核分类：作者预测。实际播放并检查烧录字幕；标题和画面中的目标值、概率及仓位情景没有完整参数，不写入阈值或信号。",
  ],
  [
    "DxxZqC5lQ7Y",
    "战争情景、期权到期与 Gamma 滚动",
    "2026-03-20T02:47:55.000Z",
    922,
    "复核分类：作者案例与预测。实际播放并检查烧录字幕；未公开头寸分布、到期持仓和对冲参数，不生成方向预测或交易因子。",
  ],
  [
    "Hsu2iypV1gs",
    "对冲基金、Alpha 与 Beta 的历史方法",
    "2026-03-13T00:52:20.000Z",
    760,
    "复核分类：仅有方法描述。实际播放并检查烧录字幕；历史案例未提供可复算的现代数据口径或策略参数，因子保持为空。",
  ],
  [
    "XFbFnXkaHVA",
    "霍尔木兹、油价、通胀与纳指情景",
    "2026-03-11T00:40:02.000Z",
    905,
    "复核分类：作者预测。实际播放并检查烧录字幕；宏观路径、目标点位和概率没有可复算参数及发布时可得数据快照，不进入系统。",
  ],
  [
    "RyGAql0-hJc",
    "止损簇、流动性与市场操纵叙事",
    "2026-02-13T03:41:56.000Z",
    1016,
    "复核分类：方法描述与作者判断。实际播放并检查烧录字幕；高撤单率或价格形态不能证明操纵意图，项目也缺少 MBO 数据，不生成操纵告警或交易信号。",
  ],
  [
    "2CcfXU3sFSs",
    "做市商、冰山订单、CVD 与止损簇",
    "2026-02-12T02:26:06.000Z",
    919,
    "复核分类：仅有方法描述。实际播放并检查烧录字幕；冰山订单和逐笔撤改单识别需要 MBO 事件，视频未公开可审计阈值，因子保持为空。",
  ],
  [
    "kGCgiHXemp0",
    "黄金波动、CME 保证金与流动性风险",
    "2026-02-02T03:01:13.000Z",
    944,
    "复核分类：可核验的定性机制。实际播放并检查烧录字幕；关键画面约 5:50。保证金变化只归档为流动性需求，不被解释为方向或抄底信号。",
  ],
  [
    "mB9ljRAK7C0",
    "黄金白银、CME/LBMA 与 Gamma 情景",
    "2026-02-01T02:45:44.000Z",
    829,
    "复核分类：作者案例与预测。实际播放并检查烧录字幕；供需、目标价格和 Gamma 情景缺少完整头寸及验证参数，不生成因子或信号。",
  ],
  [
    "7AJ_TuznstU",
    "傅里叶、特征选择与共线性",
    "2025-10-07T03:28:55.000Z",
    834,
    "复核分类：仅有方法描述。实际播放并检查烧录字幕；没有公开数据集、特征构造、窗口和样本外结果，不生成工程参数。",
  ],
  [
    "yOTP8utTOBU",
    "贝叶斯、过拟合与高频交易类比",
    "2025-09-17T04:41:33.000Z",
    950,
    "复核分类：仅有方法描述。实际播放并检查烧录字幕；哲学和方法类比没有可复算策略定义或验证结果，因子保持为空。",
  ],
  [
    "Ek7JmxnJpKM",
    "Alpha、Beta、CDS 与对冲案例",
    "2025-09-11T03:18:14.000Z",
    947,
    "复核分类：作者案例。实际播放并检查烧录字幕；‘风险为零’等表达不具备可审计假设、成本和尾部场景，不作为系统结论或因子。",
  ],
  [
    "SKlcxduCDWU",
    "柯西分布、厚尾与模型风险",
    "2025-06-27T04:34:46.000Z",
    877,
    "复核分类：可核验的定性模型风险。实际播放并检查烧录字幕；关键画面约 5:00。视频未公开拟合样本、检验或分位阈值，仅归档厚尾风险。",
  ],
  [
    "ieOYpQHxf1o",
    "主动/被动订单、正态性与交易成本",
    "2025-06-04T04:07:33.000Z",
    829,
    "复核分类：方法描述与案例。实际播放并检查烧录字幕，包括 10:20 关键画面；未公开可复算数据和阈值，不将政策或操纵判断写入因子。",
  ],
  [
    "yRyDAGRbI-c",
    "加密市场、ICT 与订单流逻辑检验",
    "2025-05-27T23:23:00.000Z",
    905,
    "复核分类：方法批评。实际播放并检查烧录字幕；未给出可复现数据集、策略定义和样本外验证，不生成 ICT 或订单流参数。",
  ],
  [
    "8qNKo7MXP_0",
    "美国国债现金期货基差与杠杆风险",
    "2025-04-25T04:28:10.000Z",
    719,
    "复核分类：可核验的定性机制。实际播放并检查烧录字幕；关键画面约 5:00。基差案例没有完整融资、保证金和头寸参数，仅归档杠杆及展期风险。",
  ],
  [
    "UPc2x13aMNU",
    "做市商、买卖价差与库存风险",
    "2024-11-04T03:29:49.000Z",
    612,
    "复核分类：可核验的市场微观结构概念。实际播放并检查烧录字幕；关键画面约 3:00。只归档买卖价差交易成本，不推断操纵意图或生成方向信号。",
  ],
] as const;

const marketResearchArchiveFactorSeeds = [
  {
    externalId: "EfAxMEgi14w",
    code: "NEGATIVE_GAMMA_HEDGING_FEEDBACK",
    category: "DERIVATIVES",
    label: "负 Gamma 对冲反馈风险",
    direction: "CONDITIONAL",
    directionScore: 0,
    tailRiskScore: 85,
    confidence: 85,
    sourceTimestampSeconds: 421,
    asOfDate: "2026-06-07",
    evidenceSummary:
      "视频在 7:01 展示负 Gamma 环境下的反馈回路；Cboe 研究说明负 Gamma 做市商的 Delta 对冲可能追涨杀跌并放大波动。",
    officialSourceUrl:
      "https://cdn.cboe.com/resources/education/research_publications/gammasqueezes.pdf",
    notes: "定性风险机制；没有完整头寸和对冲参数，不生成方向、概率、阈值或订单。",
  },
  {
    externalId: "TWokF_gzpX0",
    code: "MBO_ORDER_EVENT_DATA_REQUIREMENT",
    category: "MARKET_MICROSTRUCTURE",
    label: "MBO 订单事件数据要求",
    direction: "CONDITIONAL",
    directionScore: 0,
    tailRiskScore: 70,
    confidence: 95,
    sourceTimestampSeconds: 61,
    asOfDate: "2026-05-09",
    evidenceSummary:
      "视频讨论逐笔订单流；CME MBO 规范以唯一 OrderID 发布 New、Change、Delete 事件及队列优先级。",
    officialSourceUrl:
      "https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457605721",
    notes:
      "项目当前只有 OHLCV/top-of-book，无法重建订单生命周期；只记录数据缺口，不实现伪造的冰山、spoofing 或撤单检测。",
  },
  {
    externalId: "mbboVQ8NoWc",
    code: "NORMALITY_ASSUMPTION_TAIL_RISK",
    category: "MODEL_RISK",
    label: "正态假设尾部低估风险",
    direction: "CONDITIONAL",
    directionScore: 0,
    tailRiskScore: 85,
    confidence: 85,
    sourceTimestampSeconds: 181,
    asOfDate: "2025-06-19",
    evidenceSummary:
      "视频讨论正态分布假设；巴塞尔委员会以 expected shortfall 替代 VaR 的一项理由是更好捕捉尾部风险。",
    officialSourceUrl: "https://www.bis.org/publ/bcbs219.htm",
    notes: "没有样本、拟合检验或阈值，只归档模型风险；不改变现有 VaR/ES 参数。",
  },
  {
    externalId: "bdBMTDxrqRg",
    code: "CARRY_TRADE_MULTI_LEG_RISK",
    category: "FUNDING_LIQUIDITY",
    label: "融资套利多腿去杠杆风险",
    direction: "CONDITIONAL",
    directionScore: 0,
    tailRiskScore: 90,
    confidence: 90,
    sourceTimestampSeconds: 1323,
    asOfDate: "2024-08-24",
    evidenceSummary:
      "视频以现金/期货基差和日元融资说明套利链条；BIS 说明杠杆 carry 交易平仓可放大政策冲击和汇率波动。",
    officialSourceUrl: "https://www.bis.org/publ/bisbull124.htm",
    notes: "未公开融资成本、套保比率、展期和汇率参数，只归档多腿风险。",
  },
  {
    externalId: "BBeLGBchxxA",
    code: "GROSS_SETTLEMENT_LIQUIDITY_RISK",
    category: "SETTLEMENT_LIQUIDITY",
    label: "失去净额后的结算流动性风险",
    direction: "CONDITIONAL",
    directionScore: 0,
    tailRiskScore: 80,
    confidence: 95,
    sourceTimestampSeconds: 666,
    asOfDate: "2026-07-20",
    evidenceSummary:
      "视频讨论代币化证券的即时结算；DTCC 说明净额可减少资金和证券需求，而实时总额结算会失去这项流动性及风险管理收益。",
    officialSourceUrl: "https://www.dtcc.com/ust1/faqs",
    notes: "DTCC 示例比例不作为系统阈值或参数；只归档定性结算流动性风险。",
  },
  {
    externalId: "kGCgiHXemp0",
    code: "MARGIN_CALL_LIQUIDITY_AMPLIFICATION",
    category: "MARGIN_LIQUIDITY",
    label: "保证金追加的流动性放大风险",
    direction: "CONDITIONAL",
    directionScore: 0,
    tailRiskScore: 90,
    confidence: 95,
    sourceTimestampSeconds: 350,
    asOfDate: "2026-02-01",
    evidenceSummary:
      "视频讨论波动期间的 CME 保证金变化；BIS 说明保证金快速上升会放大市场参与者的流动性需求。",
    officialSourceUrl: "https://www.bis.org/fsi/fsisummaries/exsum_23913.htm",
    notes: "保证金调整不是市场方向或抄底信号；没有把视频案例数字写成阈值。",
  },
  {
    externalId: "SKlcxduCDWU",
    code: "HEAVY_TAIL_DISTRIBUTION_MODEL_RISK",
    category: "MODEL_RISK",
    label: "厚尾分布模型风险",
    direction: "CONDITIONAL",
    directionScore: 0,
    tailRiskScore: 90,
    confidence: 90,
    sourceTimestampSeconds: 300,
    asOfDate: "2025-06-26",
    evidenceSummary:
      "视频以柯西分布说明厚尾；巴塞尔委员会采用 expected shortfall 以更好捕捉损失分布尾部风险。",
    officialSourceUrl: "https://www.bis.org/publ/bcbs219.htm",
    notes: "未公开拟合样本、分布检验或阈值，只归档模型风险。",
  },
  {
    externalId: "8qNKo7MXP_0",
    code: "TREASURY_BASIS_LEVERAGE_RISK",
    category: "FUNDING_LIQUIDITY",
    label: "国债基差交易杠杆与融资风险",
    direction: "CONDITIONAL",
    directionScore: 0,
    tailRiskScore: 90,
    confidence: 95,
    sourceTimestampSeconds: 300,
    asOfDate: "2025-04-24",
    evidenceSummary:
      "视频讨论美国国债现金/期货基差；OFR 研究确认该交易暴露于回购融资展期和期货保证金风险。",
    officialSourceUrl:
      "https://www.financialresearch.gov/working-papers/2021/04/01/hedge-funds-and-the-treasury-cash-futures-disconnect/",
    notes: "没有将基差、杠杆或保证金案例值写成交易参数。",
  },
  {
    externalId: "UPc2x13aMNU",
    code: "BID_ASK_SPREAD_TRANSACTION_COST",
    category: "MARKET_MICROSTRUCTURE",
    label: "买卖价差交易成本",
    direction: "CONDITIONAL",
    directionScore: 0,
    tailRiskScore: 60,
    confidence: 95,
    sourceTimestampSeconds: 180,
    asOfDate: "2024-11-03",
    evidenceSummary: "视频介绍做市商报价和买卖价差；SEC 将 spread 定义为 bid 与 ask 的差额。",
    officialSourceUrl: "https://www.sec.gov/answers/spread.htm",
    notes: "只归档交易成本概念，不从价差单独推断操纵、方向或可成交性。",
  },
] as const;

const marketResearchDispositionSeeds = [
  [
    "GYMyDFwNULk",
    "家庭与政治风险的波动率类比",
    "2026-07-23T01:02:01.000Z",
    1137,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；主题是家庭与政治风险，虽出现波动率公式类比，但不是金融市场量化交易研究。因子保持为空。",
  ],
  [
    "CIUWqv88BvY",
    "体育博彩、泊松模型与庄家定价",
    "2026-06-21T00:14:49.000Z",
    1019,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；主题是体育博彩而非证券或期货市场研究，不迁移模型或赔率参数。因子保持为空。",
  ],
  [
    "V7OJZtHeBDI",
    "军事 OODA 与 AI 决策类比",
    "2026-03-07T23:10:59.000Z",
    940,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；主题是军事决策，交易仅作类比，不构成可复算市场研究。因子保持为空。",
  ],
  [
    "IeXPkra5wIc",
    "政治体制崩溃的泊松案例",
    "2026-03-07T02:36:35.000Z",
    902,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；主题是政治体制事件，标题概率属于作者案例，未作为市场概率、参数或因子。",
  ],
  [
    "06jPhhoSFOA",
    "社会与政治风险指数",
    "2025-08-26T02:36:34.000Z",
    821,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；主题为社会政治风险指数，不是量化交易研究。因子保持为空。",
  ],
  [
    "edie-aEYqd4",
    "个人生活选择的量化方法",
    "2025-08-17T04:35:51.000Z",
    847,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；主题为个人选择决策，不是金融市场研究。因子保持为空。",
  ],
  [
    "pc6pQwQ_N6o",
    "Kalman 滤波与 GDP 重建",
    "2025-07-27T01:27:22.000Z",
    941,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；主题为宏观统计重建，未提供交易目标、可执行规则或市场验证，归为非交易研究。",
  ],
  [
    "D98G-KRnV2s",
    "通缩与货币消失的宏观叙事",
    "2025-07-16T04:30:39.000Z",
    959,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；主题为宏观经济叙事，不是可复算的量化交易研究。因子保持为空。",
  ],
  [
    "Ill1jJTmj8Y",
    "科斯交易成本与经济制度",
    "2025-07-02T05:10:22.000Z",
    856,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；讨论的是制度经济学交易成本，不是证券交易执行成本或量化策略。因子保持为空。",
  ],
  [
    "Est3gogeYag",
    "中国出口宏观预测",
    "2025-03-22T05:50:58.000Z",
    684,
    "REJECTED_NOT_TRADING_RESEARCH",
    "实际播放并检查烧录字幕；主题为出口宏观预测，未提供可复算交易研究定义或验证，因子保持为空。",
  ],
  [
    "ixOYjn99qGg",
    "止损流动性、CVD 与价差扩张",
    "2026-06-12T22:41:11.000Z",
    964,
    "ACCESS_BLOCKED_MEMBER",
    "页面明确显示会员专享；未绕过访问限制，未观看内容，不能依据标题提取参数或因子。",
  ],
  [
    "5_oTbFWrW2Q",
    "金融分布、厚尾、泊松过程与真假突破",
    "2026-06-06T00:51:03.000Z",
    940,
    "ACCESS_BLOCKED_MEMBER",
    "页面明确显示会员专享；未绕过访问限制，未观看内容，不能依据标题提取参数或因子。",
  ],
  [
    "seUQPOzy9TI",
    "鞅、可选停时与加倍策略破产风险",
    "2026-04-25T23:06:56.000Z",
    878,
    "ACCESS_BLOCKED_MEMBER",
    "页面明确显示会员专享；未绕过访问限制，未观看内容，不能依据标题提取参数或因子。",
  ],
  [
    "C7qdqZN2SwY",
    "Shannon 熵与 Kelly 标题候选",
    "2026-04-05T02:13:20.000Z",
    805,
    "ACCESS_BLOCKED_MEMBER",
    "本轮页面访问明确显示会员专享；未绕过访问限制，未观看内容，不能依据标题提取参数或因子。",
  ],
  [
    "VSGnuoHmA_o",
    "信息论、Kelly、互信息与协整套利",
    "2026-03-29T00:20:59.000Z",
    833,
    "ACCESS_BLOCKED_MEMBER",
    "页面明确显示会员专享；未绕过访问限制，未观看内容，不能依据标题提取参数或因子。",
  ],
  [
    "PRVTAQ8vWas",
    "Gamma、HMM、XIV 与 LTCM 标题候选",
    "2026-03-21T00:56:23.000Z",
    813,
    "ACCESS_BLOCKED_MEMBER",
    "本轮页面访问明确显示会员专享；未绕过访问限制，未观看内容，不能依据标题提取参数或因子。",
  ],
  [
    "AvCMROfiKt4",
    "量化对冲、Alpha 与 Beta 标题候选",
    "2026-03-15T00:44:31.000Z",
    754,
    "ACCESS_BLOCKED_MEMBER",
    "本轮页面访问明确显示会员专享；未绕过访问限制，未观看内容，不能依据标题提取参数或因子。",
  ],
] as const;

function buildSeedMarketData(
  providerId: string,
  symbol: string,
  basePrice: number,
  dailyTrend: number,
  amplitude: number,
) {
  const rows: Array<{
    providerId: string;
    symbol: string;
    tradeDate: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    adjustedClose: number;
    volume: number;
    dividend: number;
    splitFactor: number;
    currency: string;
    source: string;
    dataOrigin: string;
  }> = [];
  const cursor = new Date("2023-01-03T00:00:00.000Z");
  const end = new Date("2026-07-17T00:00:00.000Z");
  let tradingIndex = 0;
  let previousClose = basePrice;

  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      const cycle = Math.sin(tradingIndex / 17) * amplitude;
      const slowCycle = Math.sin(tradingIndex / 71) * amplitude * 1.8;
      const close = Math.max(2, basePrice + dailyTrend * tradingIndex + cycle + slowCycle);
      const open = previousClose * (1 + Math.sin(tradingIndex / 11) * 0.0035);
      const high = Math.max(open, close) * (1.007 + Math.abs(Math.sin(tradingIndex / 9)) * 0.006);
      const low = Math.min(open, close) * (0.993 - Math.abs(Math.cos(tradingIndex / 13)) * 0.004);
      const dividend = symbol === "AAPL" && tradingIndex > 0 && tradingIndex % 63 === 0 ? 0.25 : 0;
      rows.push({
        providerId,
        symbol,
        tradeDate: new Date(cursor),
        open: Number(open.toFixed(6)),
        high: Number(high.toFixed(6)),
        low: Number(low.toFixed(6)),
        close: Number(close.toFixed(6)),
        adjustedClose: Number(close.toFixed(6)),
        volume: Math.round(20_000_000 + Math.abs(Math.sin(tradingIndex / 7)) * 55_000_000),
        dividend,
        splitFactor: 1,
        currency: "USD",
        source: "SEED_V1_3",
        dataOrigin: "SYNTHETIC",
      });
      previousClose = close;
      tradingIndex += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

async function buyAndHoldMetrics(symbol: string) {
  const bars = await prisma.marketDataDaily.findMany({
    where: { source: "SEED_V1_3",
      dataOrigin: "SYNTHETIC", symbol },
    orderBy: { tradeDate: "asc" },
    select: { adjustedClose: true, tradeDate: true },
  });
  if (bars.length < 120) throw new Error(`V1.6 validation market data missing: ${symbol}`);
  const summarize = (rows: typeof bars) => {
    let peak = Number(rows[0]!.adjustedClose);
    let maxDrawdown = 0;
    for (const row of rows) {
      const price = Number(row.adjustedClose);
      peak = Math.max(peak, price);
      maxDrawdown = Math.min(maxDrawdown, (price / peak - 1) * 100);
    }
    return {
      executionCount: 1,
      maxDrawdown: Number(maxDrawdown.toFixed(8)),
      totalReturn: Number(
        ((Number(rows.at(-1)!.adjustedClose) / Number(rows[0]!.adjustedClose) - 1) * 100).toFixed(
          8,
        ),
      ),
    };
  };
  const split = Math.floor(bars.length * 0.7);
  return {
    end: bars.at(-1)!.tradeDate,
    inSample: summarize(bars.slice(0, split)),
    outSample: summarize(bars.slice(split)),
    start: bars[0]!.tradeDate,
  };
}

async function seedMarketResearch() {
  for (const researchSeed of marketResearchSeeds) {
    const source = await prisma.marketResearchSource.upsert({
      where: { externalId: researchSeed.externalId },
      update: {
        creatorName: "一个狠人",
        creatorHandle: "@henren778",
        title: researchSeed.title,
        url: researchSeed.url,
        publishedAt: new Date(researchSeed.publishedAt),
        durationSeconds: researchSeed.durationSeconds,
        extractionMethod: "BURNED_IN_SUBTITLE_TIMELINE_REVIEW",
        reviewStatus: "REVIEWED",
        notes: researchSeed.notes,
      },
      create: {
        id: `market-source-youtube-${researchSeed.externalId}`,
        sourceType: "YOUTUBE",
        externalId: researchSeed.externalId,
        creatorName: "一个狠人",
        creatorHandle: "@henren778",
        title: researchSeed.title,
        url: researchSeed.url,
        publishedAt: new Date(researchSeed.publishedAt),
        durationSeconds: researchSeed.durationSeconds,
        extractionMethod: "BURNED_IN_SUBTITLE_TIMELINE_REVIEW",
        reviewStatus: "REVIEWED",
        notes: researchSeed.notes,
      },
    });

    for (const factor of researchSeed.factors) {
      const factorData = {
        category: factor.category,
        label: factor.label,
        value: factor.value,
        unit: factor.unit,
        direction: factor.direction,
        directionScore: factor.directionScore,
        tailRiskScore: factor.tailRiskScore,
        confidence: factor.confidence,
        horizonDays: factor.horizonDays,
        sourceTimestampSeconds: factor.sourceTimestampSeconds,
        asOfDate: new Date(`${factor.asOfDate}T00:00:00.000Z`),
        freshness: factor.freshness,
        verificationStatus: factor.verificationStatus,
        includeInAssessment: factor.includeInAssessment,
        evidenceSummary: factor.evidenceSummary,
        officialSourceUrl: factor.officialSourceUrl,
        notes: factor.notes,
      };
      await prisma.marketInfluenceFactor.upsert({
        where: { sourceId_code: { sourceId: source.id, code: factor.code } },
        update: factorData,
        create: {
          id: `market-factor-${researchSeed.externalId}-${factor.code.toLowerCase()}`,
          sourceId: source.id,
          code: factor.code,
          ...factorData,
        },
      });
    }
  }

  for (const [
    externalId,
    title,
    publishedAt,
    durationSeconds,
    notes,
  ] of marketResearchReviewedArchiveSeeds) {
    await prisma.marketResearchSource.upsert({
      where: { externalId },
      update: {
        creatorName: "一个狠人",
        creatorHandle: "@henren778",
        title,
        url: `https://www.youtube.com/watch?v=${externalId}`,
        publishedAt: new Date(publishedAt),
        durationSeconds,
        extractionMethod: "BURNED_IN_SUBTITLE_TIMELINE_REVIEW",
        reviewStatus: "REVIEWED",
        notes,
      },
      create: {
        id: `market-source-youtube-${externalId}`,
        sourceType: "YOUTUBE",
        externalId,
        creatorName: "一个狠人",
        creatorHandle: "@henren778",
        title,
        url: `https://www.youtube.com/watch?v=${externalId}`,
        publishedAt: new Date(publishedAt),
        durationSeconds,
        extractionMethod: "BURNED_IN_SUBTITLE_TIMELINE_REVIEW",
        reviewStatus: "REVIEWED",
        notes,
      },
    });
  }

  for (const factor of marketResearchArchiveFactorSeeds) {
    const source = await prisma.marketResearchSource.findUniqueOrThrow({
      where: { externalId: factor.externalId },
      select: { id: true },
    });
    const factorData = {
      category: factor.category,
      label: factor.label,
      value: null,
      unit: null,
      direction: factor.direction,
      directionScore: factor.directionScore,
      tailRiskScore: factor.tailRiskScore,
      confidence: factor.confidence,
      horizonDays: null,
      sourceTimestampSeconds: factor.sourceTimestampSeconds,
      asOfDate: new Date(`${factor.asOfDate}T00:00:00.000Z`),
      freshness: "HISTORICAL",
      verificationStatus: "VERIFIED",
      includeInAssessment: false,
      evidenceSummary: factor.evidenceSummary,
      officialSourceUrl: factor.officialSourceUrl,
      notes: factor.notes,
    };
    await prisma.marketInfluenceFactor.upsert({
      where: { sourceId_code: { sourceId: source.id, code: factor.code } },
      update: factorData,
      create: {
        id: `market-factor-${factor.externalId}-${factor.code.toLowerCase()}`,
        sourceId: source.id,
        code: factor.code,
        ...factorData,
      },
    });
  }

  for (const [
    externalId,
    title,
    publishedAt,
    durationSeconds,
    reviewStatus,
    notes,
  ] of marketResearchDispositionSeeds) {
    const source = await prisma.marketResearchSource.upsert({
      where: { externalId },
      update: {
        creatorName: "一个狠人",
        creatorHandle: "@henren778",
        title,
        url: `https://www.youtube.com/watch?v=${externalId}`,
        publishedAt: new Date(publishedAt),
        durationSeconds,
        extractionMethod:
          reviewStatus === "ACCESS_BLOCKED_MEMBER"
            ? "CHANNEL_ACCESS_CHECK"
            : "BURNED_IN_SUBTITLE_TIMELINE_REVIEW",
        reviewStatus,
        notes,
      },
      create: {
        id: `market-source-youtube-${externalId}`,
        sourceType: "YOUTUBE",
        externalId,
        creatorName: "一个狠人",
        creatorHandle: "@henren778",
        title,
        url: `https://www.youtube.com/watch?v=${externalId}`,
        publishedAt: new Date(publishedAt),
        durationSeconds,
        extractionMethod:
          reviewStatus === "ACCESS_BLOCKED_MEMBER"
            ? "CHANNEL_ACCESS_CHECK"
            : "BURNED_IN_SUBTITLE_TIMELINE_REVIEW",
        reviewStatus,
        notes,
      },
    });
    await prisma.marketInfluenceFactor.deleteMany({ where: { sourceId: source.id } });
  }
}

async function main() {
  assertDemoSeedTarget(process.env.DATABASE_URL, process.env.SEED_DEMO_CONFIRM);
  const existingAccounts = await prisma.account.findMany({ select: { id: true, dataOrigin: true, note: true } });
  if (existingAccounts.some((row) => row.id !== "account-demo" || row.dataOrigin !== "DEMO")) {
    throw new Error("Demo Seed refuses databases containing user accounts.");
  }
  if (existingAccounts.length) {
    if (existingAccounts[0]?.note !== "DEMO_SEED_COMPLETE_V1_11") throw new Error("Incomplete demo seed: inspect the dedicated database before retrying.");
    console.log("Demo already initialized; no existing data or configuration was changed.");
    return;
  }
  if (await prisma.user.count() || await prisma.paperAccount.count() || await prisma.brokerAccount.count()) {
    throw new Error("Demo Seed requires an empty database, including all trading ledgers.");
  }
  if (process.env.SEED_SCOPE) throw new Error("Partial seed scopes are disabled: initialize an isolated complete demo.");
  if (process.env.SEED_SCOPE === "market-research") {
    await seedMarketResearch();
    console.log(
      `Market research seed complete: sources=${await prisma.marketResearchSource.count()}, factors=${await prisma.marketInfluenceFactor.count()}`,
    );
    return;
  }

  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!seedAdminPassword || !validAdminPassword(seedAdminPassword)) {
    throw new Error("SEED_ADMIN_PASSWORD must satisfy the strong local administrator password policy.");
  }

  const user = await prisma.user.upsert({
    where: { username: "admin" },
    update: { displayName: "Demo Administrator" },
    create: {
      id: "user-admin",
      username: "admin",
      passwordHash: hashPassword(seedAdminPassword),
      displayName: "Demo Administrator",
    },
  });

  const account = await prisma.account.upsert({
    where: { id: "account-demo" },
    update: {
      name: "虚构演示账户 DEMO",
      broker: "Interactive Brokers",
      baseCurrency: "USD",
    },
    create: {
      id: "account-demo",
      dataOrigin: "DEMO",
      userId: user.id,
      name: "虚构演示账户 DEMO",
      broker: "Interactive Brokers",
      baseCurrency: "USD",
      initialCapital: 108000,
      totalEquity: 120000,
      cashBalance: 81400,
      realizedPnlYtd: 18000,
      note: "V1.1 核心验收账户",
    },
  });

  const instrumentIds = new Map<string, string>();
  for (const [symbol, name, assetType, category, theme, leverageRatio] of instruments) {
    const leverageMultiplier = leverageRatio ?? 1;
    const leveragedETF = assetType === "LEVERAGED_ETF";
    const underlyingSymbol = underlyingBySymbol[symbol] ?? symbol;
    const riskTheme = ["DLA2", "DLB2"].includes(symbol) ? "SYNTHETIC_LAB" : theme === "STORAGE" ? "MEMORY" : theme;
    const sector = new Set(["AI", "BIG_TECH", "CORE_INDEX", "STORAGE"]).has(theme)
      ? "TECHNOLOGY"
      : category;
    const instrument = await prisma.instrument.upsert({
      where: { symbol },
      update: {
        name,
        assetType,
        category,
        direction: "LONG",
        industry: theme === "STORAGE" ? "SEMICONDUCTOR_MEMORY" : sector,
        leveragedETF,
        leverageMultiplier,
        leverageRatio,
        riskTheme,
        sector,
        theme,
        underlyingSymbol,
        isActive: true,
      },
      create: {
        id: `instrument-${symbol.toLowerCase()}`,
        symbol,
        name,
        market: "US",
        assetType,
        category,
        theme,
        leverageRatio,
        underlyingSymbol,
        riskTheme,
        sector,
        industry: theme === "STORAGE" ? "SEMICONDUCTOR_MEMORY" : sector,
        leverageMultiplier,
        direction: "LONG",
        leveragedETF,
      },
    });
    instrumentIds.set(symbol, instrument.id);
  }

  const positions = [
    ["DLA2", 60, 200, 150],
    ["DLB2", 100, 90, 60],
    ["QQQM", 40, 320, 320],
    ["VOO", 12, 500, 500],
    ["AAPL", 30, 160, 160],
  ] as const;

  for (const [symbol, quantity, avgCost, currentPrice] of positions) {
    const instrumentId = instrumentIds.get(symbol);
    if (!instrumentId) throw new Error(`Seed instrument missing: ${symbol}`);
    await prisma.position.upsert({
      where: { accountId_instrumentId: { accountId: account.id, instrumentId } },
      update: {},
      create: {
        id: `position-${symbol.toLowerCase()}`,
        accountId: account.id,
        instrumentId,
        quantity,
        avgCost,
        currentPrice,
      },
    });
  }

  for (const [code, name, ruleType, limitValue, level] of riskRules) {
    await prisma.riskRule.upsert({
      where: { code },
      update: { name, ruleType, limitValue, level, enabled: true },
      create: { id: `rule-${code.toLowerCase()}`, code, name, ruleType, limitValue, level },
    });
  }

  await prisma.profitGivebackSnapshot.upsert({
    where: {
      accountId_snapshotDate: {
        accountId: account.id,
        snapshotDate: new Date("2026-07-17T00:00:00.000Z"),
      },
    },
    update: {
      currentYtdPnl: 12000,
      peakYtdPnl: 18000,
      profitGivebackAmount: 6000,
      profitGivebackPct: 33.3333,
      state: "KILL_SWITCH",
    },
    create: {
      id: "profit-giveback-account-demo-2026-07-17",
      accountId: account.id,
      snapshotDate: new Date("2026-07-17T00:00:00.000Z"),
      currentYtdPnl: 12000,
      peakYtdPnl: 18000,
      profitGivebackAmount: 6000,
      profitGivebackPct: 33.3333,
      state: "KILL_SWITCH",
      ruleVersion: 1,
    },
  });

  await prisma.positionIncident.upsert({
    where: { idempotencyKey: "seed-synthetic-lab-incident-v1" },
    update: {
      dataGranularity: "DAILY_MAE_APPROXIMATION",
      riskTheme: "SYNTHETIC_LAB",
      symbolsJson: JSON.stringify(["DLA2", "DLB2"]),
      title: "DLA2 / DLB2 杠杆亏损补仓事故复盘",
    },
    create: {
      id: "position-incident-synthetic-lab",
      idempotencyKey: "seed-synthetic-lab-incident-v1",
      localAccountId: account.id,
      title: "DLA2 / DLB2 杠杆亏损补仓事故复盘",
      symbolsJson: JSON.stringify(["DLA2", "DLB2"]),
      riskTheme: "SYNTHETIC_LAB",
      source: "SYNTHETIC",
      dataGranularity: "DAILY_MAE_APPROXIMATION",
      openedAt: new Date("2024-02-05T00:00:00.000Z"),
      firstViolationAt: new Date("2024-02-12T00:00:00.000Z"),
      closedAt: new Date("2024-03-16T23:59:59.000Z"),
      status: "CLOSED",
      finalRealizedPnl: -6000,
      maximumUnrealizedLoss: -9000,
      maximumFavorableExcursion: 900,
      mfeCaptureRatio: null,
      maeToRealizedLoss: 1.5,
    },
  });

  const seedProvider = await prisma.marketDataProvider.upsert({
    where: { code: "SEED_V1_3" },
    update: {
      enabled: true,
      name: "V1.3 系统测试日线",
      providerType: "SEED",
      lastSyncAt: new Date(),
    },
    create: {
      id: "market-provider-seed-v1-3",
      code: "SEED_V1_3",
      name: "V1.3 系统测试日线",
      providerType: "SEED",
      lastSyncAt: new Date(),
      configJson: JSON.stringify({ timeframe: "1D", generated: true, readOnly: true }),
    },
  });

  await prisma.marketDataProvider.upsert({
    where: { code: "CSV_IMPORT" },
    update: { enabled: true, name: "CSV 历史行情导入", providerType: "CSV" },
    create: {
      id: "market-provider-csv",
      code: "CSV_IMPORT",
      name: "CSV 历史行情导入",
      providerType: "CSV",
      configJson: JSON.stringify({ supportsPreview: true, timeframe: "1D" }),
    },
  });

  await prisma.marketDataProvider.upsert({
    where: { code: "CONFIGURABLE_HTTP_DAILY" },
    update: {
      name: "可配置在线日线 Provider",
      providerType: "HTTP_JSON",
      providerVersion: "1.0",
    },
    create: {
      id: "market-provider-configurable-http",
      code: "CONFIGURABLE_HTTP_DAILY",
      name: "可配置在线日线 Provider",
      providerType: "HTTP_JSON",
      enabled: false,
      providerVersion: "1.0",
      rateLimitJson: JSON.stringify({ limit: null, strategy: "provider-response" }),
      configJson: JSON.stringify({
        apiKeyEnv: "MARKET_DATA_HTTP_API_KEY",
        baseUrlEnv: "MARKET_DATA_HTTP_BASE_URL",
        dailyPathTemplate: "/daily?symbol={symbol}&start={start}&end={end}",
        metadataPathTemplate: "/instruments/{symbol}",
        storesCredentials: false,
      }),
    },
  });

  await prisma.marketDataProvider.upsert({
    where: { code: "IBKR_HISTORICAL_RESERVED" },
    update: { enabled: false, name: "IBKR Historical Data（预留）", providerType: "RESERVED" },
    create: {
      id: "market-provider-ibkr-reserved",
      code: "IBKR_HISTORICAL_RESERVED",
      name: "IBKR Historical Data（预留）",
      providerType: "RESERVED",
      enabled: false,
      configJson: JSON.stringify({ implemented: false, directTrading: false }),
    },
  });

  const strategyEvidenceProviders = [
    {
      id: "strategy-evidence-provider-sec",
      code: "SEC_COMPANYFACTS",
      name: "SEC EDGAR Company Facts",
      evidenceType: "FUNDAMENTAL",
      providerType: "SEC_COMPANYFACTS_API",
      apiKeyEnv: null,
      config: { userAgentEnv: "SEC_USER_AGENT", storesCredentials: false },
      message: "需要配置带联系邮箱的 SEC_USER_AGENT；ETF 本身可能没有可比较的经营财报",
    },
    {
      id: "strategy-evidence-provider-ibkr-book",
      code: "IBKR_TOP_OF_BOOK",
      name: "IBKR Top-of-Book",
      evidenceType: "ORDER_BOOK",
      providerType: "IBKR_CLIENT_PORTAL",
      apiKeyEnv: null,
      config: { connectorUrlEnv: "BROKER_CONNECTOR_URL", requiresContractId: true },
      message: "需要已认证 IBKR 网关、行情订阅和标的 contractId",
    },
    {
      id: "strategy-evidence-provider-fred",
      code: "FRED_FINANCIAL_CONDITIONS",
      name: "FRED National Financial Conditions Index",
      evidenceType: "FINANCING",
      providerType: "FRED_API",
      apiKeyEnv: "FRED_API_KEY",
      config: { seriesId: "NFCI", outputType: 4, vintageSafe: true },
      message: "需要配置 FRED_API_KEY；使用初次发布值避免修订数据前视",
    },
    {
      id: "strategy-evidence-provider-fred-macro",
      code: "FRED_MACRO_MARKET",
      name: "FRED / Cboe 宏观市场研究因子",
      evidenceType: "MACRO_MARKET",
      providerType: "FRED_API",
      apiKeyEnv: "FRED_API_KEY",
      config: {
        outputType: 4,
        researchOnly: true,
        series: ["DFF", "DTWEXBGS", "VIXCLS"],
        vintageSafe: true,
      },
      message:
        "当前官方快照无需密钥；配置 FRED_API_KEY 后才能按初次发布值安全回填历史，且始终不直接生成信号",
    },
    {
      id: "strategy-evidence-provider-short-interest",
      code: "OFFICIAL_SHORT_INTEREST",
      name: "FINRA / Listing Exchange Short Interest",
      evidenceType: "SHORT_INTEREST",
      providerType: "OFFICIAL_REVIEWED_IMPORT",
      apiKeyEnv: null,
      config: { acceptedDomains: ["finra.org", "nasdaq.com"], frequency: "SEMI_MONTHLY" },
      message: "上市证券空头持仓须从 FINRA 或挂牌交易所官方文件导入；不能用日短卖量冒充",
    },
  ] as const;
  for (const provider of strategyEvidenceProviders) {
    await prisma.strategyEvidenceProvider.upsert({
      where: { code: provider.code },
      update: {
        name: provider.name,
        evidenceType: provider.evidenceType,
        providerType: provider.providerType,
        apiKeyEnv: provider.apiKeyEnv,
        configJson: JSON.stringify(provider.config),
        enabled: true,
        lastHealthStatus:
          provider.code === "FRED_MACRO_MARKET" ? "READY" : "NEEDS_CONFIGURATION",
        lastHealthMessage: provider.message,
      },
      create: {
        id: provider.id,
        code: provider.code,
        name: provider.name,
        evidenceType: provider.evidenceType,
        providerType: provider.providerType,
        apiKeyEnv: provider.apiKeyEnv,
        configJson: JSON.stringify(provider.config),
        enabled: true,
        lastHealthStatus:
          provider.code === "FRED_MACRO_MARKET" ? "READY" : "NEEDS_CONFIGURATION",
        lastHealthMessage: provider.message,
      },
    });
  }

  const preexistingStrategyCodes = new Set(
    (await prisma.strategy.findMany({ select: { code: true } })).map((item) => item.code),
  );
  for (const strategy of strategySeeds) {
    await prisma.strategy.upsert({
      where: { code: strategy.code },
      update: {
        name: strategy.name,
        description: strategy.description,
        strategyType: strategy.strategyType,
        symbolUniverse: JSON.stringify(strategy.symbols),
        parameters: JSON.stringify(strategy.parameters),
        parameterSchema: JSON.stringify({ strategyType: strategy.strategyType, strict: true }),
        initialCapital: 100000,
        commissionRate: 0.001,
        slippageRate: 0.0005,
        maxPositionPercent: strategy.maxPositionPercent,
        enabled: strategy.enabled,
        approvalStatus: strategy.approvalStatus,
        version: strategy.code === "FLC_GUARD_QQQM" ? 2 : undefined,
      },
      create: {
        id: `strategy-${strategy.code.toLowerCase().replaceAll("_", "-")}`,
        name: strategy.name,
        code: strategy.code,
        version: strategy.code === "FLC_GUARD_QQQM" ? 2 : 1,
        description: strategy.description,
        strategyType: strategy.strategyType,
        symbolUniverse: JSON.stringify(strategy.symbols),
        timeframe: "1D",
        parameters: JSON.stringify(strategy.parameters),
        parameterSchema: JSON.stringify({ strategyType: strategy.strategyType, strict: true }),
        initialCapital: 100000,
        commissionRate: 0.001,
        slippageRate: 0.0005,
        positionSizingMode: "PERCENT_OF_EQUITY",
        maxPositionPercent: strategy.maxPositionPercent,
        enabled: strategy.enabled,
        approvalStatus: strategy.approvalStatus,
      },
    });
  }
  await prisma.strategy.updateMany({
    where: { strategyType: { in: ["MovingAverageCross", "RsiMeanReversion"] } },
    data: { approvalStatus: "REJECTED", enabled: false },
  });

  const paperAccount = await prisma.paperAccount.upsert({
    where: { id: "paper-account-v1-4" },
    update: {
      name: "V1.4 策略验证模拟账户",
      baseCurrency: "USD",
    },
    create: {
      id: "paper-account-v1-4",
      name: "V1.4 策略验证模拟账户",
      baseCurrency: "USD",
      initialCapital: 100000,
      cashBalance: 100000,
      totalEquity: 100000,
      peakEquity: 100000,
      status: "ACTIVE",
    },
  });

  const paperSnapshotTime = new Date("2026-07-17T00:00:00.000Z");
  await prisma.paperAccountEquitySnapshot.upsert({
    where: {
      paperAccountId_snapshotTime: {
        paperAccountId: paperAccount.id,
        snapshotTime: paperSnapshotTime,
      },
    },
    update: {
      source: "V1_4_SEED",
    },
    create: {
      id: "paper-equity-v1-4-seed",
      paperAccountId: paperAccount.id,
      snapshotTime: paperSnapshotTime,
      totalEquity: 100000,
      cashBalance: 100000,
      positionValue: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      drawdown: 0,
      source: "V1_4_SEED",
    },
  });

  await prisma.paperTradingControl.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global", killSwitchEnabled: false },
  });

  const existingSeedRows = await prisma.marketDataDaily.count({
    where: { providerId: seedProvider.id, source: "SEED_V1_3" },
  });
  if (existingSeedRows < 2200) {
    await prisma.marketDataDaily.deleteMany({
      where: { providerId: seedProvider.id, source: "SEED_V1_3" },
    });
    const rows = [
      ...buildSeedMarketData(seedProvider.id, "AAPL", 128, 0.07, 9),
      ...buildSeedMarketData(seedProvider.id, "QQQM", 105, 0.055, 6.5),
      ...buildSeedMarketData(seedProvider.id, "DLA2", 18, 0.014, 4.2),
    ];
    for (let index = 0; index < rows.length; index += 75) {
      await prisma.marketDataDaily.createMany({ data: rows.slice(index, index + 75) });
    }
  }

  // V1.6 组合验收策略使用合成 SYNTHETIC 日线计算基准指标；不伪造盈利，不覆盖已有审批结论。
  const portfolioSeedMembers: Array<{
    allocation: number;
    deploymentId: string;
    maxCapitalPercent: number;
    strategyId: string;
  }> = [];
  for (const code of ["BUY_AND_HOLD_AAPL", "BUY_AND_HOLD_QQQM", "BUY_AND_HOLD_DLA2"] as const) {
    const strategy = await prisma.strategy.findUnique({
      where: { code },
      include: { paperDeployments: true },
    });
    if (!strategy) throw new Error(`V1.6 portfolio strategy missing: ${code}`);
    const symbol = (JSON.parse(strategy.symbolUniverse) as string[])[0]!;
    const metrics = await buyAndHoldMetrics(symbol);
    const validationId = `validation-v1-6-${symbol.toLowerCase()}-buy-hold`;
    const approvalId = `approval-v1-6-${symbol.toLowerCase()}-buy-hold`;
    await prisma.strategyValidationRun.upsert({
      where: { id: validationId },
      update: {},
      create: {
        id: validationId,
        codeVersion: "v1.6-seed-market-observation",
        completedAt: new Date(),
        inSampleMetricsJson: JSON.stringify(metrics.inSample),
        marketDataEnd: metrics.end,
        marketDataSource: "SEED_V1_3",
        marketDataStart: metrics.start,
        outSampleMetricsJson: JSON.stringify(metrics.outSample),
        parameterGridJson: JSON.stringify({ positionPercent: [10, 20, 30] }),
        parameterSnapshot: strategy.parameters,
        quantEngineVersion: "1.6.0",
        recommendation: "PAPER_APPROVE_CANDIDATE",
        robustnessScore: 100,
        startedAt: new Date(),
        status: "COMPLETED",
        strategyId: strategy.id,
        stressConfigJson: JSON.stringify({ source: "SYNTHETIC_DAILY_BARS" }),
        symbolsJson: JSON.stringify([symbol]),
        walkForwardConfigJson: JSON.stringify({ anchored: true, maxWindows: 6 }),
        warningsJson: JSON.stringify([]),
      },
    });
    await prisma.strategyApproval.upsert({
      where: { id: approvalId },
      update: {},
      create: {
        id: approvalId,
        criteriaJson: JSON.stringify({
          benchmarkStrategy: true,
          inSample: metrics.inSample,
          outSample: metrics.outSample,
          performanceNotFabricated: true,
          source: "SEED_V1_3",
      dataOrigin: "SYNTHETIC",
        }),
        decidedAt: new Date(),
        reasonsJson: JSON.stringify(["合成 SYNTHETIC 日线 BuyAndHold 基准验证，仅允许 Paper 组合使用"]),
        status: "APPROVED",
        strategyId: strategy.id,
        userConfirmed: true,
        validationRunId: validationId,
      },
    });
    if (!preexistingStrategyCodes.has(code)) {
      await prisma.strategy.update({
        where: { id: strategy.id },
        data: { approvalStatus: "PAPER_APPROVED" },
      });
    }
    const eligibleDeployment = strategy.paperDeployments.find((item) =>
      ["PAPER_APPROVED", "PAPER_RUNNING", "PAPER_OBSERVING", "PAPER_PAUSED"].includes(item.status),
    );
    const deployment =
      eligibleDeployment ??
      (await prisma.strategyDeployment.upsert({
        where: { id: `deployment-v1-6-${symbol.toLowerCase()}-buy-hold` },
        update: {},
        create: {
          id: `deployment-v1-6-${symbol.toLowerCase()}-buy-hold`,
          approvalId,
          capitalAllocation: symbol === "DLA2" ? 10000 : 30000,
          codeVersion: "v1.6",
          exitCondition: "组合暂停、Kill Switch 或组合风控要求平仓",
          maxPositionPercent: symbol === "DLA2" ? 10 : 30,
          name: `${symbol} 组合模拟部署`,
          paperAccountId: paperAccount.id,
          paperRiskConfigJson: JSON.stringify({
            noBrokerOrder: true,
            portfolioOnly: true,
          }),
          parameterSnapshot: strategy.parameters,
          status: "PAPER_APPROVED",
          stopLossCondition: "组合风险预算、回撤或单策略 RiskEngine 触发",
          strategyId: strategy.id,
          strategyVersion: strategy.version,
          symbolUniverseJson: strategy.symbolUniverse,
        },
      }));
    portfolioSeedMembers.push({
      allocation: symbol === "DLA2" ? 10 : 30,
      deploymentId: deployment.id,
      maxCapitalPercent: symbol === "DLA2" ? 10 : 40,
      strategyId: strategy.id,
    });
  }

  const portfolio = await prisma.strategyPortfolio.upsert({
    where: { id: "portfolio-v1-6-core" },
    update: {},
    create: {
      id: "portfolio-v1-6-core",
      allocationMode: "FIXED_PERCENT",
      baseCurrency: "USD",
      cashBalance: 100000,
      cashReservePercent: 20,
      conflictPolicy: "NETTING",
      description: "V1.6 多策略统一资金池验收组合；只允许模拟执行。",
      initialCapital: 100000,
      name: "多策略核心组合",
      peakEquity: 100000,
      rebalanceMode: "MANUAL",
      status: "PAPER_RUNNING",
      totalEquity: 100000,
    },
  });
  await prisma.portfolioRiskRule.upsert({
    where: { portfolioId_version: { portfolioId: portfolio.id, version: 1 } },
    update: {},
    create: {
      correlatedStrategiesMaxPercent: 50,
      correlationThreshold: 0.8,
      leveragedEtfMaxPercent: 10,
      leveragedStrategyMaxPercent: 10,
      maxConcurrentPositions: 10,
      maxDailyLossPercent: 3,
      maxDrawdownPercent: 15,
      maxLosingStrategies: 2,
      maxStrategyDrawdownContributionPercent: 50,
      minCashPercent: 20,
      portfolioId: portfolio.id,
      singleStrategyMaxPercent: 40,
      singleSymbolMaxPercent: 30,
      singleThemeMaxPercent: 40,
      version: 1,
    },
  });
  await prisma.portfolioAllocationRule.upsert({
    where: { portfolioId_version: { portfolioId: portfolio.id, version: 1 } },
    update: {},
    create: {
      allocationMode: "FIXED_PERCENT",
      configurationJson: JSON.stringify({
        cashReservePercent: 20,
        items: portfolioSeedMembers.map((item) => ({
          amount: (item.allocation / 100) * 100000,
          maxCapitalPercent: item.maxCapitalPercent,
          strategyId: item.strategyId,
          targetAllocationPercent: item.allocation,
        })),
        source: "V1_6_ACCEPTANCE",
      }),
      portfolioId: portfolio.id,
      version: 1,
    },
  });
  for (const [index, member] of portfolioSeedMembers.entries()) {
    await prisma.portfolioStrategy.upsert({
      where: {
        portfolioId_strategyId: { portfolioId: portfolio.id, strategyId: member.strategyId },
      },
      update: {},
      create: {
        id: `portfolio-member-v1-6-${index + 1}`,
        maxCapitalPercent: member.maxCapitalPercent,
        portfolioId: portfolio.id,
        priority: index + 1,
        strategyDeploymentId: member.deploymentId,
        strategyId: member.strategyId,
        targetAllocationPercent: member.allocation,
        virtualCapital: (member.allocation / 100) * 100000,
        virtualCash: (member.allocation / 100) * 100000,
      },
    });
  }
  await prisma.portfolioCashMovement.upsert({
    where: { idempotencyKey: "PORTFOLIO_INITIAL_CAPITAL:portfolio-v1-6-core" },
    update: {},
    create: {
      amount: 100000,
      balanceAfter: 100000,
      description: "V1.6 组合模拟初始资金；不涉及真实账户",
      eventTime: new Date("2026-07-17T00:00:00.000Z"),
      idempotencyKey: "PORTFOLIO_INITIAL_CAPITAL:portfolio-v1-6-core",
      movementType: "INITIAL_CAPITAL",
      portfolioId: portfolio.id,
    },
  });
  await prisma.portfolioEquitySnapshot.upsert({
    where: {
      portfolioId_snapshotDate: {
        portfolioId: portfolio.id,
        snapshotDate: new Date("2026-07-17T00:00:00.000Z"),
      },
    },
    update: {},
    create: {
      cashBalance: 100000,
      dailyReturn: 0,
      drawdown: 0,
      exposureJson: JSON.stringify([]),
      portfolioId: portfolio.id,
      positionValue: 0,
      realizedPnl: 0,
      snapshotDate: new Date("2026-07-17T00:00:00.000Z"),
      totalEquity: 100000,
      totalReturn: 0,
      unrealizedPnl: 0,
    },
  });
  await prisma.portfolioAuditEvent.upsert({
    where: { id: "portfolio-audit-v1-6-created" },
    update: {},
    create: {
      id: "portfolio-audit-v1-6-created",
      eventType: "V1_6_ACCEPTANCE_PORTFOLIO_CREATED",
      payloadJson: JSON.stringify({
        initialCapital: 100000,
        noBrokerOrder: true,
        reservePercent: 20,
        strategyCount: portfolioSeedMembers.length,
      }),
      portfolioId: portfolio.id,
    },
  });

  // V1.7 仅写入不可变的只读验收快照。它不包含券商凭证，也不会覆盖 Account、Paper* 或 Portfolio* 账本。
  const brokerConnection = await prisma.brokerConnection.upsert({
    where: { id: "broker-connection-ibkr-readonly" },
    update: {},
    create: {
      id: "broker-connection-ibkr-readonly",
      capabilitiesJson: JSON.stringify({
        canCancelOrders: false,
        canModifyOrders: false,
        canPlaceOrders: false,
        canReadAccounts: true,
        canReadExecutions: true,
        canReadOrders: true,
        canReadPositions: true,
      }),
      connectorUrl: "http://localhost:5092",
      displayName: "IBKR 只读连接",
      enabled: false,
      environment: "LOCAL_GATEWAY",
      provider: "IBKR_READONLY",
      runMode: "OFFLINE",
      safetyState: "READ_ONLY",
      status: "OFFLINE",
    },
  });
  const brokerSyncJob = await prisma.brokerSyncJob.upsert({
    where: { idempotencyKey: "BROKER_SYNC:V1_7_ACCEPTANCE_READONLY" },
    update: {},
    create: {
      id: "broker-sync-v1-7-acceptance",
      accountCount: 1,
      brokerConnectionId: brokerConnection.id,
      completedAt: new Date("2026-07-17T12:00:05.000Z"),
      idempotencyKey: "BROKER_SYNC:V1_7_ACCEPTANCE_READONLY",
      positionCount: positions.length,
      requestedFrom: new Date("2026-07-01T00:00:00.000Z"),
      requestedTo: new Date("2026-07-17T12:00:00.000Z"),
      resultJson: JSON.stringify({
        acceptanceSnapshot: true,
        credentialsStored: false,
        source: "V1_7_ACCEPTANCE_READONLY",
      }),
      snapshotCount: 1,
      startedAt: new Date("2026-07-17T12:00:00.000Z"),
      status: "COMPLETED",
    },
  });
  const acceptanceAccountHash = createHash("sha256")
    .update("V1_7_ACCEPTANCE_NON_BROKER_ACCOUNT_ID")
    .digest("hex");
  const brokerAccount = await prisma.brokerAccount.upsert({
    where: {
      brokerConnectionId_externalAccountId: {
        brokerConnectionId: brokerConnection.id,
        externalAccountId: acceptanceAccountHash,
      },
    },
    update: {},
    create: {
      dataOrigin: "DEMO",
      id: "broker-account-v1-7-acceptance",
      accountType: "INDIVIDUAL",
      baseCurrency: "USD",
      brokerConnectionId: brokerConnection.id,
      externalAccountId: acceptanceAccountHash,
      lastSyncedAt: new Date("2026-07-17T12:00:00.000Z"),
      localAccountId: account.id,
      maskedAccountNumber: "U16****805",
      status: "STALE",
    },
  });
  const brokerSnapshotTime = new Date("2026-07-17T12:00:00.000Z");
  await prisma.brokerAccountSnapshot.upsert({
    where: {
      brokerAccountId_snapshotTime: {
        brokerAccountId: brokerAccount.id,
        snapshotTime: brokerSnapshotTime,
      },
    },
    update: {},
    create: {
      availableFunds: 81400,
      brokerAccountId: brokerAccount.id,
      buyingPower: 81400,
      currency: "USD",
      grossPositionValue: 7000,
      netLiquidation: 120000,
      realizedPnl: 18000,
      settledCash: 81400,
      snapshotTime: brokerSnapshotTime,
      source: "V1_7_ACCEPTANCE_READONLY",
      syncJobId: brokerSyncJob.id,
      totalCash: 81400,
      unrealizedPnl: -6000,
    },
  });
  await prisma.brokerCashBalance.upsert({
    where: {
      brokerAccountId_currency_snapshotTime: {
        brokerAccountId: brokerAccount.id,
        currency: "USD",
        snapshotTime: brokerSnapshotTime,
      },
    },
    update: {},
    create: {
      availableCash: 81400,
      brokerAccountId: brokerAccount.id,
      currency: "USD",
      settledCash: 81400,
      snapshotTime: brokerSnapshotTime,
      syncJobId: brokerSyncJob.id,
      totalCash: 81400,
    },
  });
  for (const [symbol, quantity, avgCost, currentPrice] of positions) {
    const instrumentId = instrumentIds.get(symbol);
    if (!instrumentId) throw new Error(`Seed instrument missing: ${symbol}`);
    await prisma.brokerPositionSnapshot.upsert({
      where: {
        brokerAccountId_symbol_snapshotTime: {
          brokerAccountId: brokerAccount.id,
          snapshotTime: brokerSnapshotTime,
          symbol,
        },
      },
      update: {},
      create: {
        averageCost: avgCost,
        brokerAccountId: brokerAccount.id,
        currency: "USD",
        externalContractId: `ACCEPTANCE-${symbol}`,
        instrumentId,
        marketPrice: currentPrice,
        marketValue: quantity * currentPrice,
        quantity,
        snapshotTime: brokerSnapshotTime,
        symbol,
        syncJobId: brokerSyncJob.id,
        unrealizedPnl: (currentPrice - avgCost) * quantity,
      },
    });
  }
  const reconciliationRun = await prisma.accountReconciliationRun.upsert({
    where: { id: "broker-reconciliation-v1-7-acceptance" },
    update: {},
    create: {
      id: "broker-reconciliation-v1-7-acceptance",
      brokerAccountId: brokerAccount.id,
      brokerSnapshotTime,
      completedAt: new Date("2026-07-17T12:00:10.000Z"),
      differenceCount: 0,
      localAccountId: account.id,
      localSnapshotTime: new Date("2026-07-17T12:00:00.000Z"),
      startedAt: new Date("2026-07-17T12:00:06.000Z"),
      status: "MATCHED",
      summaryJson: JSON.stringify({
        acceptanceSnapshot: true,
        note: "仅用于验证只读数据与当前真实账户基线一致",
      }),
    },
  });
  const shadowSession = await prisma.shadowTradingSession.upsert({
    where: { idempotencyKey: "SHADOW_SESSION:V1_7_DLA2_RISK_REJECTION" },
    update: {},
    create: {
      id: "shadow-session-v1-7-dla2-rejected",
      brokerAccountId: brokerAccount.id,
      brokerSnapshotTime,
      currentCash: 81400,
      currentEquity: 120000,
      idempotencyKey: "SHADOW_SESSION:V1_7_DLA2_RISK_REJECTION",
      initialCash: 81400,
      initialEquity: 120000,
      localAccountId: account.id,
      startedAt: new Date("2026-07-17T13:00:00.000Z"),
      status: "RISK_REJECTED",
    },
  });
  const shadowSignal = await prisma.shadowSignal.upsert({
    where: { idempotencyKey: "SHADOW_SIGNAL:V1_7_DLA2_RISK_REJECTION" },
    update: {},
    create: {
      id: "shadow-signal-v1-7-dla2-rejected",
      idempotencyKey: "SHADOW_SIGNAL:V1_7_DLA2_RISK_REJECTION",
      quantity: 10,
      referencePrice: 150,
      riskDecisionJson: JSON.stringify({
        approved: false,
        currentLeveragedEtfPercent: 12.5,
        reason: "杠杆 ETF 总仓位已超过 10%，RiskEngine 默认拒绝 DLA2 影子买入",
      }),
      shadowSessionId: shadowSession.id,
      side: "BUY",
      signalDate: new Date("2026-07-17T13:00:00.000Z"),
      status: "RISK_REJECTED",
      symbol: "DLA2",
    },
  });
  await prisma.shadowOrderIntent.upsert({
    where: { idempotencyKey: "SHADOW_INTENT:V1_7_DLA2_RISK_REJECTION" },
    update: {},
    create: {
      idempotencyKey: "SHADOW_INTENT:V1_7_DLA2_RISK_REJECTION",
      portfolioRiskJson: JSON.stringify({ approved: false, reason: "现有杠杆暴露超限" }),
      quantity: 10,
      rejectionReason: "SYNTHETIC RiskEngine 拒绝：当前杠杆 ETF 仓位 12.5% 超过 10% 上限",
      shadowSessionId: shadowSession.id,
      shadowSignalId: shadowSignal.id,
      side: "BUY",
      singleRiskJson: JSON.stringify({ approved: false, overallRiskLevel: "VIOLATION" }),
      status: "RISK_REJECTED",
      symbol: "DLA2",
      theoreticalOrderAt: new Date("2026-07-17T13:00:00.000Z"),
      theoreticalPrice: 150,
    },
  });
  for (const audit of [
    {
      id: "broker-audit-v1-7-sync",
      eventType: "BROKER_SYNC_PERSISTED",
      message: "V1.7 只读验收快照已写入；未连接券商写接口",
      severity: "INFO",
    },
    {
      id: "broker-audit-v1-7-reconciliation",
      eventType: "ACCOUNT_RECONCILIATION_COMPLETED",
      message: "V1.7 验收账户对账完成，当前基线无差异",
      severity: "INFO",
    },
    {
      id: "broker-audit-v1-7-shadow-rejected",
      eventType: "SHADOW_SIGNAL_REJECTED",
      message: "DLA2 影子买入因杠杆 ETF 暴露超限被拒绝；未发送券商请求",
      severity: "DANGER",
    },
  ]) {
    await prisma.brokerAuditLog.upsert({
      where: { id: audit.id },
      update: {},
      create: {
        ...audit,
        brokerAccountId: brokerAccount.id,
        brokerConnectionId: brokerConnection.id,
        detailsJson: JSON.stringify({
          acceptance: true,
          brokerWrites: 0,
          credentialsStored: false,
        }),
        reconciliationRunId:
          audit.eventType === "ACCOUNT_RECONCILIATION_COMPLETED" ? reconciliationRun.id : undefined,
        shadowTradingSessionId:
          audit.eventType === "SHADOW_SIGNAL_REJECTED" ? shadowSession.id : undefined,
        syncJobId: audit.eventType === "BROKER_SYNC_PERSISTED" ? brokerSyncJob.id : undefined,
      },
    });
  }
  await prisma.systemNotification.upsert({
    where: { dedupeKey: "BROKER_DATA_STALE:V1_7_ACCEPTANCE" },
    update: {},
    create: {
      dedupeKey: "BROKER_DATA_STALE:V1_7_ACCEPTANCE",
      message: "当前展示的是历史只读验收快照；Broker Connector 默认 OFFLINE。",
      severity: "WARNING",
      title: "IBKR 只读数据已过期",
      type: "BROKER_DATA_STALE",
    },
  });

  // V1.8 仅增加明确标注为 FIXTURE 的 IBKR Paper 专用验收账本；不代表已连接真实 IBKR Paper 网关。
  const paperAccountHash = createHash("sha256")
    .update("V1_8_FIXTURE_PAPER_ACCOUNT_REFERENCE")
    .digest("hex");
  const paperSyncJob = await prisma.brokerSyncJob.upsert({
    where: { idempotencyKey: "BROKER_SYNC:V1_8_PAPER_FIXTURE" },
    update: {},
    create: {
      id: "broker-sync-v1-8-paper-fixture",
      accountCount: 1,
      brokerConnectionId: brokerConnection.id,
      completedAt: new Date("2026-07-17T14:00:05.000Z"),
      idempotencyKey: "BROKER_SYNC:V1_8_PAPER_FIXTURE",
      requestedFrom: new Date("2026-07-17T14:00:00.000Z"),
      requestedTo: new Date("2026-07-17T14:00:00.000Z"),
      resultJson: JSON.stringify({
        externalBrokerSubmission: false,
        source: "V1_8_ACCEPTANCE_FIXTURE",
      }),
      snapshotCount: 1,
      startedAt: new Date("2026-07-17T14:00:00.000Z"),
      status: "COMPLETED",
    },
  });
  const paperBrokerAccount = await prisma.brokerAccount.upsert({
    where: {
      brokerConnectionId_externalAccountId: {
        brokerConnectionId: brokerConnection.id,
        externalAccountId: paperAccountHash,
      },
    },
    update: {},
    create: {
      dataOrigin: "DEMO",
      id: "broker-account-v1-8-paper-fixture",
      accountType: "PAPER",
      baseCurrency: "USD",
      brokerConnectionId: brokerConnection.id,
      externalAccountId: paperAccountHash,
      lastSyncedAt: new Date("2026-07-17T14:00:00.000Z"),
      localAccountId: null,
      maskedAccountNumber: "DU****801",
      status: "FIXTURE_STALE",
    },
  });
  const brokerPaperSnapshotTime = new Date("2026-07-17T14:00:00.000Z");
  await prisma.brokerAccountSnapshot.upsert({
    where: {
      brokerAccountId_snapshotTime: {
        brokerAccountId: paperBrokerAccount.id,
        snapshotTime: brokerPaperSnapshotTime,
      },
    },
    update: {},
    create: {
      availableFunds: 100000,
      brokerAccountId: paperBrokerAccount.id,
      buyingPower: 100000,
      currency: "USD",
      grossPositionValue: 0,
      netLiquidation: 100000,
      realizedPnl: 0,
      settledCash: 100000,
      snapshotTime: brokerPaperSnapshotTime,
      source: "V1_8_ACCEPTANCE_FIXTURE_NOT_EXTERNAL",
      syncJobId: paperSyncJob.id,
      totalCash: 100000,
      unrealizedPnl: 0,
    },
  });
  await prisma.brokerCashBalance.upsert({
    where: {
      brokerAccountId_currency_snapshotTime: {
        brokerAccountId: paperBrokerAccount.id,
        currency: "USD",
        snapshotTime: brokerPaperSnapshotTime,
      },
    },
    update: {},
    create: {
      availableCash: 100000,
      brokerAccountId: paperBrokerAccount.id,
      currency: "USD",
      settledCash: 100000,
      snapshotTime: brokerPaperSnapshotTime,
      syncJobId: paperSyncJob.id,
      totalCash: 100000,
    },
  });
  await prisma.brokerExecutionControl.upsert({
    where: { id: "broker-paper-execution-global" },
    update: {},
    create: {
      id: "broker-paper-execution-global",
      killSwitchLevel: "LEVEL_0_NORMAL",
      reason: "V1.8 默认不启用 IBKR Paper 提交",
      safetyState: "READ_ONLY",
    },
  });
  const aaplStrategy = await prisma.strategy.findUnique({ where: { code: "BUY_AND_HOLD_AAPL" } });
  if (!aaplStrategy) throw new Error("V1.8 Seed strategy missing: BUY_AND_HOLD_AAPL");
  const aaplPortfolioMember = await prisma.portfolioStrategy.findUnique({
    where: {
      portfolioId_strategyId: {
        portfolioId: portfolio.id,
        strategyId: aaplStrategy.id,
      },
    },
  });
  if (!aaplPortfolioMember)
    throw new Error("V1.8 Seed portfolio member missing: BUY_AND_HOLD_AAPL");
  const aaplDeployment = await prisma.strategyDeployment.findFirst({
    where: { strategyId: aaplStrategy.id },
    orderBy: { createdAt: "asc" },
  });
  if (!aaplDeployment) throw new Error("V1.8 Seed deployment missing: BUY_AND_HOLD_AAPL");
  const paperRiskDecision = await prisma.paperRiskDecision.upsert({
    where: { id: "paper-risk-v1-8-aapl-fixture" },
    update: {},
    create: {
      id: "paper-risk-v1-8-aapl-fixture",
      decision: "APPROVED",
      engineVersion: "v1.8",
      inputSnapshotJson: JSON.stringify({
        accountType: "PAPER",
        initialCapital: 100000,
        source: "V1_8_ACCEPTANCE_FIXTURE",
        symbol: "AAPL",
      }),
      resultJson: JSON.stringify({ approved: true, projectedPositionPercent: 2.2 }),
      strategyDeploymentId: aaplDeployment.id,
      violationsJson: JSON.stringify([]),
    },
  });
  const portfolioRiskRun = await prisma.portfolioRebalanceRun.upsert({
    where: { id: "portfolio-risk-v1-8-aapl-fixture" },
    update: {
      rawSignalsJson: JSON.stringify([
        {
          id: "raw-signal-v1-8-aapl-fixture",
          portfolioStrategyId: aaplPortfolioMember.id,
          priority: aaplPortfolioMember.priority,
          quantity: 10,
          side: "BUY",
          symbol: "AAPL",
        },
      ]),
    },
    create: {
      id: "portfolio-risk-v1-8-aapl-fixture",
      afterAllocationJson: JSON.stringify({ AAPL: 2.2, cash: 97.8 }),
      allocationVersion: 1,
      beforeAllocationJson: JSON.stringify({ cash: 100 }),
      conflictPolicy: "NETTING",
      estimatedCash: 97800,
      estimatedCommission: 1,
      estimatedOrdersJson: JSON.stringify([{ quantity: 10, side: "BUY", symbol: "AAPL" }]),
      idempotencyKey: "PORTFOLIO_RISK:V1_8_AAPL_FIXTURE",
      netIntentsJson: JSON.stringify([{ quantity: 10, side: "BUY", symbol: "AAPL" }]),
      portfolioId: portfolio.id,
      previewOnly: true,
      rawSignalsJson: JSON.stringify([
        {
          id: "raw-signal-v1-8-aapl-fixture",
          portfolioStrategyId: aaplPortfolioMember.id,
          priority: aaplPortfolioMember.priority,
          quantity: 10,
          side: "BUY",
          symbol: "AAPL",
        },
      ]),
      riskResultJson: JSON.stringify({ allowed: true, violations: [] }),
      riskVersion: 1,
      runType: "EXECUTION_GUARD_FIXTURE",
      status: "PREVIEWED",
      tradeDate: new Date("2026-07-17T00:00:00.000Z"),
    },
  });
  const fixtureSnapshot = {
    accountType: "PAPER",
    allowPartialFill: true,
    brokerAccountId: paperBrokerAccount.id,
    contractId: "AAPL-FIXTURE-CONTRACT",
    estimatedCashAfter: 97799,
    estimatedCommission: 1,
    estimatedValue: 2200,
    externalBrokerSubmission: false,
    limitPrice: 220,
    maxSlippage: 0.5,
    orderType: "LIMIT",
    outsideRth: false,
    portfolioRiskApproved: true,
    quantity: 10,
    riskApproved: true,
    side: "BUY",
    source: "V1_8_ACCEPTANCE_FIXTURE_NOT_EXTERNAL",
    strategyId: aaplStrategy.id,
    symbol: "AAPL",
    timeInForce: "DAY",
  };
  const fixtureProposalHash = createHash("sha256")
    .update(JSON.stringify(fixtureSnapshot))
    .digest("hex");
  const fixtureProposal = await prisma.brokerOrderProposal.upsert({
    where: { idempotencyKey: "BROKER_PAPER_PROPOSAL:V1_8_AAPL_FIXTURE:1" },
    update: {},
    create: {
      id: "broker-proposal-v1-8-aapl-fixture",
      allowPartialFill: true,
      brokerAccountId: paperBrokerAccount.id,
      contractId: "AAPL-FIXTURE-CONTRACT",
      correlationId: createHash("sha256").update("V1_8_AAPL_FIXTURE_CORRELATION").digest("hex"),
      estimatedCommission: 1,
      estimatedValue: 2200,
      expirationTime: new Date("2026-07-18T14:00:00.000Z"),
      expiresAt: new Date("2026-07-18T14:00:00.000Z"),
      idempotencyKey: "BROKER_PAPER_PROPOSAL:V1_8_AAPL_FIXTURE:1",
      limitPrice: 220,
      maxSlippage: 0.5,
      orderType: "LIMIT",
      outsideRth: false,
      portfolioId: portfolio.id,
      portfolioRiskDecisionId: portfolioRiskRun.id,
      proposalHash: fixtureProposalHash,
      proposalSnapshotJson: JSON.stringify(fixtureSnapshot),
      proposalVersion: 1,
      quantity: 10,
      riskDecisionId: paperRiskDecision.id,
      side: "BUY",
      status: "SUBMITTED_TO_PAPER",
      strategyDeploymentId: aaplDeployment.id,
      strategyId: aaplStrategy.id,
      strategyVersion: String(aaplStrategy.version),
      symbol: "AAPL",
      timeInForce: "DAY",
    },
  });
  await prisma.brokerOrderApproval.upsert({
    where: { id: "broker-approval-v1-8-aapl-fixture" },
    update: {},
    create: {
      id: "broker-approval-v1-8-aapl-fixture",
      actorId: "fixture-operator",
      approvedAt: new Date("2026-07-17T14:01:00.000Z"),
      confirmationHash: createHash("sha256").update("APPROVE IBKR PAPER AAPL").digest("hex"),
      decision: "APPROVE",
      expiresAt: new Date("2026-07-18T14:00:00.000Z"),
      proposalId: fixtureProposal.id,
      proposalSnapshotHash: fixtureProposalHash,
      reason: "V1.8 本地 Fixture 验证审批链；未向 IBKR 发送请求",
    },
  });
  await prisma.executionGuardDecision.upsert({
    where: { id: "execution-guard-v1-8-aapl-fixture" },
    update: {},
    create: {
      id: "execution-guard-v1-8-aapl-fixture",
      accountSnapshotTime: brokerPaperSnapshotTime,
      checksJson: JSON.stringify({
        acceptanceFixture: true,
        externalBrokerSubmission: false,
        passed: 20,
      }),
      correlationId: fixtureProposal.correlationId,
      decision: "APPROVED_FIXTURE_ONLY",
      marketDataTime: new Date("2026-07-16T00:00:00.000Z"),
      proposalId: fixtureProposal.id,
      reason: "仅验证本地门禁、幂等与账本；真实 IBKR Paper 仍需用户配置",
    },
  });
  const fixturePaperOrder = await prisma.brokerPaperOrder.upsert({
    where: { idempotencyKey: "BROKER_PAPER_ORDER:V1_8_AAPL_FIXTURE" },
    update: {},
    create: {
      id: "broker-paper-order-v1-8-aapl-fixture",
      allowPartialFill: true,
      averageFillPrice: 219.75,
      brokerAccountId: paperBrokerAccount.id,
      correlationId: fixtureProposal.correlationId,
      externalOrderId: "FIXTURE-PAPER-ORDER-001",
      externalPermanentId: "FIXTURE-PERM-001",
      filledQuantity: 10,
      idempotencyKey: "BROKER_PAPER_ORDER:V1_8_AAPL_FIXTURE",
      lastFillPrice: 220,
      latestStatusAt: new Date("2026-07-17T14:04:00.000Z"),
      limitPrice: 220,
      orderType: "LIMIT",
      outsideRth: false,
      proposalId: fixtureProposal.id,
      quantity: 10,
      remainingQuantity: 0,
      side: "BUY",
      status: "FILLED",
      submittedAt: new Date("2026-07-17T14:02:00.000Z"),
      submissionAttempt: 1,
      symbol: "AAPL",
      timeInForce: "DAY",
    },
  });
  for (const [id, status, filled, remaining, eventTime] of [
    ["paper-event-v1-8-submitted", "SUBMITTED", 0, 10, "2026-07-17T14:02:00.000Z"],
    ["paper-event-v1-8-partial", "PARTIALLY_FILLED", 4, 6, "2026-07-17T14:03:00.000Z"],
    ["paper-event-v1-8-filled", "FILLED", 10, 0, "2026-07-17T14:04:00.000Z"],
  ] as const) {
    await prisma.brokerPaperOrderEvent.upsert({
      where: { id },
      update: {},
      create: {
        id,
        averageFillPrice:
          status === "FILLED" ? 219.75 : status === "PARTIALLY_FILLED" ? 219.375 : null,
        brokerPaperOrderId: fixturePaperOrder.id,
        connectorVersion: "1.8.0-fixture",
        correlationId: fixtureProposal.correlationId,
        eventTime: new Date(eventTime),
        externalOrderId: "FIXTURE-PAPER-ORDER-001",
        externalPermanentId: "FIXTURE-PERM-001",
        filledQuantity: filled,
        lastFillPrice: status === "FILLED" ? 220 : status === "PARTIALLY_FILLED" ? 219.375 : null,
        rawDataHash: createHash("sha256").update(`${id}:${status}`).digest("hex"),
        reason: "本地 Fixture 生命周期事件，不是 IBKR 实际回报",
        remainingQuantity: remaining,
        status,
      },
    });
  }
  for (const [id, externalExecutionId, quantity, price, time] of [
    ["paper-execution-v1-8-1", "FIXTURE-EXEC-001", 4, 219.375, "2026-07-17T14:03:00.000Z"],
    ["paper-execution-v1-8-2", "FIXTURE-EXEC-002", 6, 220, "2026-07-17T14:04:00.000Z"],
  ] as const) {
    const execution = await prisma.brokerPaperExecution.upsert({
      where: { deduplicationKey: createHash("sha256").update(externalExecutionId).digest("hex") },
      update: {},
      create: {
        id,
        brokerPaperOrderId: fixturePaperOrder.id,
        correlationId: fixtureProposal.correlationId,
        currency: "USD",
        deduplicationKey: createHash("sha256").update(externalExecutionId).digest("hex"),
        exchange: "FIXTURE",
        executionTime: new Date(time),
        externalExecutionId,
        price,
        quantity,
        rawDataHash: createHash("sha256")
          .update(`${externalExecutionId}:${quantity}:${price}`)
          .digest("hex"),
        side: "BUY",
        symbol: "AAPL",
      },
    });
    await prisma.brokerPaperCommission.upsert({
      where: {
        deduplicationKey: createHash("sha256")
          .update(`COMMISSION:${externalExecutionId}`)
          .digest("hex"),
      },
      update: {},
      create: {
        amount: quantity === 4 ? 0.4 : 0.6,
        brokerPaperExecutionId: execution.id,
        correlationId: fixtureProposal.correlationId,
        currency: "USD",
        deduplicationKey: createHash("sha256")
          .update(`COMMISSION:${externalExecutionId}`)
          .digest("hex"),
        externalReportId: `FIXTURE-COMMISSION-${externalExecutionId}`,
        rawDataHash: createHash("sha256")
          .update(`COMMISSION-RAW:${externalExecutionId}`)
          .digest("hex"),
        reportTime: new Date(time),
      },
    });
  }
  const paperReconciliation = await prisma.brokerPaperReconciliationRun.upsert({
    where: { id: "paper-reconciliation-v1-8-fixture" },
    update: {},
    create: {
      id: "paper-reconciliation-v1-8-fixture",
      brokerAccountId: paperBrokerAccount.id,
      brokerPaperOrderId: fixturePaperOrder.id,
      completedAt: new Date("2026-07-17T14:05:00.000Z"),
      correlationId: fixtureProposal.correlationId,
      criticalDifferenceCount: 0,
      differenceCount: 0,
      startedAt: new Date("2026-07-17T14:04:30.000Z"),
      status: "MATCHED_FIXTURE",
      summaryJson: JSON.stringify({
        commission: 1,
        externalBrokerSubmission: false,
        filledQuantity: 10,
        source: "V1_8_ACCEPTANCE_FIXTURE",
      }),
    },
  });
  await prisma.executionIncident.upsert({
    where: { id: "execution-incident-v1-8-live-rejected" },
    update: {},
    create: {
      id: "execution-incident-v1-8-live-rejected",
      brokerAccountId: brokerAccount.id,
      correlationId: createHash("sha256").update("V1_8_LIVE_REJECTION").digest("hex"),
      impact: "非 PAPER 账户请求在 Connector 边界被拒绝，未产生券商请求",
      incidentType: "PAPER_ENVIRONMENT_MISMATCH",
      occurredAt: new Date("2026-07-17T14:06:00.000Z"),
      rootCause: "验收测试尝试使用 READ_ONLY_LIVE 账户引用",
      severity: "CRITICAL",
      status: "RESOLVED",
      actionTaken: "默认拒绝并保持 Live 写能力为 false",
      resolvedAt: new Date("2026-07-17T14:06:01.000Z"),
    },
  });
  await prisma.backupRecoveryRun.upsert({
    where: { id: "backup-recovery-v1-8-script-verification" },
    update: {},
    create: {
      id: "backup-recovery-v1-8-script-verification",
      actorId: "system-fixture",
      completedAt: new Date("2026-07-17T14:07:00.000Z"),
      operation: "VERIFY",
      startedAt: new Date("2026-07-17T14:07:00.000Z"),
      status: "VERIFIED",
      targetDatabase: "XichuQuantRestoreTest",
      verificationJson: JSON.stringify({
        migrationCount: 9,
        note: "脚本结构验收；实际恢复演练需 SQL Server 文件系统授权",
      }),
    },
  });
  await prisma.brokerAuditLog.upsert({
    where: { id: "broker-audit-v1-8-paper-fixture" },
    update: {},
    create: {
      id: "broker-audit-v1-8-paper-fixture",
      actorId: "system-fixture",
      brokerAccountId: paperBrokerAccount.id,
      brokerConnectionId: brokerConnection.id,
      detailsJson: JSON.stringify({
        correlationId: fixtureProposal.correlationId,
        externalBrokerSubmission: false,
        paperOnly: true,
        reconciliationRunId: paperReconciliation.id,
      }),
      eventType: "V1_8_PAPER_FIXTURE_ACCEPTANCE",
      message: "V1.8 Paper 专用账本 Fixture 已建立；未调用任何外部券商接口",
      severity: "INFO",
    },
  });

  const equitySnapshots = [
    ["2026-01-02", 108000, 108000, 0, "SYNTHETIC 起始权益"],
    ["2026-03-16", 114500, 114500, 6500, "SYNTHETIC 账本快照"],
    ["2026-05-08", 126000, 126000, 18000, "SYNTHETIC 权益峰值"],
    ["2026-07-17", 120000, 81400, 18000, "SYNTHETIC 回撤快照"],
  ] as const;

  for (const [date, totalEquity, cashBalance, realizedPnlYtd, note] of equitySnapshots) {
    const snapshotDate = new Date(`${date}T00:00:00.000Z`);
    await prisma.accountEquitySnapshot.upsert({
      where: { accountId_snapshotDate: { accountId: account.id, snapshotDate } },
      update: {},
      create: {
        id: `equity-${date}`,
        accountId: account.id,
        snapshotDate,
        totalEquity,
        cashBalance,
        realizedPnlYtd,
        note,
      },
    });
  }

  const seedTrades = [
    ["trade-1", "DLA2", "2024-02-05", 60, 200, 12000, "FOMO", false],
    ["trade-2", "DLB2", "2024-02-12", 100, 90, 9000, "REVENGE", false],
    ["trade-current-dla2", "DLA2", "2026-07-05", 60, 200, 12000, "FOMO", false],
    ["trade-current-dlb2", "DLB2", "2026-07-05", 100, 90, 9000, "REVENGE", false],
    ["trade-current-qqqm", "QQQM", "2026-07-05", 40, 320, 12800, "DISCIPLINED", true],
    ["trade-3", "VOO", "2026-07-05", 12, 500, 6000, "DISCIPLINED", true],
    ["trade-current-aapl", "AAPL", "2026-07-05", 30, 160, 4800, "DISCIPLINED", true],
  ] as const;

  for (const [
    id,
    symbol,
    tradeDate,
    quantity,
    price,
    amount,
    emotionTag,
    isRuleFollowed,
  ] of seedTrades) {
    const instrumentId = instrumentIds.get(symbol);
    if (!instrumentId) throw new Error(`Seed instrument missing: ${symbol}`);
    await prisma.trade.upsert({
      where: { id },
      update: {},
      create: {
        id,
        accountId: account.id,
        instrumentId,
        tradeDate: new Date(`${tradeDate}T12:00:00.000Z`),
        side: "BUY",
        quantity,
        price,
        amount,
        emotionTag,
        isRuleFollowed,
      },
    });
  }

  for (const [symbol, date, price, low, high, splitFactor] of [
    ["DLA2", "2024-02-05", 200, 195, 210, 1],
    ["DLA2", "2024-03-15", 150, 100, 160, 1],
    ["DLB2", "2024-02-12", 90, 85, 99, 1],
    ["DLB2", "2024-02-20", 45, 40, 49, 2],
    ["DLB2", "2024-03-15", 30, 20, 35, 1],
  ] as const) {
    const tradeDate = new Date(`${date}T00:00:00Z`);
    await prisma.marketDataDaily.upsert({ where: { symbol_tradeDate_source: { symbol, tradeDate, source: "SEED_V1_3" } },
      update: { open: price, high, low, close: price, adjustedClose: price, splitFactor, dataOrigin: "SYNTHETIC" },
      create: { symbol, tradeDate, source: "SEED_V1_3", providerId: seedProvider.id, dataOrigin: "SYNTHETIC", open: price, high, low, close: price, adjustedClose: price, volume: 1000, splitFactor },
    });
  }
  for (const [symbol, quantity, price, realizedPnl] of [["DLA2", 60, 150, -3000], ["DLB2", 200, 30, -3000]] as const) {
    await prisma.trade.create({ data: { id: `demo-exit-${symbol}`, accountId: account.id, instrumentId: instrumentIds.get(symbol)!, tradeDate: new Date("2024-03-16T12:00:00Z"), side: "SELL", quantity, price, amount: quantity * price, realizedPnl, commission: 0, isRuleFollowed: false } });
  }
  // Separate fictional episodes: the closed 2024 replay is not the current 2026 portfolio.
  for (const [id, date, side, price, realizedPnl] of [
    ["demo-win-one-entry", "2026-03-15", "BUY", 100, null],
    ["demo-win-one-exit", "2026-03-16", "SELL", 165, 6500],
    ["demo-win-two-entry", "2026-05-07", "BUY", 100, null],
    ["demo-win-two-exit", "2026-05-08", "SELL", 215, 11500],
  ] as const) {
    await prisma.trade.create({ data: { id, accountId: account.id, instrumentId: instrumentIds.get("AAPL")!, tradeDate: new Date(`${date}T12:00:00Z`), side, quantity: 100, price, amount: 100 * price, realizedPnl, commission: 0, reason: "SYNTHETIC fictional accounting episode", isRuleFollowed: true } });
  }

  await prisma.reviewNote.upsert({
    where: { id: "review-seed" },
    update: {},
    create: {
      id: "review-seed",
      title: "存储杠杆 ETF 超仓复盘",
      symbol: "DLA2 / DLB2",
      mistakeType: "LEVERAGED_ETF_ABUSE",
      summary: "DLA2 与 DLB2 同属存储主题，叠加杠杆后造成风险集中。",
      lesson: "杠杆产品不能用补仓代替止损，机会仓不能做成主仓。",
      actionRule: "任何杠杆 ETF 总仓位不得超过账户资产的 10%。",
    },
  });

  await seedMarketResearch();
  await prisma.account.update({ where: { id: account.id }, data: { note: "DEMO_SEED_COMPLETE_V1_11" } });

  console.log(
    `Seed complete: account=${account.name}, instruments=${instruments.length}, positions=${positions.length}, rules=${riskRules.length}, strategies=${strategySeeds.length}, portfolios=${await prisma.strategyPortfolio.count()}, brokerAccounts=${await prisma.brokerAccount.count()}, marketData=${await prisma.marketDataDaily.count({ where: { source: "SEED_V1_3" } })}, marketResearchSources=${await prisma.marketResearchSource.count()}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
