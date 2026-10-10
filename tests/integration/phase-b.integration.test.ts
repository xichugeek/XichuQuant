import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertDemoSeedTarget } from "../../database/prisma/seed-safety";
import { BrokerPaperService } from "../../apps/api/src/modules/broker-execution/broker-paper.service";
import { stableHash } from "../../apps/api/src/modules/broker-execution/broker-paper.rules";
import { RiskEngineService } from "../../apps/api/src/modules/risk/risk-engine.service";
import { RiskService } from "../../apps/api/src/modules/risk/risk.service";
import { AccountPerformanceService } from "../../apps/api/src/modules/accounts/account-performance.service";
import { RiskDisciplineService } from "../../apps/api/src/modules/risk-discipline/risk-discipline.service";
import { BrokerSyncService } from "../../apps/api/src/modules/broker-sync/broker-sync.service";

test("Seed 连跑保留演示库中的已修改账户与所有账本计数", async () => {
  assertDemoSeedTarget(process.env.DATABASE_URL, process.env.SEED_DEMO_CONFIRM);
  const db = new PrismaClient();
  try {
    await db.account.update({ where: { id: "account-demo" }, data: { name: "SYNTHETIC custom demo name" } });
    const fingerprint = async () => JSON.stringify({
      account: await db.account.findMany(), positions: await db.position.findMany(), trades: await db.trade.findMany(),
      paper: await db.paperAccount.findMany(), paperOrders: await db.paperOrder.count(), paperFills: await db.paperFill.count(),
      brokerOrders: await db.brokerPaperOrder.count(), brokerFills: await db.brokerPaperExecution.count(), rules: await db.riskRule.findMany(),
    });
    const before = await fingerprint();
    const seed = spawnSync("corepack pnpm db:seed", { cwd: process.cwd(), shell: true, encoding: "utf8", env: process.env });
    assert.equal(seed.status, 0, "Repeated seed must succeed without changing an initialized demo");
    assert.equal(await fingerprint(), before);
    // Only this dedicated test row is restored to its original DEMO label.
    await db.account.update({ where: { id: "account-demo" }, data: { name: "虚构演示账户 DEMO" } });
  } finally { await db.$disconnect(); }
});

test("只读回读：未知佣金保持 null，延迟佣金更新原成交，多账户可重复使用 Execution ID", async () => {
  assertDemoSeedTarget(process.env.DATABASE_URL, process.env.SEED_DEMO_CONFIRM);
  const db = new PrismaClient();
  try {
    const demo = await db.account.findUniqueOrThrow({ where: { id: "account-demo" } });
    const connection = await db.brokerConnection.findFirstOrThrow();
    const namespace = `synthetic-${randomUUID()}`;
    const externalIds = [`${namespace}-a`, `${namespace}-b`];
    for (const brokerAccountId of externalIds) await db.account.create({ data: { userId: demo.userId, name: "SYNTHETIC readonly ledger", dataOrigin: "SYNTHETIC", brokerAccountId, totalEquity: 100000, cashBalance: 100000 } });
    const config = { get: (key: string, fallback: unknown) => key === "BROKER_ACCOUNT_HASH_PEPPER" ? namespace : fallback };
    const service = new BrokerSyncService(db as never, {} as never, {} as never, config as never);
    const methods = service as unknown as { persistBundles(connection: unknown, jobId: string, bundles: unknown[]): Promise<unknown> };
    const makeBundles = (commission: number | null) => externalIds.map((externalAccountId) => ({
      account: { externalAccountId, accountType: "PAPER", baseCurrency: "USD", displayName: "SYNTHETIC" },
      summary: { availableFunds: 100000, baseCurrency: "USD", buyingPower: 100000, grossPositionValue: 0, netLiquidation: 100000, realizedPnl: 0, settledCash: 100000, snapshotTime: "2026-10-09T15:00:00Z", totalCash: 100000, unrealizedPnl: 0 },
      cash: [], positions: [], transactions: [], openOrders: [], completedOrders: [], corporateActions: [],
      executions: [{ externalExecutionId: namespace, symbol: "AAPL", side: "BUY", quantity: 1, price: 100, commission, currency: "USD", exchange: "SYNTHETIC", executionTime: "2026-10-09T15:00:00Z", tradeDate: "2026-10-09" }],
    }));
    const job = async () => db.brokerSyncJob.create({ data: { brokerConnectionId: connection.id, idempotencyKey: randomUUID(), status: "PERSISTING" } });
    await methods.persistBundles(connection, (await job()).id, makeBundles(null));
    const before = await db.brokerExecution.findMany({ where: { externalExecutionId: namespace } });
    assert.equal(before.length, 2);
    assert.ok(before.every((row) => row.commission === null && row.commissionKnown === false));
    await methods.persistBundles(connection, (await job()).id, makeBundles(1.25));
    const after = await db.brokerExecution.findMany({ where: { externalExecutionId: namespace } });
    assert.equal(after.length, 2);
    assert.ok(after.every((row) => Number(row.commission) === 1.25 && row.commissionKnown));
    assert.deepEqual(after.map((row) => row.id).sort(), before.map((row) => row.id).sort());
  } finally { await db.$disconnect(); }
});

test("隔离 SQL Server：幂等状态、成交/Stop 账本、延迟佣金、对账、拒绝审计及账户隔离", async () => {
  assertDemoSeedTarget(process.env.DATABASE_URL, process.env.SEED_DEMO_CONFIRM);
  const db = new PrismaClient();
  try {
    const namespace = `phase-b-${randomUUID()}`;
    const source = await db.brokerPaperOrder.findFirst({ include: { proposal: true } });
    assert.ok(source, "Run the dedicated DEMO seed first");
    const preserved = await db.account.findUniqueOrThrow({ where: { id: "account-demo" }, include: { positions: true, trades: true } });
    const internalBefore = await db.paperFill.count();
    const createOrder = async (suffix: string, brokerAccountId: string) => {
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...template } = source.proposal;
      const proposal = await db.brokerOrderProposal.create({ data: {
        ...template, brokerAccountId, idempotencyKey: `${namespace}-proposal-${suffix}`, correlationId: stableHash(`${namespace}-${suffix}`),
      } });
      return db.brokerPaperOrder.create({ data: {
        brokerAccountId, proposalId: proposal.id, idempotencyKey: `${namespace}-order-${suffix}`,
        symbol: source.symbol, side: "BUY", orderType: "LIMIT", quantity: 40, remainingQuantity: 40,
        timeInForce: "DAY", externalOrderId: "7301", externalPermanentId: "87001",
        protectiveStopExternalOrderId: "7302", protectiveStopPermanentId: "87002", protectiveStopPrice: 98,
        correlationId: proposal.correlationId,
      } });
    };
    const order = await createOrder("one", source.brokerAccountId);
    const broker = await db.brokerAccount.findUniqueOrThrow({ where: { id: source.brokerAccountId } });
    const { id: _brokerId, createdAt: _brokerCreatedAt, updatedAt: _brokerUpdatedAt, ...brokerTemplate } = broker;
    const secondBroker = await db.brokerAccount.create({ data: { ...brokerTemplate, externalAccountId: stableHash(`${namespace}-other`), dataOrigin: "DEMO" } });
    const other = await createOrder("two", secondBroker.id); // Socket IDs may repeat across accounts.
    let externalCalls = 0;
    const service = new BrokerPaperService(db as never, { get: (_name: string, fallback: unknown) => fallback } as never,
      { openOrders: async () => { externalCalls++; return []; } } as never, {} as never, new RiskEngineService(), {} as never);
    const methods = service as unknown as {
      persistExecutions(rows: Record<string, unknown>[], account: string): Promise<void>;
      persistRemoteState(id: string, state: Record<string, unknown>, actor: string): Promise<unknown>;
      persistProtectiveStopState(id: string, state: Record<string, unknown>, actor: string): Promise<unknown>;
      reconcileOrder(id: string, state: Record<string, unknown>): Promise<void>;
      persistProposalPreflightBlock(account: string, dto: Record<string, unknown>, symbol: string, reasons: { code: string; message: string }[]): Promise<unknown>;
    };
    const fill = { externalOrderId: "7301", externalPermanentId: "87001", orderReference: order.idempotencyKey,
      externalExecutionId: `${namespace}-fill`, symbol: order.symbol, side: "BUY", quantity: 40, price: 100,
      commission: null, executionTime: "2026-10-09T15:00:00Z", currency: "USD" };
    await methods.persistExecutions([fill, fill], order.brokerAccountId);
    await assert.rejects(() => methods.persistExecutions([{ ...fill, externalPermanentId: "contradictory-permanent-id" }], order.brokerAccountId), /identifiers conflict/);
    await assert.rejects(() => methods.persistExecutions([{ ...fill, quantity: 39 }], order.brokerAccountId), /persisted fill facts/);
    assert.equal(await db.brokerPaperExecution.count({ where: { brokerPaperOrderId: order.id } }), 1);
    assert.equal(await db.brokerPaperExecution.count({ where: { brokerPaperOrderId: other.id } }), 0);
    assert.equal(await db.brokerPaperCommission.count({ where: { execution: { brokerPaperOrderId: order.id } } }), 0);
    const commission = { ...fill, commission: 1.25, commissionReportId: fill.externalExecutionId };
    await methods.persistExecutions([commission, commission], order.brokerAccountId);
    assert.equal(await db.brokerPaperCommission.count({ where: { execution: { brokerPaperOrderId: order.id } } }), 1);
    const stopFill = { ...fill, externalOrderId: "7302", externalPermanentId: "87002", orderReference: `${order.idempotencyKey}:PROTECTIVE_STOP`,
      externalExecutionId: `${namespace}-stop-fill`, side: "SELL", quantity: 10, price: 98, commission: 1, realizedPnl: -20 };
    await methods.persistExecutions([stopFill, stopFill], order.brokerAccountId);
    const filled = await db.brokerPaperOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(Number(filled.filledQuantity), 40, "Protective exit does not inflate entry quantity");
    assert.equal(Number(filled.averageFillPrice), 100);
    assert.equal(await db.brokerPaperExecution.count({ where: { brokerPaperOrderId: order.id, executionRole: "PROTECTION" } }), 1);
    const remote = { externalOrderId: "7301", externalPermanentId: "87001", status: "FILLED", filledQuantity: 40,
      remainingQuantity: 0, averageFillPrice: 100, updatedAt: new Date().toISOString(), rawDataHash: stableHash("poll-one") };
    await methods.persistRemoteState(order.id, remote, "synthetic-sync");
    const auditCount = await db.brokerAuditLog.count({ where: { brokerAccountId: order.brokerAccountId } });
    await methods.persistRemoteState(order.id, { ...remote, rawDataHash: stableHash("poll-two"), updatedAt: new Date().toISOString() }, "synthetic-sync");
    assert.equal(await db.brokerPaperOrderEvent.count({ where: { brokerPaperOrderId: order.id } }), 1);
    assert.equal(await db.brokerAuditLog.count({ where: { brokerAccountId: order.brokerAccountId } }), auditCount);
    const stopState = { ...remote, externalOrderId: "7302", status: "SUBMITTED", filledQuantity: 10, remainingQuantity: 30, protectiveStopPrice: 98 };
    await methods.persistProtectiveStopState(order.id, stopState, "synthetic-sync");
    await methods.persistProtectiveStopState(order.id, { ...stopState, rawDataHash: stableHash("new-stop-poll") }, "synthetic-sync");
    assert.equal(await db.brokerPaperOrderEvent.count({ where: { brokerPaperOrderId: order.id } }), 2);
    assert.equal(Number((await db.brokerPaperOrder.findUniqueOrThrow({ where: { id: order.id } })).protectiveStopQuantity), 30);
    await methods.reconcileOrder(order.id, remote);
    await methods.reconcileOrder(order.id, remote);
    assert.equal(await db.brokerPaperReconciliationRun.count({ where: { brokerPaperOrderId: order.id } }), 1);
    assert.equal((await db.brokerPaperReconciliationRun.findFirstOrThrow({ where: { brokerPaperOrderId: order.id } })).status, "MATCHED");
    const rejection = [{ code: "MISSING_STOP_PRICE", message: "SYNTHETIC test: no stop" }, { code: "DEPLOYMENT_CONFIG_VALID", message: "SYNTHETIC test: broken config" }];
    const dto = { strategyId: "synthetic-strategy", strategyDeploymentId: "synthetic-deployment", proposalVersion: 1, side: "BUY", quantity: 5, orderType: "LIMIT", signalTradeDate: "2026-10-09" };
    await methods.persistProposalPreflightBlock(order.brokerAccountId, dto, order.symbol, rejection);
    await methods.persistProposalPreflightBlock(order.brokerAccountId, dto, order.symbol, rejection);
    const refusal = await db.riskDisciplineEvent.findFirstOrThrow({ where: { brokerAccountId: order.brokerAccountId, ruleCode: rejection.map((reason) => reason.code).join("+") } });
    assert.match(refusal.reason, /no stop/);
    assert.match(refusal.reason, /broken config/);
    assert.equal(await db.riskDisciplineEvent.count({ where: { idempotencyKey: refusal.idempotencyKey } }), 1);
    await assert.rejects(() => service.syncPaperOrders(), /explicitly enabled Paper/);
    assert.equal(externalCalls, 0, "Offline connection is rejected before broker calls");
    assert.deepEqual(await db.account.findUniqueOrThrow({ where: { id: "account-demo" }, include: { positions: true, trades: true } }), preserved);
    assert.equal(await db.paperFill.count(), internalBefore);
  } finally { await db.$disconnect(); }
});

test("多账户绩效只读取所属交易、快照和已入账现金流", async () => {
  assertDemoSeedTarget(process.env.DATABASE_URL, process.env.SEED_DEMO_CONFIRM);
  const db = new PrismaClient();
  try {
    const demo = await db.account.findUniqueOrThrow({ where: { id: "account-demo" } });
    const currentYearTrades = await db.trade.findMany({ where: { accountId: demo.id, tradeDate: { gte: new Date("2026-01-01T00:00:00Z") } } });
    assert.equal(currentYearTrades.reduce((sum, trade) => sum + Number(trade.realizedPnl ?? 0), 0), Number(demo.realizedPnlYtd));
    const positions = await db.position.findMany({ where: { accountId: demo.id } });
    for (const position of positions) {
      const quantity = currentYearTrades.filter((trade) => trade.instrumentId === position.instrumentId).reduce((sum, trade) => sum + (trade.side === "BUY" ? 1 : -1) * Number(trade.quantity), 0);
      assert.equal(quantity, Number(position.quantity), "DEMO current inventory matches its fictional current-year ledger");
    }
    assert.equal(Number(demo.cashBalance) + positions.reduce((sum, position) => sum + Number(position.quantity) * Number(position.currentPrice), 0), Number(demo.totalEquity));
    const account = await db.account.create({ data: { userId: demo.userId, name: "SYNTHETIC cashflow ledger", dataOrigin: "SYNTHETIC", initialCapital: 100000, totalEquity: 125000, cashBalance: 125000 } });
    const date = (day: number) => new Date(Date.UTC(2026, 0, day));
    await db.accountEquitySnapshot.createMany({ data: [
      { accountId: account.id, snapshotDate: date(1), totalEquity: 100000, cashBalance: 100000, realizedPnlYtd: 0 },
      { accountId: account.id, snapshotDate: date(2), totalEquity: 125000, cashBalance: 125000, realizedPnlYtd: 0 },
    ] });
    const batch = await db.importBatch.create({ data: { accountId: account.id, source: "SYNTHETIC", fileName: "fictional-cashflow.csv", fileHash: stableHash(account.id), status: "COMPLETED" } });
    await db.importRecord.create({ data: { batchId: batch.id, accountId: account.id, sourceSection: "SYNTHETIC", sourceRow: 1,
      recordType: "DEPOSIT", status: "IMPORTED", externalId: randomUUID(), dedupKey: randomUUID(), transactionDate: date(2),
      amount: 25000, currency: "USD", rawData: "{}", normalizedData: JSON.stringify({ recordType: "DEPOSIT", amount: 25000, currency: "USD" }),
    } });
    const risk = new RiskService(db as never, new RiskEngineService());
    await risk.evaluateAndPersist("account-demo");
    const alertCount = await db.riskAlert.count({ where: { accountId: "account-demo" } });
    await risk.evaluateAndPersist("account-demo");
    assert.equal(await db.riskAlert.count({ where: { accountId: "account-demo" } }), alertCount, "Unchanged risk assessment must not append duplicate alerts");
    const result = await new AccountPerformanceService(db as never, risk).getPerformance(account.id, "ALL");
    assert.equal(result.periodPnl, 0);
    assert.equal(result.totalReturnPercent, 0);
    assert.equal(result.realizedPnlYtd, 0);
    assert.equal(result.accountId, account.id);
    const discipline = new RiskDisciplineService(db as never, risk);
    const demoBroker = await db.brokerAccount.findFirstOrThrow();
    await assert.rejects(() => discipline.tradeDisciplineAnalytics(account.id, demoBroker.id), /identity mismatch/);
    const replay = await discipline.replayIncident("position-incident-synthetic-lab");
    assert.equal(replay.finalRealizedPnl, -6000);
    assert.equal(replay.dataGranularity, "DAILY_MAE_APPROXIMATION");
    assert.equal(replay.splitAdjustments.length, 1);
    assert.equal(replay.splitAdjustments[0]!.source, "SYNTHETIC_SPLIT_FACTOR");
    assert.equal(replay.timeline[0]!.accountEquity, null, "No future equity is invented for an earlier replay day");
    const savedMode = process.env.XICHURISK_DATA_MODE;
    process.env.XICHURISK_DATA_MODE = "HISTORICAL";
    await db.account.create({ data: { userId: demo.userId, name: "Second isolated ledger", dataOrigin: "SYNTHETIC", totalEquity: 50000, cashBalance: 50000 } });
    await assert.rejects(() => risk.getSummary(), /Multiple accounts require explicit/);
    process.env.XICHURISK_DATA_MODE = savedMode;
  } finally { await db.$disconnect(); }
});
