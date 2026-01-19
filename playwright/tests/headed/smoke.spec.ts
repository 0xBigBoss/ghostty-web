import { expect, test } from "@playwright/test";
import { openHarness } from "../../helpers/harness";

test.describe("BooTTY headed smoke", () => {
  test("boots and renders a prompt line", async ({ page }) => {
    await openHarness(page);
    await page.evaluate(async () => {
      const h = (globalThis as any).__boottyHarness;
      await h.write("smoke-test\r\n");
    });

    const lines = await page.evaluate(() => (globalThis as any).__boottyHarness.readBufferLines());
    expect(lines.join("\n")).toContain("smoke-test");
  });
});
