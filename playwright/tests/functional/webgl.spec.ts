import { expect, test } from "@playwright/test";
import { openHarness } from "../../helpers/harness";

test.describe("BooTTY WebGL renderer", () => {
  test("renders cells with WebGL when available", async ({ page }, testInfo) => {
    const hasWebgl2 = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2"));
    });

    if (!hasWebgl2) {
      testInfo.skip("WebGL2 not available in this environment.");
      return;
    }

    await openHarness(page, { renderer: "webgl" });
    await page.evaluate(async () => {
      const h = (globalThis as any).__boottyHarness;
      await h.write("\x1bc\x1b[31mW\x1b[0m");
    });

    const [cell, rendererKind] = await page.evaluate(() => {
      const h = (globalThis as any).__boottyHarness;
      return [h.readCell(0, 0), h.rendererKind];
    });

    expect(rendererKind).toBe("webgl");
    expect(cell?.char).toBe("W");
  });
});
