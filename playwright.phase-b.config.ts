import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Run the existing desktop/mobile suite against fixed builds in an isolated database.
export default defineConfig({
  ...base,
  webServer: [
    { command: "corepack pnpm --filter web start:prod", url: "http://localhost:5088", reuseExistingServer: false, timeout: 120000 },
    { command: "corepack pnpm --filter api start:prod", url: "http://localhost:5089/health", reuseExistingServer: false, timeout: 120000 },
    { command: "corepack pnpm --filter quant-engine start:prod", url: "http://localhost:5091/health", reuseExistingServer: false, timeout: 120000 },
    { command: "corepack pnpm --filter broker-connector start:prod", url: "http://localhost:5092/health", reuseExistingServer: false, timeout: 120000 },
  ],
});
