import { expect, test } from "@playwright/test";
import { openHarness } from "../../helpers/harness";

const CELL_FLAG_BOLD = 1;

test.describe("BooTTY terminal behavior", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test("applies SGR color changes to cells", async ({ page }) => {
    await page.evaluate(async () => {
      const h = (globalThis as any).__boottyHarness;
      await h.write("\x1bcA\r\n\x1b[31mR\x1b[0m");
    });

    const [defaultCell, redCell] = await page.evaluate(() => {
      const h = (globalThis as any).__boottyHarness;
      return [h.readCell(0, 0), h.readCell(1, 0)];
    });

    expect(defaultCell?.char).toBe("A");
    expect(redCell?.char).toBe("R");
    expect(defaultCell).not.toBeNull();
    expect(redCell).not.toBeNull();

    const fgDefault = defaultCell.fg;
    const fgRed = redCell.fg;
    const colorDiffers =
      fgDefault.r !== fgRed.r || fgDefault.g !== fgRed.g || fgDefault.b !== fgRed.b;
    expect(colorDiffers).toBe(true);
  });

  test("sets bold flag on bold text", async ({ page }) => {
    await page.evaluate(async () => {
      const h = (globalThis as any).__boottyHarness;
      await h.write("\x1bc\x1b[1mB\x1b[0m");
    });

    const cell = await page.evaluate(() => {
      const h = (globalThis as any).__boottyHarness;
      return h.readCell(0, 0);
    });

    expect(cell?.char).toBe("B");
    expect(cell).not.toBeNull();
    expect((cell.flags & CELL_FLAG_BOLD) !== 0).toBe(true);
  });

  test("resizes terminal grid", async ({ page }) => {
    const before = await page.evaluate(() => (globalThis as any).__boottyHarness.getSize());

    await page.evaluate(() => (globalThis as any).__boottyHarness.resize(100, 30));
    const after = await page.evaluate(() => (globalThis as any).__boottyHarness.getSize());

    expect(before).not.toEqual(after);
    expect(after.cols).toBe(100);
    expect(after.rows).toBe(30);
  });

  test("handles burst SGR output without stalling", async ({ page }) => {
    const burstLines = Array.from({ length: 80 }, (_, i) => {
      const index = String(i + 1).padStart(3, "0");
      return `\x1b[32mB-${index}\x1b[0m`;
    });
    const burst = burstLines.join("\r\n");

    await page.evaluate(async (payload) => {
      const h = (globalThis as any).__boottyHarness;
      await h.write(`${payload}\r\nBURST_DONE\r\n`);
    }, burst);

    const lines = await page.evaluate(() => (globalThis as any).__boottyHarness.readBufferLines());
    expect(lines.join("\n")).toContain("BURST_DONE");
  });
});
