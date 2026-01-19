import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number.parseInt(process.env.BOOTTY_TEST_PORT ?? "4173", 10);
const baseURL = process.env.BOOTTY_TEST_BASE_URL ?? `http://127.0.0.1:${port}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(__dirname, "playwright", "tests"),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: "functional",
      testMatch: "**/functional/**/*.spec.ts",
    },
    {
      name: "headed",
      testMatch: "**/headed/**/*.spec.ts",
      use: {
        headless: false,
      },
    },
    {
      name: "perf",
      testMatch: "**/perf/**/*.spec.ts",
      grep: /@perf/,
    },
  ],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `node playwright/server.mjs`,
    url: baseURL,
    reuseExistingServer: process.env.CI ? false : true,
    timeout: 120_000,
    cwd: __dirname,
  },
});
