import { Injectable } from "@nestjs/common";

import type {
  PositionRiskView,
  RiskAccountInput,
  RiskAlertView,
  RiskLevel,
  RiskPositionInput,
  RiskRuleInput,
  RiskSummary,
} from "./risk.types";
import { calculateEffectiveExposure } from "../risk-discipline/risk-discipline.rules";

const DEFAULT_LIMITS = {
  ANNUAL_PROFIT_PROTECTION: 50,
  LEVERAGED_ETF_LOSS_DANGER: -15,
  LEVERAGED_ETF_SINGLE_MAX: 5,
  LEVERAGED_ETF_TOTAL_MAX: 10,
  RISK_THEME_EFFECTIVE_GROSS_MAX_PCT: 30,
  SINGLE_STOCK_MAX: 15,
  STORAGE_THEME_MAX: 15,
} as const;

const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  WARNING: 2,
  DANGER: 3,
  VIOLATION: 4,
};

function percent(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function highestRisk(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>(
    (highest, current) => (RISK_ORDER[current] > RISK_ORDER[highest] ? current : highest),
    "LOW",
  );
}

@Injectable()
export class RiskEngineService {
  evaluate(
    account: RiskAccountInput,
    rawPositions: RiskPositionInput[],
    rules: RiskRuleInput[],
  ): RiskSummary {
    const limits = this.buildLimits(rules);
    const positions = rawPositions.map((position) =>
      this.calculatePosition(account, position, limits),
    );
    const exposure = calculateEffectiveExposure(
      account.totalEquity,
      positions.map((position) => ({
        direction: position.direction ?? "LONG",
        industry: position.industry ?? position.category,
        leveragedETF: position.leveragedETF ?? position.assetType === "LEVERAGED_ETF",
        leverageMultiplier: position.leverageMultiplier ?? 1,
        marketValue: position.marketValue,
        riskTheme: position.riskTheme ?? position.theme,
        sector: position.sector ?? position.category,
        symbol: position.symbol,
        underlyingSymbol: position.underlyingSymbol ?? position.symbol,
      })),
    );
    const positionValue = positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
    const leveragedEtfValue = this.sumMarketValue(
      positions.filter(
        (position) => position.leveragedETF ?? position.assetType === "LEVERAGED_ETF",
      ),
    );
    const storageThemeValue = this.sumMarketValue(
      positions.filter((position) => position.theme === "STORAGE"),
    );
    const unrealizedPnlTotal = positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
    const unrealizedLossTotal = Math.abs(
      positions
        .filter((position) => position.unrealizedPnl < 0)
        .reduce((sum, position) => sum + position.unrealizedPnl, 0),
    );
    const leveragedEtfPercent = percent(leveragedEtfValue, account.totalEquity);
    const storageThemePercent = percent(storageThemeValue, account.totalEquity);
    const floatingLossToRealizedProfitPercent =
      account.realizedPnlYtd > 0 ? percent(unrealizedLossTotal, account.realizedPnlYtd) : 0;
    const alerts = this.buildAlerts({
      account,
      exposureByRiskTheme: exposure.byRiskTheme,
      floatingLossToRealizedProfitPercent,
      leveragedEtfPercent,
      limits,
      positions,
      storageThemePercent,
    });

    return {
      accountId: account.id,
      accountName: account.name,
      totalEquity: account.totalEquity,
      cashBalance: account.cashBalance,
      cashPercent: percent(account.cashBalance, account.totalEquity),
      positionValue,
      positionPercent: percent(positionValue, account.totalEquity),
      leveragedEtfValue,
      leveragedEtfPercent,
      grossEffectiveExposure: exposure.grossEffectiveExposure,
      grossEffectiveExposurePercent: exposure.grossEffectiveExposurePct,
      netDirectionalExposure: exposure.netDirectionalExposure,
      netDirectionalExposurePercent: exposure.netDirectionalExposurePct,
      exposureBySymbol: exposure.bySymbol,
      exposureByUnderlying: exposure.byUnderlying,
      exposureByIndustry: exposure.byIndustry,
      exposureBySector: exposure.bySector,
      exposureByRiskTheme: exposure.byRiskTheme,
      maxRiskThemeEffectiveExposurePercent: Math.max(
        0,
        ...exposure.byRiskTheme.map((item) => item.grossEffectiveExposurePct),
      ),
      maxSinglePositionPercent: Math.max(
        0,
        ...positions.map((position) => position.positionPercent),
      ),
      storageThemeValue,
      storageThemePercent,
      unrealizedPnlTotal,
      unrealizedLossTotal,
      realizedPnlYtd: account.realizedPnlYtd,
      annualNetPnl: account.realizedPnlYtd + unrealizedPnlTotal,
      floatingLossToRealizedProfitPercent,
      overallRiskLevel: highestRisk(alerts.map((alert) => alert.level)),
      messages:
        account.realizedPnlYtd > 0
          ? alerts.map((alert) => alert.message)
          : [
              "当前没有年度已实现利润缓冲，请严格控制新增风险。",
              ...alerts.map((alert) => alert.message),
            ],
      alerts,
      positions,
    };
  }

  private buildLimits(rules: RiskRuleInput[]): Record<string, number> {
    const limits: Record<string, number> = { ...DEFAULT_LIMITS };
    for (const rule of rules) {
      if (rule.enabled) limits[rule.code] = rule.limitValue;
    }
    return limits;
  }

  private calculatePosition(
    account: RiskAccountInput,
    position: RiskPositionInput,
    limits: Record<string, number>,
  ): PositionRiskView {
    const costAmount = Math.abs(position.quantity) * position.avgCost;
    const marketValue = position.quantity * position.currentPrice;
    const unrealizedPnl = position.quantity * (position.currentPrice - position.avgCost);
    const unrealizedPnlPercent = percent(unrealizedPnl, costAmount);
    const positionPercent = percent(Math.abs(marketValue), account.totalEquity);
    const effectiveExposure = Math.abs(
      marketValue * (position.leverageMultiplier ?? 1),
    );
    const effectiveExposurePercent = percent(effectiveExposure, account.totalEquity);
    let riskLevel: RiskLevel = "LOW";
    let suggestedAction = "维持纪律，按计划跟踪。";

    if (
      position.assetType === "LEVERAGED_ETF" &&
      (unrealizedPnlPercent <= limits.LEVERAGED_ETF_LOSS_DANGER! ||
        positionPercent > limits.LEVERAGED_ETF_SINGLE_MAX!)
    ) {
      riskLevel = "DANGER";
      suggestedAction = "禁止补仓，优先降低杠杆 ETF 仓位。";
    } else if (position.assetType === "STOCK") {
      riskLevel = positionPercent > limits.SINGLE_STOCK_MAX! ? "WARNING" : "MEDIUM";
      suggestedAction =
        riskLevel === "WARNING"
          ? "单只股票仓位超限，停止加仓并降低集中度。"
          : "维持观察，新增仓位前重新审查集中度。";
    }

    return {
      ...position,
      costAmount,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      positionPercent,
      effectiveExposure,
      effectiveExposurePercent,
      riskLevel,
      suggestedAction,
    };
  }

  private buildAlerts(input: {
    account: RiskAccountInput;
    exposureByRiskTheme: import("../risk-discipline/risk-discipline.types").ExposureBucket[];
    floatingLossToRealizedProfitPercent: number;
    leveragedEtfPercent: number;
    limits: Record<string, number>;
    positions: PositionRiskView[];
    storageThemePercent: number;
  }): RiskAlertView[] {
    const { account, floatingLossToRealizedProfitPercent, leveragedEtfPercent, limits, positions } =
      input;
    const alerts: RiskAlertView[] = [];

    for (const theme of input.exposureByRiskTheme.filter(
      (item) => item.grossEffectiveExposurePct > limits.RISK_THEME_EFFECTIVE_GROSS_MAX_PCT!,
    )) {
      alerts.push({
        code: `RISK_THEME_EFFECTIVE_GROSS_MAX_${theme.key}`,
        level: "VIOLATION",
        title: `${theme.key} 主题有效总敞口超限`,
        message: `${theme.symbols.join(" / ")} 合并后的 Gross Effective Exposure 为 ${theme.grossEffectiveExposurePct.toFixed(2)}%，多空对冲不得抵消 Gross。`,
        currentValue: theme.grossEffectiveExposurePct,
        limitValue: limits.RISK_THEME_EFFECTIVE_GROSS_MAX_PCT!,
        unit: "PERCENT",
        suggestedAction: "禁止增加同主题风险，先降低有效总敞口。",
      });
    }

    if (leveragedEtfPercent > limits.LEVERAGED_ETF_TOTAL_MAX!) {
      alerts.push({
        code: "LEVERAGED_ETF_TOTAL_MAX",
        level: "VIOLATION",
        title: "严重违纪：杠杆 ETF 总仓位超过 10%",
        message: "MUU 与 SNXX 的杠杆 ETF 合计仓位已经超过系统红线。",
        currentValue: leveragedEtfPercent,
        limitValue: limits.LEVERAGED_ETF_TOTAL_MAX!,
        unit: "PERCENT",
        suggestedAction: "禁止补仓，优先降低超限杠杆 ETF 仓位，保住年度利润。",
      });
    }

    for (const position of positions.filter(
      (item) =>
        item.assetType === "LEVERAGED_ETF" &&
        item.positionPercent > limits.LEVERAGED_ETF_SINGLE_MAX!,
    )) {
      alerts.push({
        code: `LEVERAGED_ETF_SINGLE_MAX_${position.symbol}`,
        level: "DANGER",
        title: `${position.symbol} 单只杠杆 ETF 仓位超限`,
        message: `${position.symbol} 当前仓位超过单只杠杆 ETF ${limits.LEVERAGED_ETF_SINGLE_MAX}% 上限。`,
        symbol: position.symbol,
        currentValue: position.positionPercent,
        limitValue: limits.LEVERAGED_ETF_SINGLE_MAX!,
        unit: "PERCENT",
        suggestedAction: "禁止继续补仓，优先降低单只杠杆 ETF 仓位。",
      });
    }

    if (input.storageThemePercent > limits.STORAGE_THEME_MAX!) {
      alerts.push({
        code: "STORAGE_THEME_MAX",
        level: "DANGER",
        title: "存储主题仓位超过 15%",
        message: "MUU 与 SNXX 同属存储主题，存在方向集中和杠杆叠加风险。",
        currentValue: input.storageThemePercent,
        limitValue: limits.STORAGE_THEME_MAX!,
        unit: "PERCENT",
        suggestedAction: "停止增加存储主题暴露，优先处理高风险持仓。",
      });
    }

    for (const position of positions.filter(
      (item) =>
        item.assetType === "LEVERAGED_ETF" &&
        item.unrealizedPnlPercent <= limits.LEVERAGED_ETF_LOSS_DANGER!,
    )) {
      alerts.push({
        code: `LEVERAGED_ETF_LOSS_DANGER_${position.symbol}`,
        level: "DANGER",
        title: `${position.symbol} 杠杆 ETF 浮亏进入危险区`,
        message: `${position.symbol} 当前浮亏超过 15%，不允许通过补仓摊薄成本。`,
        symbol: position.symbol,
        currentValue: position.unrealizedPnlPercent,
        limitValue: limits.LEVERAGED_ETF_LOSS_DANGER!,
        unit: "PERCENT",
        suggestedAction: "禁止补仓，按既定退出条件处理。",
      });
    }

    if (
      account.realizedPnlYtd > 0 &&
      floatingLossToRealizedProfitPercent >= limits.ANNUAL_PROFIT_PROTECTION! * 0.9
    ) {
      alerts.push({
        code: "ANNUAL_PROFIT_PROTECTION_NEAR",
        level: "DANGER",
        title: "年度利润保护线接近触发",
        message: "当前浮亏已接近吞噬全年已实现利润的一半。",
        currentValue: floatingLossToRealizedProfitPercent,
        limitValue: limits.ANNUAL_PROFIT_PROTECTION!,
        unit: "PERCENT",
        suggestedAction: "停止加仓，优先降低高风险仓位，保护年度利润。",
      });
    }

    return alerts;
  }

  private sumMarketValue(positions: PositionRiskView[]): number {
    return positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
  }
}
