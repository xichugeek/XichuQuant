import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshotRoot = path.resolve("Agent", "Screenshots", "V1.6");
const emptyDashboard = {
  availableStrategies: [],
  control: { killSwitchEnabled: false, reason: null },
  portfolio: null,
  safeguards: {},
};
const pages = [
  {
    emptyText: "创建第一个模拟组合",
    label: "策略组合",
    loadingText: "正在读取组合资金池、成员策略和审计记录…",
    path: "/portfolios",
  },
  {
    emptyText: "请先在“策略组合”创建组合",
    label: "资金分配",
    loadingText: "正在读取资金池和分配版本…",
    path: "/capital-allocation",
  },
  {
    emptyText: "尚无策略组合",
    label: "再平衡中心",
    loadingText: "正在读取原始信号和再平衡历史…",
    path: "/rebalance-center",
  },
  {
    emptyText: "尚无组合绩效数据",
    label: "组合表现",
    loadingText: "正在计算组合绩效、归因和相关性…",
    path: "/portfolio-performance",
  },
] as const;

test.beforeAll(async () => mkdir(screenshotRoot, { recursive: true }));

async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} 存在页面级横向溢出`).toBeLessThanOrEqual(1);
}

for (const item of pages) {
  test(`${item.label}真实数据库状态`, async ({ page }, testInfo) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(900);
    await assertNoOverflow(page, item.label);
    expect(runtimeErrors).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}.png`),
    });
  });

  test(`${item.label}加载状态`, async ({ page }, testInfo) => {
    await page.route("http://localhost:5089/portfolios/dashboard", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.fulfill({
        body: JSON.stringify(emptyDashboard),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(item.loadingText)).toBeVisible();
    await assertNoOverflow(page, `${item.label}加载状态`);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-loading.png`),
    });
  });

  test(`${item.label}空状态`, async ({ page }, testInfo) => {
    await page.route("http://localhost:5089/portfolios/dashboard", (route) =>
      route.fulfill({
        body: JSON.stringify(emptyDashboard),
        contentType: "application/json",
        status: 200,
      }),
    );
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(item.emptyText, { exact: false })).toBeVisible();
    await assertNoOverflow(page, `${item.label}空状态`);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-empty.png`),
    });
  });

  test(`${item.label}错误状态`, async ({ page }, testInfo) => {
    await page.route("http://localhost:5089/portfolios/dashboard", (route) =>
      route.abort("failed"),
    );
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".service-error")).toBeVisible();
    await assertNoOverflow(page, `${item.label}错误状态`);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-error.png`),
    });
  });
}
