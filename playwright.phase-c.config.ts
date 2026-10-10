import { defineConfig } from "@playwright/test";
import base from "./playwright.phase-b.config";

export default defineConfig({ ...base,
  globalSetup: "./tests/phase-c/global-setup.ts",
  use: { ...base.use, storageState: process.env.PHASE_C_BROWSER_STATE },
});
