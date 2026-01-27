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

  test("CSI D with count should move cursor correctly", async ({ page }) => {
    // Test that CSI nD (cursor back with count) works correctly
    const readCursor = async () =>
      page.evaluate(() => (globalThis as any).__boottyHarness.terminal.wasmTerm?.getCursor());

    // Write 20 characters to get cursor at x=20
    await writeText(page, "01234567890123456789");
    const before = await readCursor();
    expect(before).toMatchObject({ x: 20, y: 0 });

    // CSI 14D should move cursor from x=20 to x=6
    await writeBytes(page, [0x1b, 0x5b, 0x31, 0x34, 0x44]); // ESC[14D
    const after = await readCursor();
    expect(after).toMatchObject({ x: 6, y: 0 });

    // Write X to verify position
    await writeText(page, "X");
    const line = await readViewportLine(page, 0);
    expect(line).toBe("012345X7890123456789");
  });

  test("zsh autosuggest sequence cursor position tracking", async ({ page }) => {
    // Simplified test focusing on cursor position tracking
    const readCursor = async () =>
      page.evaluate(() => (globalThis as any).__boottyHarness.terminal.wasmTerm?.getCursor());

    // Setup: "$ echo hello world" with cursor at position 4 (after "$ ec")
    await writeText(page, "$ echo hello world");
    // Use CSI 14D to position cursor (18 - 14 = 4)
    await writeBytes(page, [0x1b, 0x5b, 0x31, 0x34, 0x44]);

    const cursor = await readCursor();
    expect(cursor).toMatchObject({ x: 4, y: 0 });

    // Now do the write#10 sequence:
    // BS→3, write "ho"→5, 4xBS→1, write "echo"→5
    await writeBytes(page, [
      0x08,  // BS: x=4→3
    ]);
    expect((await readCursor()).x).toBe(3);

    await writeText(page, "ho");  // x=3→5
    expect((await readCursor()).x).toBe(5);

    await writeBytes(page, [0x08, 0x08, 0x08, 0x08]);  // 4xBS: x=5→1
    expect((await readCursor()).x).toBe(1);

    await writeText(page, "echo");  // x=1→5
    expect((await readCursor()).x).toBe(5);

    // The result: "echo" was written at positions 1-4, overwriting the space
    const line = await readViewportLine(page, 0);
    // Position 0: $, Position 1: e (was space), Position 2: c, Position 3: h, Position 4: o
    // This is the mathematically correct result for this sequence
    expect(line).toBe("$echoo hello world");
  });

  test("plain text echo renders without BS or CR", async ({ page }) => {
    // This simulates bash PTY echo: simple character-by-character output
    // No backspace, no carriage return until newline
    const readCursor = async () =>
      page.evaluate(() => (globalThis as any).__boottyHarness.terminal.wasmTerm?.getCursor());

    // Write prompt
    await writeText(page, "bash$ ");
    expect((await readCursor()).x).toBe(6);

    // Simulate typing each character (as PTY echo would deliver)
    await writeText(page, "e");
    expect((await readCursor()).x).toBe(7);
    await writeText(page, "c");
    expect((await readCursor()).x).toBe(8);
    await writeText(page, "h");
    expect((await readCursor()).x).toBe(9);
    await writeText(page, "o");
    expect((await readCursor()).x).toBe(10);
    await writeText(page, " ");
    expect((await readCursor()).x).toBe(11);
    await writeText(page, "h");
    expect((await readCursor()).x).toBe(12);
    await writeText(page, "i");
    expect((await readCursor()).x).toBe(13);

    // Verify all characters rendered correctly
    const line = await readViewportLine(page, 0);
    expect(line).toBe("bash$ echo hi");
  });

  test("plain text echo via Uint8Array renders correctly", async ({ page }) => {
    // Same as above but using Uint8Array (the actual PTY data format)
    const readCursor = async () =>
      page.evaluate(() => (globalThis as any).__boottyHarness.terminal.wasmTerm?.getCursor());

    // Write prompt as bytes
    const prompt = Array.from("bash$ ").map(c => c.charCodeAt(0));
    await writeBytes(page, prompt);
    expect((await readCursor()).x).toBe(6);

    // Write echo characters as bytes (simulating real PTY output)
    const echo = Array.from("echo hello world").map(c => c.charCodeAt(0));
    await writeBytes(page, echo);

    // Verify all characters rendered correctly
    const line = await readViewportLine(page, 0);
    expect(line).toBe("bash$ echo hello world");
    expect((await readCursor()).x).toBe(22);
  });
});
