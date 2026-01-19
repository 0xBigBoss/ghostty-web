import { expect, test } from "@playwright/test";
import { FIXTURES } from "../../../lib/fixtures";
import { openHarness } from "../../helpers/harness";

test.describe("BooTTY Playwright Harness", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test("renders basic text fixture", async ({ page }) => {
    const fixture = FIXTURES.basicText;
    await page.evaluate((input) => (globalThis as any).__boottyHarness.write(input), fixture.input);

    const lines = await page.evaluate(() => (globalThis as any).__boottyHarness.readBufferLines());
    for (const token of fixture.expected?.contains ?? []) {
      expect(lines.join("\n")).toContain(token);
    }
  });

  test("pushes scrollback for burst fixture", async ({ page }) => {
    const fixture = FIXTURES.scrollbackBurst;
    await page.evaluate((input) => (globalThis as any).__boottyHarness.write(input), fixture.input);

    const scrollback = await page.evaluate(() =>
      (globalThis as any).__boottyHarness.getScrollbackLength(),
    );
    expect(scrollback).toBeGreaterThanOrEqual(fixture.expected?.minScrollback ?? 1);
  });

  test("handles unicode fixture", async ({ page }) => {
    const fixture = FIXTURES.unicodeWide;
    await page.evaluate((input) => (globalThis as any).__boottyHarness.write(input), fixture.input);

    const lines = await page.evaluate(() => (globalThis as any).__boottyHarness.readBufferLines());
    const bufferText = lines.join("\n");
    for (const token of fixture.expected?.contains ?? []) {
      expect(bufferText).toContain(token);
    }
  });
});
