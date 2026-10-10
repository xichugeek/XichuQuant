import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/public-demo",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "output/playwright/public-demo/results.json" }]],
  outputDir: "output/playwright/public-demo/artifacts",
  use: {
    baseURL: process.env.PUBLIC_DEMO_BASE_URL ?? "https://localhost:5443",
    ignoreHTTPSErrors: true, // Only the local acceptance certificate; target TLS needs separate verification.
    locale: "zh-CN",
    trace: "off", // Never persist login passwords or session cookies in traces.
    screenshot: "off",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
