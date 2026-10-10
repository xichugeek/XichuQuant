export type EquityPoint = { time: Date; equity: number };
export type ExternalCashFlow = { time: Date; amount: number };

/** End-of-day time weighted return: a deposit/withdrawal is not trading PnL. */
export function cashFlowAdjustedSeries(points: EquityPoint[], flows: ExternalCashFlow[]) {
  let wealth = 1, peak = 1, cumulativePnl = 0;
  return points.map((point, index) => {
    const previous = points[index - 1];
    let dailyPnl = 0;
    if (previous) {
      const netFlow = flows.filter((flow) => flow.time > previous.time && flow.time <= point.time)
        .reduce((sum, flow) => sum + flow.amount, 0);
      dailyPnl = point.equity - previous.equity - netFlow;
      if (!(previous.equity > 0) || !Number.isFinite(dailyPnl)) throw new Error("Invalid equity or cash flow denominator");
      cumulativePnl += dailyPnl;
      wealth *= 1 + dailyPnl / previous.equity;
    }
    peak = Math.max(peak, wealth);
    return { dailyPnl, periodPnl: cumulativePnl, periodReturnPercent: (wealth - 1) * 100,
      drawdownPercent: peak > 0 ? (wealth / peak - 1) * 100 : 0 };
  });
}

export function realizedTradeProfitFactor(realized: number[]) {
  const profit = realized.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const loss = -realized.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  return loss > 0 ? profit / loss : null;
}
