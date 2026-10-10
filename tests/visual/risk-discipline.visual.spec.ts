import { expect, test } from "@playwright/test";

async function assertNoOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test("风险纪律 Dashboard 展示合成事故核心门禁与审计入口", async ({ page }) => {
  await page.goto("/risk-discipline", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "风险纪律防火墙" })).toBeVisible();
  await expect(page.getByText("Gross Effective Exposure", { exact: true })).toBeVisible();
  await expect(page.getByText("硬风控不可 Override", { exact: true })).toBeVisible();
  await expect(page.getByText("Disposition Effect", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /DLA2 \/ DLB2 杠杆亏损补仓事故复盘|Synthetic Lab 2× ETF 亏损补仓事故/ })).toBeVisible();
  await assertNoOverflow(page);
});

test("Position Incident Replay 明示 Daily MAE approximation 与拆股来源", async ({ page }) => {
  await page.goto("/risk-discipline/incidents/position-incident-synthetic-lab", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("DAILY_MAE_APPROXIMATION", { exact: true })).toBeVisible();
  await expect(page.getByText(/Daily MAE approximation：仅使用 Daily OHLCV/)).toBeVisible();
  await expect(page.getByText(/SYNTHETIC_(CORPORATE_ACTION|SPLIT_FACTOR)/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /杠杆亏损补仓事故/ })).toBeVisible();
  await assertNoOverflow(page);
});
