import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { strongPassword } from "../auth/auth.service";

import {
  BROKER_RUN_MODES,
  commissionKey,
  evaluateBrokerPaperDeploymentEligibility,
  evaluateExecutionGuard,
  evaluateSubmissionGate,
  executionKey,
  killSwitchAllowsOrder,
  orderLifecycleStatus,
  paperReadinessAllowsObservation,
  paperOrderKey,
  paperProposalKey,
  stableHash,
  weightedAverageFills,
  type ExecutionGuardInput,
  type PaperSubmissionGateInput,
} from "./broker-paper.rules";

test("券商 Paper 建议要求标的同时属于策略与部署范围", () => {
  const result = evaluateBrokerPaperDeploymentEligibility({
    deploymentRiskConfigJson: '{"noBrokerOrder":false,"portfolioOnly":false}',
    deploymentSymbolUniverseJson: '["AAPL"]',
    strategySymbolUniverseJson: '["AAPL"]',
    symbol: "NVDA",
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(
    result.checks.filter((item) => !item.passed).map((item) => item.code),
    ["STRATEGY_SYMBOL_UNIVERSE", "DEPLOYMENT_SYMBOL_UNIVERSE"],
  );
});

test("noBrokerOrder 与 portfolioOnly 部署不能绕过券商订单门禁", () => {
  for (const deploymentRiskConfigJson of [
    '{"noBrokerOrder":true}',
    '{"portfolioOnly":true}',
  ]) {
    const result = evaluateBrokerPaperDeploymentEligibility({
      deploymentRiskConfigJson,
      deploymentSymbolUniverseJson: '["QQQM"]',
      strategySymbolUniverseJson: '["QQQM"]',
      symbol: "QQQM",
    });
    assert.equal(result.allowed, false);
  }
});

test("格式损坏的策略或部署范围默认拒绝", () => {
  const result = evaluateBrokerPaperDeploymentEligibility({
    deploymentRiskConfigJson: "{}",
    deploymentSymbolUniverseJson: "not-json",
    strategySymbolUniverseJson: "{}",
    symbol: "AAPL",
  });
  assert.equal(result.allowed, false);
});

test("PAPER 观察期允许产生受全部硬风控约束的模拟订单", () => {
  assert.equal(paperReadinessAllowsObservation("OBSERVING"), true);
  assert.equal(paperReadinessAllowsObservation("TECHNICALLY_READY"), true);
  assert.equal(paperReadinessAllowsObservation("RISK_REVIEW_REQUIRED"), true);
  assert.equal(paperReadinessAllowsObservation("NOT_READY"), false);
});

const validGuard: ExecutionGuardInput = {
  annualProfitContextKnown: true,
  accountSnapshotFresh: true,
  approvalValid: true,
  brokerHealthy: true,
  criticalReconciliationDifference: false,
  dailyLossExceeded: false,
  dailyNotionalExceeded: false,
  dailyOrderCountExceeded: false,
  dataQualityPassed: true,
  databaseHealthy: true,
  duplicateOrder: false,
  estimatedSlippageExceeded: false,
  killSwitchLevel: "LEVEL_0_NORMAL",
  losingStreakExceeded: false,
  marketDataFresh: true,
  marketDataRealtime: true,
  orderNotionalExceeded: false,
  paperEnvironmentPassed: true,
  quantEngineHealthy: true,
  spreadExceeded: false,
  submissionUnknownExists: false,
  systemLockdown: false,
};

const validGate: PaperSubmissionGateInput = {
  accountAllowlisted: true,
  accountType: "PAPER",
  approvalSnapshotMatches: true,
  approvalValid: true,
  connectorEnvironment: "PAPER",
  executionGuardApproved: true,
  killSwitchLevel: "LEVEL_0_NORMAL",
  portfolioRiskApproved: true,
  readinessApproved: true,
  riskApproved: true,
  runMode: "IBKR_PAPER",
  safetyState: "READ_ONLY",
};

test("V1.8 运行模式仅包含显式 Paper/只读/锁定模式", () => {
  assert.deepEqual(BROKER_RUN_MODES, [
    "OFFLINE",
    "MOCK",
    "INTERNAL_PAPER",
    "SHADOW",
    "IBKR_PAPER",
    "READ_ONLY_LIVE",
    "LOCKDOWN",
  ]);
  assert.equal(BROKER_RUN_MODES.some((mode) => mode.includes("LIVE_TRADING")), false);
});

test("建议幂等键覆盖账户、部署、标的、方向、日期、策略版本与建议版本", () => {
  const input = {
    brokerAccountId: "paper-account",
    proposalVersion: 1,
    side: "BUY",
    signalTradeDate: "2026-07-17",
    strategyDeploymentId: "deployment",
    strategyVersion: "7",
    symbol: "AAPL",
  };
  assert.equal(paperProposalKey(input), paperProposalKey({ ...input }));
  assert.notEqual(paperProposalKey(input), paperProposalKey({ ...input, proposalVersion: 2 }));
});

test("Broker Paper 订单幂等键稳定且不暴露完整业务输入", () => {
  const key = paperOrderKey("BROKER_PAPER_PROPOSAL:paper:deployment:AAPL:BUY:2026:7:1");
  assert.equal(key, paperOrderKey("BROKER_PAPER_PROPOSAL:paper:deployment:AAPL:BUY:2026:7:1"));
  assert.equal(key.includes("AAPL"), false);
});

test("规范 JSON 哈希不受字段顺序影响", () => {
  assert.equal(stableHash({ a: 1, b: 2 }), stableHash({ b: 2, a: 1 }));
});

test("Execution ID 存在时优先用于成交去重", () => {
  const base = {
    externalExecutionId: "EXEC-1",
    externalOrderId: "ORDER-1",
    price: 220,
    quantity: 1,
    side: "BUY",
    symbol: "AAPL",
    time: "2026-07-17T00:00:00.000Z",
  };
  assert.equal(executionKey(base), executionKey({ ...base, price: 999 }));
});

test("缺少 Execution ID 时完整业务字段参与成交去重", () => {
  const base = {
    externalOrderId: "ORDER-1",
    price: 220,
    quantity: 1,
    side: "BUY",
    symbol: "AAPL",
    time: "2026-07-17T00:00:00.000Z",
  };
  assert.notEqual(executionKey(base), executionKey({ ...base, quantity: 2 }));
});

test("佣金报告优先以外部报告 ID 去重", () => {
  const first = commissionKey({
    amount: 1,
    executionKey: "execution",
    externalReportId: "REPORT-1",
    reportTime: "2026-07-17T00:00:00.000Z",
  });
  const second = commissionKey({
    amount: 2,
    executionKey: "different",
    externalReportId: "REPORT-1",
    reportTime: "2026-07-18T00:00:00.000Z",
  });
  assert.equal(first, second);
});

test("ExecutionGuard 二十二项全部满足才允许执行", () => {
  const result = evaluateExecutionGuard(validGuard);
  assert.equal(result.checks.length, 22);
  assert.equal(result.allowed, true);
});

const guardFailureCases: Array<[keyof ExecutionGuardInput, boolean | string]> = [
  ["marketDataFresh", false],
  ["marketDataRealtime", false],
  ["accountSnapshotFresh", false],
  ["dataQualityPassed", false],
  ["spreadExceeded", true],
  ["estimatedSlippageExceeded", true],
  ["orderNotionalExceeded", true],
  ["dailyOrderCountExceeded", true],
  ["dailyNotionalExceeded", true],
  ["dailyLossExceeded", true],
  ["losingStreakExceeded", true],
  ["criticalReconciliationDifference", true],
  ["duplicateOrder", true],
  ["submissionUnknownExists", true],
  ["brokerHealthy", false],
  ["quantEngineHealthy", false],
  ["databaseHealthy", false],
  ["killSwitchLevel", "LEVEL_1_NO_NEW_ENTRY"],
  ["systemLockdown", true],
  ["approvalValid", false],
  ["paperEnvironmentPassed", false],
];

for (const [field, value] of guardFailureCases) {
  test(`ExecutionGuard 默认拒绝：${field}`, () => {
    const result = evaluateExecutionGuard({ ...validGuard, [field]: value });
    assert.equal(result.allowed, false);
    assert.ok(result.checks.some((item) => !item.passed));
  });
}

test("Paper 提交门禁十二项全部满足才允许", () => {
  const result = evaluateSubmissionGate(validGate);
  assert.equal(result.checks.length, 12);
  assert.equal(result.allowed, true);
});

const gateFailureCases: Array<[keyof PaperSubmissionGateInput, boolean | string]> = [
  ["runMode", "READ_ONLY_LIVE"],
  ["connectorEnvironment", "LIVE"],
  ["accountType", "INDIVIDUAL"],
  ["accountAllowlisted", false],
  ["safetyState", "LOCKDOWN"],
  ["killSwitchLevel", "LEVEL_2_CANCEL_OPEN_ORDERS"],
  ["riskApproved", false],
  ["portfolioRiskApproved", false],
  ["readinessApproved", false],
  ["approvalValid", false],
  ["approvalSnapshotMatches", false],
  ["executionGuardApproved", false],
];

for (const [field, value] of gateFailureCases) {
  test(`Paper 双重环境与审批门禁默认拒绝：${field}`, () => {
    assert.equal(evaluateSubmissionGate({ ...validGate, [field]: value }).allowed, false);
  });
}

test("部分成交状态优先于普通券商状态", () => {
  assert.equal(
    orderLifecycleStatus({ current: "SUBMITTED", externalStatus: "SUBMITTED", filledQuantity: 4, quantity: 10 }),
    "PARTIALLY_FILLED",
  );
});

test("全部成交数量决定 FILLED", () => {
  assert.equal(
    orderLifecycleStatus({ current: "SUBMITTED", externalStatus: "SUBMITTED", filledQuantity: 10, quantity: 10 }),
    "FILLED",
  );
});

test("未知券商状态进入 UNKNOWN 并阻止新风险", () => {
  assert.equal(
    orderLifecycleStatus({ current: "SUBMITTED", externalStatus: "VENDOR_NEW_STATE", filledQuantity: 0, quantity: 10 }),
    "UNKNOWN",
  );
});

test("IBKR 券商警告状态会进入人工确认生命周期", () => {
  assert.equal(
    orderLifecycleStatus({ current: "SUBMITTING", externalStatus: "BROKER_CONFIRMATION_REQUIRED", filledQuantity: 0, quantity: 10 }),
    "BROKER_CONFIRMATION_REQUIRED",
  );
});

test("多次成交按数量加权计算平均价格", () => {
  const result = weightedAverageFills([
    { price: 219.375, quantity: 4 },
    { price: 220, quantity: 6 },
  ]);
  assert.equal(result.filledQuantity, 10);
  assert.equal(result.averagePrice, 219.75);
});

test("无成交时平均价为零且不产生 NaN", () => {
  assert.deepEqual(weightedAverageFills([]), { averagePrice: 0, filledQuantity: 0 });
});

test("LEVEL_0 允许经过全部门禁的订单", () => {
  assert.equal(killSwitchAllowsOrder({ isClosing: false, isNewEntry: true, level: "LEVEL_0_NORMAL" }), true);
});

test("LEVEL_1 禁止新开仓但允许平仓", () => {
  assert.equal(killSwitchAllowsOrder({ isClosing: false, isNewEntry: true, level: "LEVEL_1_NO_NEW_ENTRY" }), false);
  assert.equal(killSwitchAllowsOrder({ isClosing: true, isNewEntry: false, level: "LEVEL_1_NO_NEW_ENTRY" }), true);
});

test("LEVEL_2/3/4 均不直接允许新订单", () => {
  for (const level of [
    "LEVEL_2_CANCEL_OPEN_ORDERS",
    "LEVEL_3_CLOSE_PAPER_POSITIONS",
    "LEVEL_4_LOCKDOWN",
  ]) {
    assert.equal(killSwitchAllowsOrder({ isClosing: false, isNewEntry: true, level }), false);
  }
});

const repositoryRoot = path.resolve(__dirname, "../../../../..");
const serviceSource = readFileSync(path.join(repositoryRoot, "apps/api/src/modules/broker-execution/broker-paper.service.ts"), "utf8");
const brokerSyncSource = readFileSync(path.join(repositoryRoot, "apps/api/src/modules/broker-sync/broker-sync.service.ts"), "utf8");
const connectorSource = readFileSync(path.join(repositoryRoot, "apps/broker-connector/src/paper-execution-provider.ts"), "utf8");

test("Paper 快照同步后保持 CURRENT，风险页面兼容历史 CONNECTED 状态", () => {
  const riskSource = readFileSync(
    path.join(repositoryRoot, "apps/api/src/modules/risk/risk.service.ts"),
    "utf8",
  );
  const performanceSource = readFileSync(
    path.join(repositoryRoot, "apps/api/src/modules/accounts/account-performance.service.ts"),
    "utf8",
  );
  const disciplineSource = readFileSync(
    path.join(repositoryRoot, "apps/api/src/modules/risk-discipline/risk-discipline.service.ts"),
    "utf8",
  );
  assert.match(serviceSource, /lastSyncedAt: snapshotTime, status: "CURRENT"/);
  for (const source of [riskSource, performanceSource, disciplineSource]) {
    assert.match(source, /status: \{ in: \["CURRENT", "CONNECTED"\] \}/);
  }
});

test("IBKR Paper 账户每分钟只读同步且禁止任务重入", () => {
  assert.match(serviceSource, /@Cron\("0 \* \* \* \* \*"\)/);
  assert.match(serviceSource, /paperSyncInFlight/);
  assert.match(serviceSource, /await this\.syncPaperOrders\(\)/);
});

test("IB Gateway 状态探测串行执行，避免单会话并发导致误报离线", () => {
  const start = brokerSyncSource.indexOf("async connectionStatus");
  const end = brokerSyncSource.indexOf("async updateSettings", start);
  const connectionStatus = brokerSyncSource.slice(start, end);
  assert.equal(connectionStatus.includes("Promise.all"), false);
  assert.match(connectionStatus, /await this\.connector\.health\(\)/);
  assert.match(connectionStatus, /await this\.connector\.connection\(\)/);
  assert.match(connectionStatus, /await this\.connector\.capabilities\(\)/);
});

test("券商 Paper 成交只写 BrokerPaper 专用表", () => {
  for (const forbidden of [
    "transaction.account.update",
    "transaction.position.update",
    "transaction.trade.create",
    "transaction.paperAccount.update",
    "transaction.paperPosition.update",
    "transaction.shadowFill.create",
  ]) {
    assert.equal(serviceSource.includes(forbidden), false, `发现隔离账本写入: ${forbidden}`);
  }
});

test("提交结果未知时保存 SUBMISSION_UNKNOWN 并禁止直接重试", () => {
  assert.match(serviceSource, /SUBMISSION_UNKNOWN/);
  assert.match(serviceSource, /禁止直接重试/);
  assert.match(serviceSource, /openOrders/);
  assert.match(serviceSource, /completedOrders/);
  assert.match(serviceSource, /executions/);
});

test("人工审批与发送均要求标的级二次确认", () => {
  assert.match(serviceSource, /IBKR PAPER/);
  assert.match(serviceSource, /dto\.decision/);
  assert.match(serviceSource, /SEND IBKR PAPER/);
  assert.equal(serviceSource.includes("APPROVE ALL"), false);
});

test("IBKR reply 警告只能逐单人工确认且并发请求只允许一个获胜", () => {
  assert.match(serviceSource, /CONFIRM IBKR WARNING/);
  assert.match(serviceSource, /brokerReplyId/);
  assert.match(serviceSource, /updateMany/);
  assert.match(serviceSource, /禁止重复确认/);
  assert.match(connectorSource, /BROKER_CONFIRMATION_REQUIRED/);
  assert.match(connectorSource, /\/iserver\/reply\//);
  assert.equal(connectorSource.includes("autoConfirm"), false);
});

test("Connector 只定义 Paper 专用写方法且 Live 能力固定为 false", () => {
  assert.match(connectorSource, /placePaperOrder/);
  assert.match(connectorSource, /modifyPaperOrder/);
  assert.match(connectorSource, /cancelPaperOrder/);
  assert.match(connectorSource, /canPlaceLiveOrders: false/);
  assert.equal(connectorSource.includes("place" + "LiveOrder"), false);
  assert.equal(connectorSource.includes("submit" + "LiveOrder"), false);
  assert.equal(connectorSource.includes("transmit" + "LiveOrder"), false);
});

test("恢复流程先查询订单与成交且不批量重提失败订单", () => {
  const start = serviceSource.indexOf("async recover");
  const end = serviceSource.indexOf("async updateKillSwitch", start);
  const recovery = serviceSource.slice(start, end);
  assert.match(recovery, /syncPaperOrders/);
  assert.match(recovery, /orderStatus/);
  assert.equal(recovery.includes("placePaperOrder"), false);
});

test("生产密码策略要求长度、大小写、数字和特殊字符", () => {
  assert.equal(strongPassword("Xichu-Paper-2026!"), true);
  assert.equal(strongPassword("onlylowercase123!"), false);
  assert.equal(strongPassword("NoSpecialCharacter123"), false);
  assert.equal(strongPassword("Short1!"), false);
});

test("生产会话使用 HttpOnly Secure SameSite 且 CSRF 与数据库哈希绑定", () => {
  const controllerSource = readFileSync(path.join(repositoryRoot, "apps/api/src/modules/auth/auth.controller.ts"), "utf8");
  const middlewareSource = readFileSync(path.join(repositoryRoot, "apps/api/src/common/production-security.middleware.ts"), "utf8");
  assert.match(controllerSource, /httpOnly: true/);
  assert.match(controllerSource, /sameSite: "strict"/);
  assert.match(controllerSource, /secure/);
  assert.match(middlewareSource, /xichu_csrf/);
  assert.match(middlewareSource, /session\.csrfHash/);
});

test("Windows 启停、健康检查、备份和恢复入口均存在且恢复目标隔离", () => {
  for (const entry of ["setup.cmd", "start-dev.cmd", "stop-dev.cmd", "health-check.cmd", "backup.cmd", "restore-test.cmd"]) {
    assert.equal(readFileSync(path.join(repositoryRoot, entry), "utf8").length > 0, true);
  }
  const restoreSource = readFileSync(path.join(repositoryRoot, "scripts/restore-test-database.ps1"), "utf8");
  assert.match(restoreSource, /_RestoreTest/);
  assert.match(restoreSource, /DBCC CHECKDB/);
  assert.match(restoreSource, /_prisma_migrations/);
});

test("Linux Compose 包含六项服务、健康检查、持久化卷与默认关闭的 Paper 执行", () => {
  const compose = readFileSync(path.join(repositoryRoot, "docker-compose.yml"), "utf8");
  const production = readFileSync(path.join(repositoryRoot, "docker-compose.production.yml"), "utf8");
  const combined = `${compose}\n${production}`;
  for (const service of ["sqlserver:", "quant-engine:", "broker-connector:", "api:", "web:", "reverse-proxy:"]) {
    assert.equal(combined.includes(service), true, `缺少服务 ${service}`);
  }
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /BROKER_CONNECTOR_MODE: \$\{BROKER_CONNECTOR_MODE:-OFFLINE\}/);
  assert.match(combined, /sqlserver-data/);
  assert.match(combined, /sqlserver-backup/);
});

test("浏览器端未调用 Web Storage 保存 JWT 或券商凭证", () => {
  const webFiles = [
    "apps/web/lib/api-client.ts",
    "apps/web/app/login/page.tsx",
    "apps/web/components/paper-execution-workspace.tsx",
  ].map((file) => readFileSync(path.join(repositoryRoot, file), "utf8")).join("\n");
  assert.equal(/(?:localStorage|sessionStorage)\.(?:setItem|getItem)/.test(webFiles), false);
});
