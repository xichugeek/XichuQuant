import { chromium, type FullConfig } from "@playwright/test";
import assert from "node:assert/strict";

export default async function setup(config: FullConfig) {
  const password = process.env.SEED_ADMIN_PASSWORD;
  const state = process.env.PHASE_C_BROWSER_STATE;
  assert.ok(password && state, "Use a protected isolated test environment; credentials are never hardcoded.");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("http://localhost:5088/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码", { exact:true }).fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("http://localhost:5088/");
    await page.getByText("DLA2", { exact:true }).first().waitFor();
    const cookies = await context.cookies();
    assert.ok(cookies.some(cookie => cookie.name === "xichu_session" && cookie.httpOnly && cookie.secure));
    const response = await context.request.get("http://localhost:5089/auth/session");
    assert.equal(response.status(),200,"Real production session must be authenticated");
    await context.storageState({ path:state });
    for (const project of config.projects) project.use.storageState=state;
  } finally { await browser.close(); }
}
