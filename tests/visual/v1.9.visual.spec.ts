import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshotRoot = path.resolve("Agent", "Screenshots", "V1.9");
const emptyDashboard = {
  backup: null,
  blockingMessages: [
    "BLOCKED：缺少外部 IBKR Paper 环境或端到端订单证据",
    "BLOCKED：缺少 Linux Docker 运行环境实测证据",
    "BLOCKED：Soak Test 尚未实际连续运行满 72 小时",
  ],
  bundles: [],
  evidences: [],
  external: {
    blockedReason: "缺少外部 IBKR Paper 环境",
    certificationType: "IBKR_PAPER",
    completedAt: null,
    environment: "win32",
    maskedAccount: null,
    prerequisites: {},
    result: {},
    startedAt: null,
    status: "BLOCKED",
  },
  externalOrderEvidence: {
    executionCount: 0,
    orderId: null,
    reason: "尚无非 Fixture 的外部 IBKR Paper 订单闭环证据",
    status: "BLOCKED",
  },
  faults: [],
  integrity: null,
  linux: {
    blockedReason: "缺少 Linux Docker 运行环境",
    certificationType: "LINUX_DOCKER",
    completedAt: null,
    environment: "win32",
    prerequisites: {},
    result: {},
    startedAt: null,
    status: "BLOCKED",
  },
  readinessStatus: "NOT_READY",
  releaseStatus: "PARTIALLY_COMPLETED",
  securityChecklist: [],
  soak: null,
  version: "1.9.0",
};

const pages = [
  { emptyText: "缺少外部 IBKR Paper 环境", label: "外部认证", path: "/external-certification", view: "external" },
  { emptyText: "尚无非 Fixture", label: "IBKR Paper 认证", path: "/ibkr-paper-certification", view: "paper" },
  { emptyText: "缺少 Linux Docker", label: "Linux 认证", path: "/linux-certification", view: "linux" },
  { emptyText: "尚无真实 Soak", label: "长时间稳定性", path: "/soak-testing", view: "soak" },
  { emptyText: "尚无故障演练场景", label: "故障注入", path: "/fault-injection", view: "faults" },
  { emptyText: "尚未运行账本完整性检查", label: "账本完整性", path: "/ledger-integrity", view: "integrity" },
  { emptyText: "尚无认证证据", label: "发布证据", path: "/release-evidence", view: "evidence" },
] as const;

test.beforeAll(async () => mkdir(screenshotRoot, { recursive: true }));

async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} 存在页面级横向溢出`).toBeLessThanOrEqual(1);
}

for (const item of pages) {
  test(`${item.label}真实证据状态且控制台无错误`, async ({ page }, testInfo) => {
    const runtimeErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (entry) => {
      if (entry.type() === "error") consoleErrors.push(entry.text());
    });
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(`[data-testid="certification-page-${item.view}"]`)).toBeVisible();
    await expect(page.getByText("EXTERNAL CERTIFICATION · PAPER ONLY", { exact: true })).toBeVisible();
    await page.waitForTimeout(700);
    await assertNoOverflow(page, item.label);
    expect(runtimeErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}.png`) });
  });

  test(`${item.label}加载状态`, async ({ page }, testInfo) => {
    await page.route("http://localhost:5089/certification/dashboard", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.fulfill({ body: JSON.stringify(emptyDashboard), contentType: "application/json", status: 200 });
    });
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-testid='certification-loading']")).toBeVisible();
    await assertNoOverflow(page, `${item.label}加载状态`);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-loading.png`) });
  });

  test(`${item.label}空数据状态`, async ({ page }, testInfo) => {
    await page.route("http://localhost:5089/certification/dashboard", (route) =>
      route.fulfill({ body: JSON.stringify(emptyDashboard), contentType: "application/json", status: 200 }),
    );
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(item.emptyText, { exact: false }).first()).toBeVisible();
    await assertNoOverflow(page, `${item.label}空数据状态`);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-empty.png`) });
  });

  test(`${item.label}连接异常状态`, async ({ page }, testInfo) => {
    await page.route("http://localhost:5089/certification/dashboard", (route) => route.abort("failed"));
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-testid='certification-error']")).toBeVisible();
    await expect(page.getByText("不会用 Mock 数据伪装成功", { exact: false })).toBeVisible();
    await assertNoOverflow(page, `${item.label}连接异常状态`);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-error.png`) });
  });
}
