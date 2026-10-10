import assert from "node:assert/strict";
import test from "node:test";

import { RiskEngineService } from "../risk/risk-engine.service";
import type { ImportRollbackData } from "./import.types";
import { IbkrCsvParserService } from "./parser/ibkr-csv-parser.service";
import {
  applySplitToPosition,
  applyTradesToPositions,
  restorePortfolioState,
} from "./portfolio-accounting";

const activityCsv = `Account Information,Header,Field Name,Field Value
Account Information,Data,Account,U1234567
Statement,Header,Field Name,Field Value
Statement,Data,Period,"January 1, 2026 - July 17, 2026"
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code,Trade ID
Trades,Data,Order,Stocks,USD,AAPL,"2026-07-10, 10:00:00",10,100,110,-1000,-1,1001,0,100,,T-1001
Trades,Data,Order,Stocks,USD,AAPL,"2026-07-11, 10:00:00",-4,130,130,520,-1,-400,119,0,,T-1002
Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Cost Basis,Close Price,Value,Unrealized P/L,Code
Open Positions,Data,Summary,Stocks,USD,AAPL,6,600,130,780,180,
Dividends,Header,Currency,Date,Description,Amount,Transaction ID
Dividends,Data,USD,2026-07-12,AAPL Cash Dividend,12,DIV-1
Withholding Tax,Header,Currency,Date,Description,Amount,Transaction ID
Withholding Tax,Data,USD,2026-07-12,AAPL Dividend Tax,-1.8,TAX-1
Deposits & Withdrawals,Header,Currency,Date,Description,Amount,Transaction ID
Deposits & Withdrawals,Data,USD,2026-07-01,ACH Deposit,1000,DEP-1
Corporate Actions,Header,Currency,Asset Class,Symbol,Description,Date/Time,Type,Quantity,Transaction ID
Corporate Actions,Data,USD,STK,AAPL,AAPL 4 for 1 Stock Split,2026-07-15,FS,18,CA-1`;

test("解析 IBKR Activity Statement 分区、账户和主要业务记录", () => {
  const parsed = new IbkrCsvParserService().parse(activityCsv);
  assert.equal(parsed.adapter, "ACTIVITY_STATEMENT");
  assert.deepEqual(parsed.externalAccountIds, ["U1234567"]);
  assert.equal(parsed.statementStart?.slice(0, 10), "2026-01-01");
  assert.equal(parsed.statementEnd?.slice(0, 10), "2026-07-17");
  assert.equal(parsed.records.length, 7);
  assert.equal(parsed.records.filter((record) => record.recordType === "TRADE").length, 2);
  assert.equal(
    parsed.records.find((record) => record.externalId.includes("T-1002"))?.action,
    "SELL",
  );
  assert.equal(
    parsed.records.find((record) => record.recordType === "POSITION")?.currentPrice,
    130,
  );
  assert.equal(
    parsed.records.find((record) => record.recordType === "CORPORATE_ACTION")?.splitRatio,
    4,
  );
  assert.equal(parsed.records.flatMap((record) => record.validationErrors).length, 0);
});

test("显式 IBKR Trade ID 和业务哈希在重复文件中保持稳定", () => {
  const parser = new IbkrCsvParserService();
  const first = parser.parse(activityCsv);
  const second = parser.parse(activityCsv.replace("ACH Deposit", "ACH Deposit"));
  assert.deepEqual(
    first.records.map((record) => record.externalId),
    second.records.map((record) => record.externalId),
  );
  assert.equal(first.fileHash, second.fileHash);
});

test("无法识别的现金类型进入待确认错误而不是静默丢弃", () => {
  const csv = `Account ID,Date,Type,Description,Amount,Transaction ID
U1234567,2026-07-16,Mystery,Unclassified adjustment,25,UNKNOWN-1`;
  const parsed = new IbkrCsvParserService().parse(csv);
  assert.equal(parsed.records[0]?.recordType, "UNKNOWN");
  assert.match(parsed.records[0]?.validationErrors[0] ?? "", /暂不支持/);
});

test("加仓按含佣金加权平均成本，部分卖出保持剩余平均成本", () => {
  const result = applyTradesToPositions(
    [{ symbol: "AAPL", quantity: 10, avgCost: 100, currentPrice: 100 }],
    [
      { symbol: "AAPL", side: "BUY", quantity: 5, price: 120, commission: 1, realizedPnl: null },
      { symbol: "AAPL", side: "SELL", quantity: 4, price: 130, commission: 1, realizedPnl: null },
    ],
  );
  const position = result.positions[0]!;
  assert.equal(position.quantity, 11);
  assert.ok(Math.abs(position.avgCost - 106.7333333333) < 1e-8);
  assert.ok(Math.abs(result.calculatedRealizedPnl - 92.0666666668) < 1e-8);
});

test("股票拆分同步调整数量和单位成本", () => {
  const result = applySplitToPosition(
    { symbol: "AAPL", quantity: 10, avgCost: 400, currentPrice: 420 },
    4,
  );
  assert.deepEqual(result, { symbol: "AAPL", quantity: 40, avgCost: 100, currentPrice: 105 });
});

test("回滚快照可恢复导入前账户与受影响持仓", () => {
  const rollback: ImportRollbackData = {
    account: {
      initialCapital: 10_000,
      totalEquity: 11_000,
      cashBalance: 5_000,
      realizedPnlYtd: 1_000,
      brokerAccountId: null,
    },
    affectedPositions: [
      {
        instrumentId: "instrument-aapl",
        before: {
          instrumentId: "instrument-aapl",
          symbol: "AAPL",
          quantity: 10,
          avgCost: 100,
          currentPrice: 110,
        },
      },
    ],
    createdInstrumentIds: [],
    snapshot: null,
    snapshotDate: "2026-07-17T00:00:00.000Z",
  };
  const restored = restorePortfolioState(
    JSON.parse(JSON.stringify(rollback)) as ImportRollbackData,
  );
  assert.deepEqual(restored.account, rollback.account);
  assert.deepEqual(restored.positions, rollback.affectedPositions);
});

test("导入后持仓变化会触发后端风控重新判级", () => {
  const engine = new RiskEngineService();
  const result = engine.evaluate(
    { id: "account", name: "IBKR", totalEquity: 10_000, cashBalance: 6_000, realizedPnlYtd: 1_000 },
    [
      {
        id: "dla2",
        symbol: "DLA2",
        name: "Fictional Lab Alpha 2x ETF",
        assetType: "LEVERAGED_ETF",
        category: "HIGH_RISK",
        theme: "STORAGE",
        quantity: 100,
        avgCost: 30,
        currentPrice: 20,
      },
    ],
    [],
  );
  assert.equal(result.leveragedEtfPercent, 20);
  assert.equal(result.overallRiskLevel, "VIOLATION");
  assert.ok(result.alerts.some((alert) => alert.code === "LEVERAGED_ETF_TOTAL_MAX"));
});
