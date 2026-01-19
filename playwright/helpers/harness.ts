import { expect, type Page } from "@playwright/test";

const HARNESS_PATH = "/playwright/harness/index.html";

type HarnessOptions = Readonly<{
  renderer?: string;
}>;

export async function openHarness(page: Page, options: HarnessOptions = {}): Promise<void> {
  const url = options.renderer
    ? `${HARNESS_PATH}?renderer=${encodeURIComponent(options.renderer)}`
    : HARNESS_PATH;

  await page.goto(url);

  const ready = page.getByTestId("ready");
  await expect(ready).toBeVisible();

  const status = await ready.getAttribute("data-status");
  if (status === "error") {
    const message = await ready.textContent();
    throw new Error(`Harness init failed: ${message ?? "unknown error"}`);
  }

  await page.waitForFunction(
    () =>
      Boolean(
        (globalThis as { __boottyHarness?: { terminal?: unknown } }).__boottyHarness?.terminal,
      ),
    undefined,
    { timeout: 15_000 },
  );
}
