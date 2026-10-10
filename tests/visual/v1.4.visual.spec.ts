import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshotRoot = path.resolve("Agent", "Screenshots", "V1.4");

const pages = [
  ["首页总览", "/"],
  ["账户表现", "/performance"],
  ["数据导入", "/imports"],
  ["行情中心", "/market-data"],
  ["策略管理", "/strategies"],
  ["回测中心", "/backtests"],
  ["策略验证", "/validations"],
  ["信号中心", "/signals"],
  ["模拟交易", "/paper-trading"],
  ["持仓监控", "/positions"],
  ["风控红线", "/risk"],
  ["买入审查", "/trade-plans"],
  ["交易记录", "/trades"],
  ["交易复盘", "/reviews"],
  ["标的管理", "/instruments"],
  ["系统设置", "/settings"],
] as const;

test.beforeAll(async () => {
  await mkdir(screenshotRoot, { recursive: true });
});

for (const [label, route] of pages) {
  test(`${label}正常状态无页面级横向溢出`, async ({ page }, testInfo) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(700);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow, `${label} 存在页面级横向溢出`).toBeLessThanOrEqual(1);
    expect(runtimeErrors, `${label} 存在浏览器运行时错误`).toEqual([]);

    const slug = route === "/" ? "home" : route.slice(1).replaceAll("/", "-");
    await page.screenshot({
      path: path.join(screenshotRoot, `${testInfo.project.name}-${slug}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

async function assertNoPageOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test("策略验证加载状态", async ({ page }, testInfo) => {
  await page.route("http://localhost:5089/strategy-validations", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.fulfill({ body: "[]", contentType: "application/json", status: 200 });
  });
  await page.goto("/validations", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在读取验证任务、窗口和压力结果…")).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({
    path: path.join(screenshotRoot, `${testInfo.project.name}-validations-loading.png`),
    fullPage: true,
    animations: "disabled",
  });
});

test("策略验证空状态", async ({ page }, testInfo) => {
  await page.route("http://localhost:5089/strategy-validations", (route) =>
    route.fulfill({ body: "[]", contentType: "application/json", status: 200 }),
  );
  await page.goto("/validations", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("尚未选择真实验证结果")).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({
    path: path.join(screenshotRoot, `${testInfo.project.name}-validations-empty.png`),
    fullPage: true,
    animations: "disabled",
  });
});

test("策略验证服务错误状态", async ({ page }, testInfo) => {
  await page.route("http://localhost:5089/strategy-validations", (route) => route.abort("failed"));
  await page.goto("/validations", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/策略验证 API 或 quant-engine 不可用/)).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({
    path: path.join(screenshotRoot, `${testInfo.project.name}-validations-error.png`),
    fullPage: true,
    animations: "disabled",
  });
});

const emptyPaperDashboard = JSON.stringify({
  accounts: [],
  control: { killSwitchEnabled: false, reason: null },
  events: [],
  fills: [],
  orders: [],
  riskDecisions: [],
  safeguards: {},
});

test("模拟交易加载状态", async ({ page }, testInfo) => {
  await page.route("http://localhost:5089/paper-trading/dashboard", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.fulfill({ body: emptyPaperDashboard, contentType: "application/json", status: 200 });
  });
  await page.goto("/paper-trading", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("正在读取独立模拟账本、订单和成交…")).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({
    path: path.join(screenshotRoot, `${testInfo.project.name}-paper-trading-loading.png`),
    fullPage: true,
    animations: "disabled",
  });
});

test("模拟交易空状态", async ({ page }, testInfo) => {
  await page.route("http://localhost:5089/paper-trading/dashboard", (route) =>
    route.fulfill({ body: emptyPaperDashboard, contentType: "application/json", status: 200 }),
  );
  await page.goto("/paper-trading", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("尚无策略部署")).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({
    path: path.join(screenshotRoot, `${testInfo.project.name}-paper-trading-empty.png`),
    fullPage: true,
    animations: "disabled",
  });
});

test("模拟交易服务错误状态", async ({ page }, testInfo) => {
  await page.route("http://localhost:5089/paper-trading/dashboard", (route) => route.abort("failed"));
  await page.goto("/paper-trading", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/模拟交易 API 不可用/)).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({
    path: path.join(screenshotRoot, `${testInfo.project.name}-paper-trading-error.png`),
    fullPage: true,
    animations: "disabled",
  });
});
