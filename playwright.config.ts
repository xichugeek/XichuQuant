import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5088",
    colorScheme: "dark",
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-1920x1080",
      use: { viewport: { width: 1920, height: 1080 } },
    },
    {
      name: "mobile-390x844",
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: [
    {
      command: "corepack pnpm dev:web",
      url: "http://localhost:5088",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "corepack pnpm dev:api",
      url: "http://localhost:5089/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "corepack pnpm dev:quant",
      url: "http://localhost:5091/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "corepack pnpm dev:broker",
      url: "http://localhost:5092/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
