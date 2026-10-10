import { expect, test } from "@playwright/test";

type MarketClockResponse = {
  overnightSession: MarketClockSession;
  regularSession: MarketClockSession;
  statusLabel: string;
};

type MarketClockSession = {
  endBeijing: string;
  endDayOffset: number;
  startBeijing: string;
};

function sessionLabel(session: MarketClockSession) {
  return `${session.startBeijing}–${session.endDayOffset > 0 ? "次日" : ""}${session.endBeijing}`;
}

test("顶部交易时钟展示真实 API 返回的北京时间", async ({ page, request }) => {
  const response = await request.get("http://localhost:5089/operations/market-clock");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as MarketClockResponse;

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const clock = page.locator(".market-clock");
  await expect(clock).toBeVisible();
  await expect(clock).toContainText(`美股开盘${sessionLabel(payload.regularSession)}`);
  await expect(clock).toContainText(`IBKR 夜盘${sessionLabel(payload.overnightSession)}`);
  await expect(clock).toContainText(payload.statusLabel);

  const currentTime = clock.locator(".market-clock__now strong");
  await expect(currentTime).toHaveText(/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/);
  const firstTick = await currentTime.textContent();
  await page.waitForTimeout(1_100);
  await expect(currentTime).not.toHaveText(firstTick ?? "");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
