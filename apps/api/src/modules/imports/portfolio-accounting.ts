import type {
  AccountingPosition,
  AccountingTrade,
  ImportRollbackData,
  NormalizedImportRecord,
} from "./import.types";

export type PortfolioCalculation = {
  positions: AccountingPosition[];
  calculatedRealizedPnl: number;
};

export function applyTradesToPositions(
  initialPositions: AccountingPosition[],
  trades: AccountingTrade[],
): PortfolioCalculation {
  const positions = new Map(initialPositions.map((position) => [position.symbol, { ...position }]));
  let calculatedRealizedPnl = 0;

  for (const trade of trades) {
    if (trade.quantity <= 0 || trade.price < 0)
      throw new Error(`${trade.symbol} 的交易数量或价格无效`);
    const current = positions.get(trade.symbol) ?? {
      symbol: trade.symbol,
      quantity: 0,
      avgCost: 0,
      currentPrice: trade.price,
    };
    if (current.quantity < 0) throw new Error(`${trade.symbol} 空头持仓暂不能自动核算`);

    if (trade.side === "BUY") {
      const totalCost =
        current.quantity * current.avgCost + trade.quantity * trade.price + trade.commission;
      const nextQuantity = current.quantity + trade.quantity;
      positions.set(trade.symbol, {
        ...current,
        quantity: nextQuantity,
        avgCost: nextQuantity === 0 ? 0 : totalCost / nextQuantity,
        currentPrice: trade.price,
      });
      continue;
    }

    if (trade.quantity > current.quantity + 1e-8) {
      throw new Error(`${trade.symbol} 卖出数量超过当前持仓，记录需要人工确认`);
    }
    const realized =
      trade.realizedPnl ?? (trade.price - current.avgCost) * trade.quantity - trade.commission;
    calculatedRealizedPnl += realized;
    const nextQuantity = current.quantity - trade.quantity;
    if (Math.abs(nextQuantity) < 1e-8) {
      positions.delete(trade.symbol);
    } else {
      positions.set(trade.symbol, {
        ...current,
        quantity: nextQuantity,
        currentPrice: trade.price,
      });
    }
  }

  return { positions: [...positions.values()], calculatedRealizedPnl };
}

export function applySplitToPosition(
  position: AccountingPosition,
  ratio: number,
): AccountingPosition {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("股票拆分比例无效");
  return {
    ...position,
    quantity: position.quantity * ratio,
    avgCost: position.avgCost / ratio,
    currentPrice: position.currentPrice / ratio,
  };
}

export function cashImpact(record: NormalizedImportRecord, baseCurrency: string): number {
  if (
    ["POSITION", "CASH_BALANCE", "NAV_SNAPSHOT", "CORPORATE_ACTION", "UNKNOWN"].includes(
      record.recordType,
    )
  ) {
    return 0;
  }
  const amount =
    record.recordType === "TRADE" || record.recordType === "FX_TRANSACTION"
      ? record.netCash
      : record.amount;
  if (amount === null) return 0;
  if (record.currency === baseCurrency) return amount;
  if (record.fxRateToBase === null || record.fxRateToBase <= 0) {
    throw new Error(`${record.currency} 记录缺少 FX Rate to Base，不能自动折算`);
  }
  return amount * record.fxRateToBase;
}

export function restorePortfolioState(rollbackData: ImportRollbackData): {
  account: ImportRollbackData["account"];
  positions: ImportRollbackData["affectedPositions"];
} {
  return {
    account: { ...rollbackData.account },
    positions: rollbackData.affectedPositions.map((item) => ({
      instrumentId: item.instrumentId,
      before: item.before ? { ...item.before } : null,
    })),
  };
}
