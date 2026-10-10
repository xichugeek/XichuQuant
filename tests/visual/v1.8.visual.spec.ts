import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshotRoot = path.resolve("Agent", "Screenshots", "V1.8");
const emptyDashboard = {
  accounts: [],
  backups: [],
  connector: {
    capabilities: {
      canCancelLiveOrders: false,
      canCancelPaperOrders: false,
      canModifyLiveOrders: false,
      canModifyPaperOrders: false,
      canPlaceLiveOrders: false,
      canPlacePaperOrders: false,
    },
    health: { message: "OFFLINE fixture", status: "OFFLINE" },
  },
  configuration: { enabled: false, environment: "LOCAL_GATEWAY", runMode: "OFFLINE", status: "OFFLINE" },
  control: {
    killSwitchLevel: "LEVEL_0_NORMAL",
    reason: null,
    safetyState: "READ_ONLY",
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
  incidents: [],
  isolation: {
    brokerPaperTablesOnly: true,
    internalPaperUnchanged: true,
    liveAccountWrites: false,
    shadowUnchanged: true,
  },
  orders: [],
  proposals: [],
  reconciliations: [],
  safetyStatement: "IBKR PAPER ONLY",
  supportedOrderTypes: ["LIMIT", "MARKET", "STOP", "STOP_LIMIT"],
};
const emptyMonitor = {
  apiLatencyMs: 1,
  averageSubmissionLatencyMs: null,
  brokerConnector: emptyDashboard.connector,
  correlationTracking: true,
  database: { latencyMs: 1, status: "OK" },
  executionIncidents: 0,
  ibkrHeartbeatAt: null,
  killSwitchLevel: "LEVEL_0_NORMAL",
  latestOrderStatusAt: null,
  marketDataLatencyHours: null,
  openReconciliationDifferences: 0,
  quantEngine: { status: "OK" },
  recentIncidents: [],
  requestErrorRate: 0,
  safetyState: "READ_ONLY",
  submissionUnknown: 0,
  taskFailureRate: 0,
};
const pages = [
  { emptyText: "待审批建议", label: "券商模拟执行", path: "/broker-paper-execution", view: "overview" },
  { emptyText: "尚未生成任何", label: "订单审批", path: "/order-approvals", view: "approvals" },
  { emptyText: "尚无真实", label: "Paper 订单", path: "/paper-broker-orders", view: "orders" },
  { emptyText: "尚无从 IBKR", label: "Paper 成交", path: "/paper-broker-executions", view: "executions" },
  { emptyText: "尚无 Paper 订单对账", label: "Paper 对账", path: "/paper-broker-reconciliation", view: "reconciliation" },
  { emptyText: "实时 API", label: "执行监控", path: "/execution-monitor", view: "monitor" },
  { emptyText: "当前没有执行事故", label: "执行事故", path: "/execution-incidents", view: "incidents" },
  { emptyText: "未配置", label: "安全中心", path: "/security-center", view: "security" },
  { emptyText: "尚无数据库备份", label: "备份恢复", path: "/backup-recovery", view: "backups" },
] as const;

test.beforeAll(async () => mkdir(screenshotRoot, { recursive: true }));

async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} 存在页面级横向溢出`).toBeLessThanOrEqual(1);
}

function endpoint(view: string) {
  return view === "monitor" ? "/paper-execution/monitor" : "/paper-execution/dashboard";
}

function emptyResponse(view: string) {
  return view === "monitor" ? emptyMonitor : emptyDashboard;
}

for (const item of pages) {
  test(`${item.label}真实数据库状态、Paper 标识且控制台无错误`, async ({ page }, testInfo) => {
    const runtimeErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (entry) => {
      if (entry.type() === "error") consoleErrors.push(entry.text());
    });
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(`[data-testid="paper-execution-page-${item.view}"]`)).toBeVisible();
    await expect(page.getByText("IBKR PAPER ONLY", { exact: true })).toBeVisible();
    await page.waitForTimeout(700);
    await assertNoOverflow(page, item.label);
    expect(runtimeErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}.png`) });
  });

  test(`${item.label}加载状态`, async ({ page }, testInfo) => {
    await page.route(`http://localhost:5089${endpoint(item.view)}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.fulfill({ body: JSON.stringify(emptyResponse(item.view)), contentType: "application/json", status: 200 });
    });
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-testid='paper-execution-loading']")).toBeVisible();
    await assertNoOverflow(page, `${item.label}加载状态`);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-loading.png`) });
  });

  test(`${item.label}空数据状态`, async ({ page }, testInfo) => {
    await page.route(`http://localhost:5089${endpoint(item.view)}`, (route) =>
      route.fulfill({ body: JSON.stringify(emptyResponse(item.view)), contentType: "application/json", status: 200 }),
    );
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(item.emptyText, { exact: false }).first()).toBeVisible();
    await assertNoOverflow(page, `${item.label}空数据状态`);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-empty.png`) });
  });

  test(`${item.label}连接异常状态`, async ({ page }, testInfo) => {
    await page.route(`http://localhost:5089${endpoint(item.view)}`, (route) => route.abort("failed"));
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-testid='paper-execution-error']")).toBeVisible();
    await expect(page.getByText("不会用 Mock 数据伪装成功", { exact: false })).toBeVisible();
    await assertNoOverflow(page, `${item.label}连接异常状态`);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-error.png`) });
  });
}

test("Paper 订单展示 IBKR 原始警告且未取得订单 ID 前禁止撤单", async ({ page }) => {
  const warningDashboard = {
    ...emptyDashboard,
    orders: [{
      averageFillPrice: null,
      brokerReplyId: "reply-warning-123",
      brokerReplyMessage: JSON.stringify({ messageIds: ["o163"], messages: ["价格偏离参考价，请人工核对。"] }),
      brokerReplyReceivedAt: "2026-09-05T00:00:00.000Z",
      correlationId: "paper-warning-test",
      createdAt: "2026-09-05T00:00:00.000Z",
      errorMessage: "IBKR 返回额外警告，必须人工阅读并单独确认",
      events: [],
      executions: [],
      externalOrderId: null,
      filledQuantity: 0,
      id: "paper-warning-order",
      limitPrice: 100,
      orderType: "LIMIT",
      quantity: 1,
      remainingQuantity: 1,
      side: "BUY",
      status: "BROKER_CONFIRMATION_REQUIRED",
      symbol: "AAPL",
      updatedAt: "2026-09-05T00:00:00.000Z",
    }],
  };
  await page.route("http://localhost:5089/paper-execution/dashboard", (route) =>
    route.fulfill({ body: JSON.stringify(warningDashboard), contentType: "application/json", status: 200 }),
  );
  await page.goto("/paper-broker-orders", { waitUntil: "domcontentloaded" });
  const confirmButton = page.getByRole("button", { name: "阅读并确认 IBKR 警告" });
  await expect(confirmButton).toBeVisible();
  await expect(page.getByText("价格偏离参考价，请人工核对。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销 Paper" })).toBeDisabled();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("价格偏离参考价");
    expect(dialog.message()).toContain("CONFIRM IBKR WARNING AAPL");
    await dialog.dismiss();
  });
  await confirmButton.click();
  await assertNoOverflow(page, "IBKR 警告人工确认");
});
