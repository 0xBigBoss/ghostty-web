import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { WORKLOADS, type Workload } from "../../../lib/workloads";
import { openHarness } from "../../helpers/harness";

const RENDERERS = ["canvas", "webgl"] as const;

const lineScale = Number.parseInt(process.env.BOOTTY_PERF_LINE_SCALE ?? "1", 10);
const rafDelay = Number.parseInt(process.env.BOOTTY_PERF_RAF_DELAY ?? "2", 10);
const chunkDelayMs = Number.parseInt(process.env.BOOTTY_PERF_CHUNK_DELAY_MS ?? "0", 10);
const minFramesTarget = Number.parseInt(process.env.BOOTTY_PERF_MIN_FRAMES ?? "60", 10);

const baseWorkloads = Object.values(WORKLOADS);
const workloadList: readonly Workload[] =
  lineScale === 1
    ? baseWorkloads
    : baseWorkloads.map((workload) => ({
        ...workload,
        name: `${workload.name}x${lineScale}`,
        description: `${workload.description} (x${lineScale})`,
        chunks: Array.from({ length: lineScale }, () => workload.chunks).flat(),
      }));

async function collectPerf(page: Page, renderer: string, workload: Workload) {
  await openHarness(page, { renderer });
  await page.evaluate(({ cols, rows }) => (globalThis as any).__boottyHarness.resize(cols, rows), {
    cols: workload.cols,
    rows: workload.rows,
  });
  await page.evaluate(() => (globalThis as any).__boottyHarness.resetPerf());
  await page.evaluate(
    ({ chunks, rafDelay, chunkDelayMs }) =>
      (globalThis as any).__boottyHarness.writeChunks(chunks, {
        rafDelay,
        chunkDelayMs,
        yieldEvery: 1,
      }),
    { chunks: workload.chunks, rafDelay, chunkDelayMs },
  );

  const minFrames = Math.min(workload.chunks.length, minFramesTarget);
  await page.waitForFunction(
    (minFrames: number) => {
      const perf = (globalThis as any).__boottyHarness.getPerf();
      const frames = perf?.summary?.events?.["bootty:render:frame"]?.count ?? 0;
      return frames >= minFrames;
    },
    minFrames,
    { timeout: 30_000 },
  );

  const includeEvents = process.env.BOOTTY_PERF_EVENTS === "1";
  return page.evaluate((options) => (globalThis as any).__boottyHarness.getPerf(options), {
    includeEvents,
    limit: 20000,
  });
}

test.describe("@perf BooTTY perf harness", () => {
  for (const renderer of RENDERERS) {
    for (const workload of workloadList) {
      test(`collects perf summary (${renderer}/${workload.name})`, async ({ page }) => {
        const perf = await collectPerf(page, renderer, workload);

        const summary = perf.summary;
        expect(summary.totalEvents).toBeGreaterThan(0);
        expect(summary.events).toHaveProperty("bootty:render:frame");

        await test.info().attach(`perf-summary-${renderer}-${workload.name}.json`, {
          body: JSON.stringify(summary, null, 2),
          contentType: "application/json",
        });

        if (process.env.BOOTTY_SAVE_PERF === "1") {
          const outputDir = path.join(process.cwd(), "playwright", "results");
          await fs.mkdir(outputDir, { recursive: true });
          await fs.writeFile(
            path.join(outputDir, `perf-${renderer}-${workload.name}.json`),
            JSON.stringify(perf, null, 2),
          );
        }
      });
    }
  }
});
