import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  const password = process.env.SEED_ADMIN_PASSWORD;
  expect(Boolean(password), "Load credentials from the protected isolated Demo environment").toBe(true);
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码", { exact: true }).fill(password!);
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST"),
    page.getByRole("button", { name: "安全登录" }).click(),
  ]);
  expect(response.status()).toBe(201);
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByText("DLA2", { exact: true }).first()).toBeVisible();
}

test("A login, B login, A access, B logout, A remains authenticated; Demo stays read-only", async ({ browser, baseURL }, testInfo) => {
  expect(new URL(baseURL!).hostname, "These acceptance tests use only the local isolated runtime").toMatch(/^(localhost|127\.0\.0\.1)$/);
  const options = { ...testInfo.project.use, baseURL, ignoreHTTPSErrors: true };
  const a = await browser.newContext(options);
  const b = await browser.newContext(options);
  try {
    const pageA = await a.newPage();
    const pageB = await b.newPage();
    await login(pageA);
    const cookiesA = await a.cookies();
    await login(pageB);
    const cookiesB = await b.cookies();
    const sessionA = cookiesA.find((cookie) => cookie.name === "xichu_session")!;
    const sessionB = cookiesB.find((cookie) => cookie.name === "xichu_session")!;
    expect(Boolean(sessionA?.httpOnly && sessionA?.secure && sessionB?.httpOnly && sessionB?.secure)).toBe(true);
    expect(sessionA.value !== sessionB.value, "Visitors receive independent random session tokens").toBe(true);
    const csrfA = cookiesA.find((cookie) => cookie.name === "xichu_csrf")!;
    const csrfB = cookiesB.find((cookie) => cookie.name === "xichu_csrf")!;
    expect(csrfA.value !== csrfB.value, "Visitors receive independent CSRF tokens").toBe(true);
    expect((await a.request.get("/api/auth/session")).status()).toBe(200);
    const risk = await a.request.get("/api/risk/summary");
    expect(risk.status()).toBe(200);
    expect((await risk.json()).dataOrigin).toBe("DEMO");
    const crossed = await b.request.post("/api/auth/logout", { headers: { Origin: baseURL!, "X-CSRF-Token": csrfA.value }, data: {} });
    expect(crossed.status()).toBe(403);
    expect((await b.request.get("/api/auth/session")).status()).toBe(200);
    for (const path of ["/imports/preview", "/backtests/run", "/paper-execution/orders", "/broker-sync/run", "/risk-rules/one"]) {
      const denied = await a.request.post(`/api${path}`, { headers: { Origin: baseURL!, "X-CSRF-Token": csrfA.value }, data: {} });
      expect(denied.status(), `Business write ${path} stays disabled`).toBe(403);
    }
    await pageA.reload();
    await expect(pageA.getByText("DLA2", { exact: true }).first()).toBeVisible();
    await pageA.screenshot({ path: `output/playwright/public-demo/${testInfo.project.name}-A-after-B-login.png` });
    await pageB.getByRole("button", { name: "退出当前会话" }).click();
    await pageB.waitForURL((url) => url.pathname === "/login");
    expect((await b.request.get("/api/auth/session")).status()).toBe(401);
    expect((await a.request.get("/api/auth/session")).status()).toBe(200);
    await pageA.reload();
    await expect(pageA.getByText("DLA2", { exact: true }).first()).toBeVisible();
    expect((await a.request.get("/api/auth/session")).status()).toBe(200);
    await pageA.screenshot({ path: `output/playwright/public-demo/${testInfo.project.name}-A-after-B-logout.png` });
    await testInfo.attach("dual-visitor-evidence", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      A_login: 201, B_login: 201, independent_sessions: true, independent_csrf: true,
      A_after_B_login: 200, crossed_csrf_logout: 403, business_writes: 403,
      B_after_logout: 401, A_after_B_logout: 200, data_origin: "DEMO", secure_http_only_cookies: true,
    }, null, 2)) });
    await pageA.getByRole("button", { name: "退出当前会话" }).click();
    await pageA.waitForURL((url) => url.pathname === "/login");
  } finally {
    await a.close(); await b.close();
  }
});
