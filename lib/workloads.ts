/**
 * Deterministic workloads for perf and integration tests.
 *
 * These mimic PTY-style chunked output to exercise renderer pipelines.
 */

import { FIXTURE_SIZES } from "./fixtures";

export type Workload = Readonly<{
  name: string;
  description: string;
  cols: number;
  rows: number;
  chunks: readonly string[];
}>;

export type LineWorkloadSpec = Readonly<{
  name: string;
  description: string;
  cols: number;
  rows: number;
  lineCount: number;
  linesPerChunk: number;
  labelPrefix?: string;
}>;

function padLine(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text.padEnd(width, " ");
}

function buildNumberedLines(count: number, width: number, prefix: string): readonly string[] {
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const label = `${prefix}${String(i).padStart(5, "0")}`;
    lines.push(padLine(label, width));
  }
  return lines;
}

function chunkLines(lines: readonly string[], linesPerChunk: number): readonly string[] {
  if (linesPerChunk <= 0) {
    throw new Error(`linesPerChunk must be > 0 (got ${linesPerChunk})`);
  }
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerChunk) {
    chunks.push(`${lines.slice(i, i + linesPerChunk).join("\n")}\n`);
  }
  return chunks;
}

export function createLineWorkload(spec: LineWorkloadSpec): Workload {
  const prefix = spec.labelPrefix ?? "line ";
  const lines = buildNumberedLines(spec.lineCount, spec.cols, prefix);
  return {
    name: spec.name,
    description: spec.description,
    cols: spec.cols,
    rows: spec.rows,
    chunks: chunkLines(lines, spec.linesPerChunk),
  };
}

export const WORKLOADS = {
  ptySmall: createLineWorkload({
    name: "ptySmall",
    description: "PTY-like output in small chunks.",
    ...FIXTURE_SIZES.standard,
    lineCount: 320,
    linesPerChunk: 4,
    labelPrefix: "pty-small ",
  }),
  ptyStress: createLineWorkload({
    name: "ptyStress",
    description: "PTY-like output in larger chunks (stress).",
    ...FIXTURE_SIZES.standard,
    lineCount: 2400,
    linesPerChunk: 12,
    labelPrefix: "pty-stress ",
  }),
} as const;

export type WorkloadName = keyof typeof WORKLOADS;

export const WORKLOAD_LIST: readonly Workload[] = Object.values(WORKLOADS);
