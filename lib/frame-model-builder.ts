import type {
  CursorStyle,
  GhosttyCell,
  GraphemeRows,
  HyperlinkRange,
  LinkRange,
  RenderInput,
  SelectionRange,
  TerminalTheme,
} from "./renderer-contract";
import { DirtyState, ROW_DIRTY, ROW_HAS_HYPERLINK, ROW_HAS_SELECTION } from "./renderer-contract";

export interface FrameModelBuilderWasmAdapter {
  update(): DirtyState;
  getDirtyReasons(): number;
  getScrollbackLength(): number;
  getViewport(): GhosttyCell[];
  getScrollbackLine(offset: number): GhosttyCell[] | null;
  isRowDirty(y: number): boolean;
  getCursorFromState(): { x: number; y: number; visible: boolean };
  getGraphemeString(row: number, col: number): string;
  getScrollbackGraphemeString(offset: number, col: number): string;
}

export interface FrameModelBuilderCache {
  rowFlags: Uint8Array;
  composedViewportCells: GhosttyCell[];
}

export interface FrameModelBuilderState {
  lastViewportYForRender: number;
  lastCursorPosition: { x: number; y: number };
  lastCursorVisible: boolean;
  lastCursorBlinkActive: boolean;
  lastBlinkVisible: boolean;
  previousHoveredHyperlinkId: number;
  previousHoveredLinkRange: LinkRange | null;
  hoveredLinkState: HyperlinkRange | null;
}

export interface BuildFrameModelInput {
  wasm: FrameModelBuilderWasmAdapter;
  cols: number;
  rows: number;
  rawViewportY: number;
  forceAll: boolean;
  pendingWriteSinceRender: boolean;
  cursorBlinkEnabled: boolean;
  cursorStyle: CursorStyle;
  selectionRange: SelectionRange | null;
  dirtySelectionRows: ReadonlySet<number>;
  hoveredHyperlinkId: number;
  hoveredLinkRange: LinkRange | null;
  theme: TerminalTheme;
  scrollbarOpacity: number;
  now: number;
  emptyCell: GhosttyCell;
  cache: FrameModelBuilderCache;
  state: FrameModelBuilderState;
}

export interface FrameModelDebugInfo {
  dirtyState: DirtyState;
  wasmDirtyState: DirtyState;
  dirtyReasonBits: number;
  dirtyReasonKey: string;
  dirtyRows: number;
  selectionRows: number;
  hyperlinkRows: number;
  viewportY: number;
  scrollbackLength: number;
  forceAll: boolean;
}

export interface BuildFrameModelResult {
  frame: RenderInput;
  state: FrameModelBuilderState;
  debug: FrameModelDebugInfo;
}

export function createFrameModelBuilderCache(): FrameModelBuilderCache {
  return {
    rowFlags: new Uint8Array(0),
    composedViewportCells: [],
  };
}

export function buildFrameModel(input: BuildFrameModelInput): BuildFrameModelResult {
  const viewportY = Math.max(0, Math.floor(input.rawViewportY));
  const wasmDirtyState = input.wasm.update();
  const scrollbackLength = input.wasm.getScrollbackLength();
  const dirtyReasonBits = input.wasm.getDirtyReasons();
  const dirtyReasons: string[] = [];

  if (wasmDirtyState === DirtyState.FULL) {
    dirtyReasons.push("wasm");
  } else if (wasmDirtyState === DirtyState.PARTIAL) {
    dirtyReasons.push("wasm-partial");
  }

  const viewportChanged = viewportY > 0 || viewportY !== input.state.lastViewportYForRender;
  if (input.forceAll) {
    dirtyReasons.push("forceAll");
  }
  if (viewportChanged) {
    dirtyReasons.push("viewport");
  }

  let dirtyState = wasmDirtyState;
  if (input.forceAll || viewportChanged) {
    dirtyState = DirtyState.FULL;
  }
  if (input.pendingWriteSinceRender && dirtyState === DirtyState.NONE) {
    dirtyState = DirtyState.FULL;
    dirtyReasons.push("write-fallback");
  }

  const viewportCells = composeViewportCells(
    input.wasm,
    viewportY,
    input.cols,
    input.rows,
    scrollbackLength,
    input.emptyCell,
    input.cache,
  );
  const rowFlags = ensureRowFlags(input.rows, input.cache);
  rowFlags.fill(0);

  if (dirtyState === DirtyState.FULL) {
    rowFlags.fill(ROW_DIRTY);
  } else if (dirtyState === DirtyState.PARTIAL) {
    for (let y = 0; y < input.rows; y++) {
      if (input.wasm.isRowDirty(y)) {
        rowFlags[y] |= ROW_DIRTY;
      }
    }
  }

  if (
    input.pendingWriteSinceRender &&
    dirtyState === DirtyState.PARTIAL &&
    !hasDirtyRows(rowFlags)
  ) {
    dirtyState = DirtyState.FULL;
    dirtyReasons.push("write-fallback");
    rowFlags.fill(ROW_DIRTY);
  }

  const cursor = input.wasm.getCursorFromState();
  if (input.pendingWriteSinceRender && dirtyState === DirtyState.PARTIAL) {
    const cursorRow = cursor.y;
    if (cursorRow >= 0 && cursorRow < input.rows && (rowFlags[cursorRow] & ROW_DIRTY) === 0) {
      rowFlags[cursorRow] |= ROW_DIRTY;
      dirtyReasons.push("cursor-row-fallback");
    }
  }

  if (input.selectionRange) {
    for (let y = input.selectionRange.startRow; y <= input.selectionRange.endRow; y++) {
      if (y >= 0 && y < input.rows) {
        rowFlags[y] |= ROW_HAS_SELECTION;
      }
    }
  }

  if (input.dirtySelectionRows.size > 0) {
    for (const row of input.dirtySelectionRows) {
      if (row >= 0 && row < input.rows) {
        rowFlags[row] |= ROW_DIRTY | ROW_HAS_SELECTION;
      }
    }
  }

  const blinkVisible =
    !input.cursorBlinkEnabled || Math.floor(input.now / 530) % 2 === 0;
  const cursorBlinkActive = input.cursorBlinkEnabled && cursor.visible && viewportY === 0;
  const cursorVisible = cursor.visible && viewportY === 0 && blinkVisible;
  const cursorMoved =
    cursor.x !== input.state.lastCursorPosition.x || cursor.y !== input.state.lastCursorPosition.y;
  const cursorVisibilityChanged = cursorVisible !== input.state.lastCursorVisible;
  const blinkChanged = blinkVisible !== input.state.lastBlinkVisible;

  if (cursorMoved || cursorVisibilityChanged || blinkChanged) {
    markRowDirty(rowFlags, input.state.lastCursorPosition.y, input.rows);
    markRowDirty(rowFlags, cursor.y, input.rows);
  }

  const hyperlinkChanged = input.hoveredHyperlinkId !== input.state.previousHoveredHyperlinkId;
  if (hyperlinkChanged) {
    for (let y = 0; y < input.rows; y++) {
      const rowOffset = y * input.cols;
      for (let x = 0; x < input.cols; x++) {
        const cell = viewportCells[rowOffset + x];
        if (
          cell &&
          (cell.hyperlink_id === input.hoveredHyperlinkId ||
            cell.hyperlink_id === input.state.previousHoveredHyperlinkId)
        ) {
          rowFlags[y] |= ROW_DIRTY | ROW_HAS_HYPERLINK;
          break;
        }
      }
    }
  }

  const rangeChanged = !rangesEqual(input.hoveredLinkRange, input.state.previousHoveredLinkRange);
  if (rangeChanged) {
    markRangeRows(rowFlags, input.state.previousHoveredLinkRange, input.rows);
    markRangeRows(rowFlags, input.hoveredLinkRange, input.rows);
  }

  const graphemeRows = buildGraphemeRows(
    viewportCells,
    rowFlags,
    dirtyState,
    input.cols,
    input.rows,
    viewportY,
    scrollbackLength,
    input.wasm,
  );

  const hoveredLink = resolveHoveredLink(
    input.hoveredHyperlinkId,
    input.hoveredLinkRange,
    input.state.hoveredLinkState,
  );
  const getGraphemeString = (viewportRow: number, col: number): string =>
    resolveGraphemeString(
      input.wasm,
      viewportY,
      scrollbackLength,
      viewportRow,
      col,
      input.rows,
    );

  let dirtyRows = 0;
  let selectionRows = 0;
  let hyperlinkRows = 0;
  for (let y = 0; y < input.rows; y++) {
    const flags = rowFlags[y];
    if (flags & ROW_DIRTY) dirtyRows++;
    if (flags & ROW_HAS_SELECTION) selectionRows++;
    if (flags & ROW_HAS_HYPERLINK) hyperlinkRows++;
  }

  const frame: RenderInput = {
    cols: input.cols,
    rows: input.rows,
    viewportCells,
    graphemeRows,
    getGraphemeString,
    rowFlags,
    dirtyState,
    selectionRange: input.selectionRange,
    hoveredLink,
    cursorX: cursor.x,
    cursorY: cursor.y,
    cursorVisible,
    cursorStyle: input.cursorStyle,
    theme: input.theme,
    viewportY: input.rawViewportY,
    scrollbackLength,
    scrollbarOpacity: input.scrollbarOpacity,
  };

  return {
    frame,
    state: {
      lastViewportYForRender: viewportY,
      lastCursorPosition: { x: cursor.x, y: cursor.y },
      lastCursorVisible: cursorVisible,
      lastCursorBlinkActive: cursorBlinkActive,
      lastBlinkVisible: blinkVisible,
      previousHoveredHyperlinkId: input.hoveredHyperlinkId,
      previousHoveredLinkRange: input.hoveredLinkRange,
      hoveredLinkState: hoveredLink,
    },
    debug: {
      dirtyState,
      wasmDirtyState,
      dirtyReasonBits,
      dirtyReasonKey: dirtyReasons.join("|") || "none",
      dirtyRows,
      selectionRows,
      hyperlinkRows,
      viewportY,
      scrollbackLength,
      forceAll: input.forceAll,
    },
  };
}

function ensureRowFlags(rows: number, cache: FrameModelBuilderCache): Uint8Array {
  if (cache.rowFlags.length !== rows) {
    cache.rowFlags = new Uint8Array(rows);
  }
  return cache.rowFlags;
}

function composeViewportCells(
  wasm: FrameModelBuilderWasmAdapter,
  viewportY: number,
  cols: number,
  rows: number,
  scrollbackLength: number,
  emptyCell: GhosttyCell,
  cache: FrameModelBuilderCache,
): GhosttyCell[] {
  if (viewportY <= 0) {
    return wasm.getViewport();
  }

  const screenCells = wasm.getViewport();
  const total = cols * rows;
  if (cache.composedViewportCells.length !== total) {
    cache.composedViewportCells = Array.from({ length: total }, () => emptyCell);
  }
  const out = cache.composedViewportCells;

  for (let row = 0; row < rows; row++) {
    const outOffset = row * cols;
    if (row < viewportY) {
      const scrollbackOffset = scrollbackLength - viewportY + row;
      const line =
        scrollbackOffset >= 0 && scrollbackOffset < scrollbackLength
          ? wasm.getScrollbackLine(scrollbackOffset)
          : null;
      for (let col = 0; col < cols; col++) {
        out[outOffset + col] = line?.[col] ?? emptyCell;
      }
      continue;
    }

    const screenRow = row - viewportY;
    if (screenRow < 0 || screenRow >= rows) {
      for (let col = 0; col < cols; col++) {
        out[outOffset + col] = emptyCell;
      }
      continue;
    }
    const screenOffset = screenRow * cols;
    for (let col = 0; col < cols; col++) {
      out[outOffset + col] = screenCells[screenOffset + col] ?? emptyCell;
    }
  }

  return out;
}

function buildGraphemeRows(
  viewportCells: GhosttyCell[],
  rowFlags: Uint8Array,
  dirtyState: DirtyState,
  cols: number,
  rows: number,
  viewportY: number,
  scrollbackLength: number,
  wasm: FrameModelBuilderWasmAdapter,
): GraphemeRows {
  const resolveRows = new Uint8Array(rows);
  if (dirtyState === DirtyState.FULL) {
    resolveRows.fill(1);
  } else {
    const dirtyMask = ROW_DIRTY | ROW_HAS_SELECTION | ROW_HAS_HYPERLINK;
    for (let y = 0; y < rows; y++) {
      if ((rowFlags[y] & dirtyMask) === 0) continue;
      resolveRows[y] = 1;
      if (y > 0) resolveRows[y - 1] = 1;
      if (y < rows - 1) resolveRows[y + 1] = 1;
    }
  }

  const graphemeRows: Array<Array<string | undefined> | undefined> = Array.from(
    { length: rows },
    () => undefined,
  );
  for (let row = 0; row < rows; row++) {
    if (resolveRows[row] === 0) continue;
    const rowOffset = row * cols;
    let rowData: Array<string | undefined> | undefined;
    for (let col = 0; col < cols; col++) {
      const cell = viewportCells[rowOffset + col];
      if (!cell || cell.width === 0 || cell.grapheme_len <= 0) continue;
      rowData ??= Array.from({ length: cols }, () => undefined);
      rowData[col] = resolveGraphemeString(wasm, viewportY, scrollbackLength, row, col, rows);
    }
    if (rowData) {
      graphemeRows[row] = rowData;
    }
  }
  return graphemeRows;
}

function resolveGraphemeString(
  wasm: FrameModelBuilderWasmAdapter,
  viewportY: number,
  scrollbackLength: number,
  viewportRow: number,
  col: number,
  rows: number,
): string {
  if (viewportY > 0) {
    if (viewportRow < viewportY) {
      const scrollbackOffset = scrollbackLength - viewportY + viewportRow;
      if (scrollbackOffset < 0 || scrollbackOffset >= scrollbackLength) return "";
      return wasm.getScrollbackGraphemeString(scrollbackOffset, col);
    }
    const screenRow = viewportRow - viewportY;
    if (screenRow < 0 || screenRow >= rows) return "";
    return wasm.getGraphemeString(screenRow, col);
  }
  return wasm.getGraphemeString(viewportRow, col);
}

function hasDirtyRows(rowFlags: Uint8Array): boolean {
  for (let y = 0; y < rowFlags.length; y++) {
    if (rowFlags[y] & ROW_DIRTY) {
      return true;
    }
  }
  return false;
}

function markRowDirty(rowFlags: Uint8Array, row: number, rows: number): void {
  if (row >= 0 && row < rows) {
    rowFlags[row] |= ROW_DIRTY;
  }
}

function markRangeRows(rowFlags: Uint8Array, range: LinkRange | null, rows: number): void {
  if (!range) return;
  for (let y = range.startY; y <= range.endY; y++) {
    if (y >= 0 && y < rows) {
      rowFlags[y] |= ROW_DIRTY | ROW_HAS_HYPERLINK;
    }
  }
}

function rangesEqual(a: LinkRange | null, b: LinkRange | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.startX === b.startX && a.startY === b.startY && a.endX === b.endX && a.endY === b.endY;
}

function resolveHoveredLink(
  hoveredHyperlinkId: number,
  hoveredLinkRange: LinkRange | null,
  previous: HyperlinkRange | null,
): HyperlinkRange | null {
  if (hoveredHyperlinkId > 0 || hoveredLinkRange) {
    const state = previous ?? { hyperlinkId: 0, range: null };
    state.hyperlinkId = hoveredHyperlinkId;
    state.range = hoveredLinkRange;
    return state;
  }
  if (previous) {
    previous.hyperlinkId = 0;
    previous.range = null;
  }
  return null;
}
