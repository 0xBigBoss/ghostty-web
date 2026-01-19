/**
 * Deterministic fixtures for Ghostty WASM and terminal tests.
 *
 * These inputs avoid timing dependencies and are safe to reuse across
 * unit tests in both node and browser-like environments.
 */

export type Fixture = Readonly<{
  name: string;
  description: string;
  cols: number;
  rows: number;
  input: string;
  expected?: Readonly<{
    minScrollback?: number;
    contains?: readonly string[];
  }>;
}>;

export const FIXTURE_SIZES = {
  standard: { cols: 80, rows: 24 },
  compact: { cols: 40, rows: 10 },
} as const;

const ESC = "\u001b[";
const RESET = "\u001b[0m";

function padLine(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text.padEnd(width, " ");
}

function numberedLines(count: number, width: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const label = `line ${String(i).padStart(4, "0")}`;
    lines.push(padLine(label, width));
  }
  return `${lines.join("\n")}\n`;
}

function ansiColorLine(label: string, code: number): string {
  return `${ESC}${code}m${label}${RESET}`;
}

function ansi16Palette(): string {
  const names = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "bright-black",
    "bright-red",
    "bright-green",
    "bright-yellow",
    "bright-blue",
    "bright-magenta",
    "bright-cyan",
    "bright-white",
  ];

  const lines: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    const code = i < 8 ? 30 + i : 90 + (i - 8);
    lines.push(ansiColorLine(names[i], code));
  }
  return `${lines.join("\n")}\n`;
}

export const FIXTURES = {
  basicText: {
    name: "basicText",
    description: "Simple ASCII text with newlines.",
    ...FIXTURE_SIZES.standard,
    input: "hello world\nsecond line\nthird line\n",
    expected: { contains: ["hello world", "second line"] },
  },

  scrollbackBurst: {
    name: "scrollbackBurst",
    description: "Enough lines to push scrollback in a compact terminal.",
    ...FIXTURE_SIZES.compact,
    input: numberedLines(50, FIXTURE_SIZES.compact.cols),
    expected: { minScrollback: 40, contains: ["line 0010", "line 0050"] },
  },

  ansiPalette: {
    name: "ansiPalette",
    description: "ANSI 16-color palette sample.",
    ...FIXTURE_SIZES.standard,
    input: ansi16Palette(),
    expected: { contains: ["bright-white", "blue"] },
  },

  unicodeWide: {
    name: "unicodeWide",
    description: "Wide chars and grapheme clusters (emoji + combining).",
    ...FIXTURE_SIZES.standard,
    input: "CJK: 漢字かなカナ\nEmoji: 🙂🚀\nCombining: e\u0301 o\u0308\n",
    expected: { contains: ["漢字", "🙂🚀", "Combining:"] },
  },

  cursorMoves: {
    name: "cursorMoves",
    description: "Cursor positioning and overwrite.",
    ...FIXTURE_SIZES.standard,
    input: `start${ESC}2;5Hmid${ESC}3;1Hrow3${ESC}1;1H${ESC}2K${RESET}`,
    expected: { contains: ["mid", "row3"] },
  },
} as const satisfies Record<string, Fixture>;

export type FixtureName = keyof typeof FIXTURES;

export const FIXTURE_LIST: readonly Fixture[] = Object.values(FIXTURES);

export function getFixture(name: FixtureName): Fixture {
  return FIXTURES[name];
}
