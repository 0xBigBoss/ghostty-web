import type { ITheme } from "./interfaces";
import type { RGBA, TerminalTheme } from "./renderer-types";

const DEFAULT_SELECTION_OPACITY = 0.4;

export const DEFAULT_THEME: Required<ITheme> = {
  foreground: "#d4d4d4",
  background: "#1e1e1e",
  cursor: "#ffffff",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#d4d4d4",
  selectionForeground: "#1e1e1e",
  selectionOpacity: DEFAULT_SELECTION_OPACITY,
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

export function resolveTheme(theme?: ITheme): TerminalTheme {
  const merged = { ...DEFAULT_THEME, ...(theme ?? {}) };
  const selectionOpacity = normalizeOpacity(theme?.selectionOpacity);

  return {
    foreground: resolveColor(merged.foreground, DEFAULT_THEME.foreground),
    background: resolveColor(merged.background, DEFAULT_THEME.background),
    cursor: resolveColor(merged.cursor, DEFAULT_THEME.cursor),
    cursorAccent: resolveColor(merged.cursorAccent, DEFAULT_THEME.cursorAccent),
    selectionBackground: resolveColor(
      merged.selectionBackground,
      DEFAULT_THEME.selectionBackground,
    ),
    selectionForeground: resolveOptionalColor(
      theme?.selectionForeground ?? merged.selectionForeground,
    ),
    selectionOpacity,
  };
}

export function rgbaToCss(color: RGBA): string {
  const a = clampAlpha(color.a);
  if (a >= 1) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${a})`;
}

function resolveColor(value: string | undefined, fallback: string): RGBA {
  return parseColor(value) ?? parseColor(fallback) ?? { r: 0, g: 0, b: 0, a: 1 };
}

function resolveOptionalColor(value: string | undefined): RGBA | null {
  if (!value || value === "undefined") return null;
  return parseColor(value);
}

function parseColor(value: string | undefined): RGBA | null {
  if (!value) return null;
  if (value.startsWith("#")) {
    return parseHexColor(value);
  }
  const rgbMatch = value.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/,
  );
  if (rgbMatch) {
    const r = clampByte(Number.parseInt(rgbMatch[1], 10));
    const g = clampByte(Number.parseInt(rgbMatch[2], 10));
    const b = clampByte(Number.parseInt(rgbMatch[3], 10));
    const a = rgbMatch[4] !== undefined ? clampAlpha(Number.parseFloat(rgbMatch[4])) : 1;
    return { r, g, b, a };
  }
  return null;
}

function parseHexColor(value: string): RGBA | null {
  const hex = value.slice(1).trim();
  if (![3, 4, 6, 8].includes(hex.length)) return null;

  const expand = (h: string) => h + h;
  let r = "";
  let g = "";
  let b = "";
  let a = "ff";

  if (hex.length === 3 || hex.length === 4) {
    r = expand(hex[0]);
    g = expand(hex[1]);
    b = expand(hex[2]);
    if (hex.length === 4) a = expand(hex[3]);
  } else {
    r = hex.slice(0, 2);
    g = hex.slice(2, 4);
    b = hex.slice(4, 6);
    if (hex.length === 8) a = hex.slice(6, 8);
  }

  const ri = Number.parseInt(r, 16);
  const gi = Number.parseInt(g, 16);
  const bi = Number.parseInt(b, 16);
  const ai = Number.parseInt(a, 16);
  if ([ri, gi, bi, ai].some((v) => Number.isNaN(v))) return null;

  return {
    r: clampByte(ri),
    g: clampByte(gi),
    b: clampByte(bi),
    a: clampAlpha(ai / 255),
  };
}

function normalizeOpacity(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SELECTION_OPACITY;
  if (!Number.isFinite(value)) return DEFAULT_SELECTION_OPACITY;
  return clampAlpha(value);
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
