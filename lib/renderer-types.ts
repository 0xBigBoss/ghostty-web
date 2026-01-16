import type { DirtyState, GhosttyCell } from "./types";

export interface CellMetrics {
  width: number;
  height: number;
  baseline: number;
}

export type CursorStyle = "block" | "underline" | "bar";

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface TerminalTheme {
  foreground: RGBA;
  background: RGBA;
  cursor: RGBA;
  cursorAccent: RGBA;
  selectionBackground: RGBA;
  selectionForeground: RGBA | null;
  selectionOpacity: number;
}

export interface SelectionRange {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export interface LinkRange {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface HyperlinkRange {
  hyperlinkId: number;
  range: LinkRange | null;
}

export const ROW_DIRTY = 0x01;
export const ROW_HAS_SELECTION = 0x02;
export const ROW_HAS_HYPERLINK = 0x04;

export interface RenderInput {
  cols: number;
  rows: number;

  // Viewport-composed cells, row-major, length = cols * rows
  viewportCells: GhosttyCell[];

  // Per-row flags: dirty/selection/hyperlink
  rowFlags: Uint8Array;

  dirtyState: DirtyState;

  selectionRange: SelectionRange | null;
  hoveredLink: HyperlinkRange | null;

  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
  cursorStyle: CursorStyle;

  getGraphemeString(viewportRow: number, col: number): string;

  theme: TerminalTheme;

  // Scrollbar rendering
  viewportY: number;
  scrollbackLength: number;
  scrollbarOpacity: number;
}

export interface Renderer {
  attach(canvas: HTMLCanvasElement): void;
  resize(cols: number, rows: number): void;
  render(input: RenderInput): void;
  updateTheme(theme: TerminalTheme): void;
  setFontSize(size: number): void;
  setFontFamily(family: string): void;
  getMetrics(): CellMetrics;
  getCanvas(): HTMLCanvasElement;
  readonly charWidth: number;
  readonly charHeight: number;
  clear(): void;
  dispose(): void;
}
