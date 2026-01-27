import { expect, test, type Page } from "@playwright/test";
import { openHarness } from "../../helpers/harness";

const BS = 0x08;
const CSI_D = [0x1b, 0x5b, 0x44];

const writeText = async (page: Page, text: string): Promise<void> => {
  await page.evaluate((payload) => (globalThis as any).__boottyHarness.write(payload), text);
};

const writeBytes = async (page: Page, bytes: readonly number[]): Promise<void> => {
  await page.evaluate((payload) => {
    const h = (globalThis as any).__boottyHarness;
    const data = new Uint8Array(payload);
    return h.write(data);
  }, Array.from(bytes));
};

const readViewportLine = async (page: Page, row: number): Promise<string> => {
  return page.evaluate((line) => (globalThis as any).__boottyHarness.readViewportLine(line), row);
};

test.describe("BooTTY backspace cursor behavior", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test("BS and CSI-D cursor movement should be equivalent", async ({ page }) => {
    // Baseline: write "$ bash", move left 4 via BS, then overwrite with "X".
    await writeText(page, "$ bash");
    await writeBytes(page, [BS, BS, BS, BS]);
    await writeText(page, "X");

    const bsLine = await readViewportLine(page, 0);
    expect(bsLine).toBe("$ Xash");

    // Reset and repeat using CSI-D instead of BS.
    await writeText(page, "\x1bc");
    await writeText(page, "$ bash");
    await writeBytes(page, [...CSI_D, ...CSI_D, ...CSI_D, ...CSI_D]);
    await writeText(page, "X");

    const csiLine = await readViewportLine(page, 0);
    expect(csiLine).toBe("$ Xash");
  });

  test("zsh syntax highlighting sequence should preserve spacing", async ({ page }) => {
    // Reproduce the exact scenario from the bug report:
    // 1. Shell has displayed "$ bash" with cursor at col 5 (after 'as', before 'h')
    // 2. User types 'h', triggering zsh syntax highlighting
    // 3. zsh sends BS + styled "sh" + 4xBS + styled "bash" to recolor in place
    // Without the fix, cursor tracking drifts and overwrites the space
    await writeText(page, "$ bash");
    // Position cursor at col 5 (where zsh highlighting sequence expects it)
    await writeBytes(page, [BS]);
    const zshSequence = [
      0x08, 0x1b, 0x5b, 0x31, 0x6d, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x73, 0x1b,
      0x5b, 0x31, 0x6d, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x68, 0x1b, 0x5b,
      0x30, 0x6d, 0x1b, 0x5b, 0x33, 0x39, 0x6d, 0x08, 0x08, 0x08, 0x08,
      0x1b, 0x5b, 0x30, 0x6d, 0x1b, 0x5b, 0x33, 0x32, 0x6d, 0x62, 0x1b,
      0x5b, 0x30, 0x6d, 0x1b, 0x5b, 0x33, 0x32, 0x6d, 0x61, 0x1b, 0x5b,
      0x30, 0x6d, 0x1b, 0x5b, 0x33, 0x32, 0x6d, 0x73, 0x1b, 0x5b, 0x30,
      0x6d, 0x1b, 0x5b, 0x33, 0x32, 0x6d, 0x68, 0x1b, 0x5b, 0x33, 0x39,
      0x6d,
    ];
    await writeBytes(page, zshSequence);

    const line = await readViewportLine(page, 0);
    // Bug manifests as "$bashh" (space lost, extra "h").
    expect(line).not.toContain("$bashh");
    expect(line).toContain("$ bash");
  });

  test("cumulative BS cursor movement should not drift", async ({ page }) => {
    // 8x backspace should return cursor to column 0 before writing "X".
    await writeText(page, "abcdefgh");
    await writeBytes(page, [BS, BS, BS, BS, BS, BS, BS, BS]);
    await writeText(page, "X");

    const line = await readViewportLine(page, 0);
    expect(line).toBe("Xbcdefgh");
  });
});
