import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshotRoot = path.resolve("Agent", "Screenshots", "V1.5");
const pages = [
  { emptyText: "尚无真实质量报告", endpoint: "/operations/data-quality", label: "数据质量", loadingText: "正在读取 Provider、同步任务和质量报告…", path: "/data-quality", response: { providers: [], reports: [], safeguards: {}, syncJobs: [] } },
  { emptyText: "没有符合筛选条件的任务", endpoint: "/operations/tasks", label: "任务中心", loadingText: "正在读取任务账本…", path: "/tasks", response: [] },
  { emptyText: "当前没有系统通知", endpoint: "/operations/notifications", label: "通知中心", loadingText: "正在读取系统通知…", path: "/notifications", response: [] },
  { emptyText: "尚无 PAPER_RUNNING / PAPER_OBSERVING 策略数据", endpoint: "/operations/forward-observations", label: "前向观察", loadingText: "正在读取模拟成交、验证和回测对比…", path: "/forward-observation", response: [] },
] as const;

test.beforeAll(async () => mkdir(screenshotRoot, { recursive: true }));

async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} 存在页面级横向溢出`).toBeLessThanOrEqual(1);
}

for (const item of pages) {
  test(`${item.label}真实数据状态`, async ({ page }, testInfo) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(900);
    await assertNoOverflow(page, item.label);
    expect(runtimeErrors).toEqual([]);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}.png`) });
  });

  test(`${item.label}加载状态`, async ({ page }, testInfo) => {
    await page.route(`http://localhost:5089${item.endpoint}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.fulfill({ body: JSON.stringify(item.response), contentType: "application/json", status: 200 });
    });
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(item.loadingText)).toBeVisible();
    await assertNoOverflow(page, `${item.label}加载状态`);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-loading.png`) });
  });

  test(`${item.label}空状态`, async ({ page }, testInfo) => {
    await page.route(`http://localhost:5089${item.endpoint}`, (route) => route.fulfill({ body: JSON.stringify(item.response), contentType: "application/json", status: 200 }));
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(item.emptyText, { exact: false })).toBeVisible();
    await assertNoOverflow(page, `${item.label}空状态`);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-empty.png`) });
  });

  test(`${item.label}错误状态`, async ({ page }, testInfo) => {
    await page.route(`http://localhost:5089${item.endpoint}`, (route) => route.abort("failed"));
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".service-error")).toBeVisible();
    await assertNoOverflow(page, `${item.label}错误状态`);
    await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(screenshotRoot, `${testInfo.project.name}-${item.path.slice(1)}-error.png`) });
  });
}
