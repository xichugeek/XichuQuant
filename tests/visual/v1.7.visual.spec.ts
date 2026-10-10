import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshotRoot = path.resolve("Agent", "Screenshots", "V1.7");
const emptyConnection = {
  autoReconciliation: false,
  capabilities: {
    canCancelOrders: false,
    canModifyOrders: false,
    canPlaceOrders: false,
    canReadAccounts: true,
    canReadExecutions: true,
    canReadOrders: true,
    canReadPositions: true,
  },
  connectorUrl: "http://localhost:5092",
  displayName: "IBKR 只读连接",
  enabled: false,
  environment: "LOCAL_GATEWAY",
  id: "connection",
  lastConnectedAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  lastHeartbeatAt: null,
  lastSyncAt: null,
  provider: "IBKR_READONLY",
  runMode: "OFFLINE",
  safetyState: "READ_ONLY",
  shadowTradingEnabled: false,
  staleAfterSeconds: 900,
  status: "OFFLINE",
  updatedAt: "2026-07-17T00:00:00.000Z",
};
const emptyDashboard = {
  accounts: [],
  auditLogs: [],
  connection: emptyConnection,
  control: { killSwitchEnabled: false, reason: null },
  disclaimers: {
    brokerWrites: "只读",
    opportunityPnl: "仅为模拟",
    readiness: "不具备实盘自动下单能力",
  },
  readiness: {
    dimensions: {},
    infrastructure: { score: 0, status: "NOT_READY" },
    portfolio: { score: 0, status: "NOT_READY" },
    statement: "本系统当前不具备实盘自动下单能力。",
    strategy: { score: 0, status: "NOT_READY" },
  },
  reconciliationRuns: [],
  safeguards: {},
  shadowSessions: [],
  syncJobs: [],
};
const emptyServices = {
  connection: emptyConnection,
  latestReconciliation: null,
  latestShadow: null,
  latestSync: null,
  services: [],
};
const pages = [
  {
    emptyText: "尚无 Broker 审计记录",
    endpoint: "/broker/dashboard",
    label: "券商连接",
    path: "/broker-connections",
    response: emptyDashboard,
  },
  {
    emptyText: "尚未同步任何只读券商账户",
    endpoint: "/broker/dashboard",
    label: "IBKR 账户",
    path: "/broker-accounts",
    response: emptyDashboard,
  },
  {
    emptyText: "尚无同步任务",
    endpoint: "/broker/dashboard",
    label: "账户同步",
    path: "/broker-sync",
    response: emptyDashboard,
  },
  {
    emptyText: "尚无账户对账记录",
    endpoint: "/broker/dashboard",
    label: "账户对账",
    path: "/reconciliation",
    response: emptyDashboard,
  },
  {
    emptyText: "尚无影子订单意图",
    endpoint: "/broker/dashboard",
    label: "影子交易",
    path: "/shadow-trading",
    response: emptyDashboard,
  },
  {
    emptyText: "当前没有足够的准备度评分数据",
    endpoint: "/broker/dashboard",
    label: "实盘准备度",
    path: "/live-readiness",
    response: emptyDashboard,
  },
  {
    emptyText: "没有服务状态记录",
    endpoint: "/broker/services?refresh=true",
    label: "服务状态",
    path: "/service-status",
    response: emptyServices,
  },
] as const;
const viewByPath: Record<string, string> = {
  "/broker-accounts": "accounts",
  "/broker-connections": "connections",
  "/broker-sync": "sync",
  "/live-readiness": "readiness",
  "/reconciliation": "reconciliation",
  "/service-status": "services",
  "/shadow-trading": "shadow",
};

test.beforeAll(async () => mkdir(screenshotRoot, { recursive: true }));

async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} 存在页面级横向溢出`).toBeLessThanOrEqual(1);
}

for (const item of pages) {
  test(`${item.label}真实数据库状态且浏览器控制台无错误`, async ({ page }, testInfo) => {
    const runtimeErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (entry) => {
      if (entry.type() === "error") consoleErrors.push(entry.text());
    });
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(`[data-testid="broker-page-${viewName(item.path)}"]`)).toBeVisible();
    await page.waitForTimeout(900);
    await assertNoOverflow(page, item.label);
    expect(runtimeErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}.png`),
    });
  });

  test(`${item.label}加载状态`, async ({ page }, testInfo) => {
    await page.route(`http://localhost:5089${item.endpoint}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.fulfill({
        body: JSON.stringify(item.response),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-testid='broker-loading']")).toBeVisible();
    await assertNoOverflow(page, `${item.label}加载状态`);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-loading.png`),
    });
  });

  test(`${item.label}空数据状态`, async ({ page }, testInfo) => {
    await page.route(`http://localhost:5089${item.endpoint}`, (route) =>
      route.fulfill({
        body: JSON.stringify(item.response),
        contentType: "application/json",
        status: 200,
      }),
    );
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(item.emptyText, { exact: false })).toBeVisible();
    await assertNoOverflow(page, `${item.label}空数据状态`);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-empty.png`),
    });
  });

  test(`${item.label}连接异常状态`, async ({ page }, testInfo) => {
    await page.route(`http://localhost:5089${item.endpoint}`, (route) => route.abort("failed"));
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".service-error")).toBeVisible();
    await assertNoOverflow(page, `${item.label}连接异常状态`);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-error.png`),
    });
  });
}

function viewName(pagePath: string) {
  return viewByPath[pagePath] ?? "unknown";
}
