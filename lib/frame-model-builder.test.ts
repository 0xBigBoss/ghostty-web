import { describe, expect, test } from "bun:test";
import {
  buildFrameModel,
  createFrameModelBuilderCache,
  type FrameModelBuilderState,
  type FrameModelBuilderWasmAdapter,
} from "./frame-model-builder";
import { DirtyState, ROW_DIRTY, type GhosttyCell, type TerminalTheme } from "./renderer-contract";

function createCell(overrides: Partial<GhosttyCell> = {}): GhosttyCell {
  return {
    codepoint: 32,
    fg_r: 255,
    fg_g: 255,
    fg_b: 255,
    bg_r: 0,
    bg_g: 0,
    bg_b: 0,
    flags: 0,
    width: 1,
    hyperlink_id: 0,
    grapheme_len: 0,
    ...overrides,
  };
}

function createTheme(): TerminalTheme {
  return {
    foreground: { r: 255, g: 255, b: 255, a: 1 },
    background: { r: 0, g: 0, b: 0, a: 1 },
    cursor: { r: 255, g: 255, b: 255, a: 1 },
    cursorAccent: { r: 0, g: 0, b: 0, a: 1 },
    selectionBackground: { r: 64, g: 96, b: 192, a: 1 },
    selectionForeground: null,
    selectionOpacity: 0.4,
  };
}

function createState(): FrameModelBuilderState {
  return {
    lastViewportYForRender: 0,
    lastCursorPosition: { x: 0, y: 0 },
    lastCursorVisible: true,
    lastCursorBlinkActive: false,
    lastBlinkVisible: true,
    previousHoveredHyperlinkId: 0,
    previousHoveredLinkRange: null,
    hoveredLinkState: null,
  };
}

describe("frame-model-builder", () => {
  test("upgrades to full dirty when pending write has no dirty rows", () => {
    const cols = 4;
    const rows = 2;
    const viewportCells = Array.from({ length: cols * rows }, () => createCell());

    const wasm: FrameModelBuilderWasmAdapter = {
      update: () => DirtyState.NONE,
      getDirtyReasons: () => 0,
      getScrollbackLength: () => 0,
      getViewport: () => viewportCells,
      getScrollbackLine: () => null,
      isRowDirty: () => false,
      getCursorFromState: () => ({ x: 0, y: 0, visible: true }),
      getGraphemeString: () => "",
      getScrollbackGraphemeString: () => "",
    };

    const result = buildFrameModel({
      wasm,
      cols,
      rows,
      rawViewportY: 0,
      forceAll: false,
      pendingWriteSinceRender: true,
      cursorBlinkEnabled: false,
      cursorStyle: "block",
      selectionRange: null,
      dirtySelectionRows: new Set<number>(),
      hoveredHyperlinkId: 0,
      hoveredLinkRange: null,
      theme: createTheme(),
      scrollbarOpacity: 1,
      now: 0,
      emptyCell: createCell({ codepoint: 0 }),
      cache: createFrameModelBuilderCache(),
      state: createState(),
    });

    expect(result.debug.dirtyState).toBe(DirtyState.FULL);
    expect(Array.from(result.frame.rowFlags)).toEqual([ROW_DIRTY, ROW_DIRTY]);
    expect(result.debug.dirtyReasonKey).toContain("write-fallback");
  });

  test("composes scrollback rows and pre-resolves graphemes for render rows", () => {
    const cols = 2;
    const rows = 3;
    const screenCells = [
      createCell({ codepoint: 65 }),
      createCell({ codepoint: 66 }),
      createCell({ codepoint: 67, grapheme_len: 1 }),
      createCell({ codepoint: 68 }),
      createCell({ codepoint: 69, grapheme_len: 1 }),
      createCell({ codepoint: 70 }),
    ];
    const scrollbackLine = [
      createCell({ codepoint: 120, grapheme_len: 1 }),
      createCell({ codepoint: 121 }),
    ];

    const graphemeCalls: Array<string> = [];
    const wasm: FrameModelBuilderWasmAdapter = {
      update: () => DirtyState.PARTIAL,
      getDirtyReasons: () => 0,
      getScrollbackLength: () => 2,
      getViewport: () => screenCells,
      getScrollbackLine: () => scrollbackLine,
      isRowDirty: (y) => y === 1,
      getCursorFromState: () => ({ x: 0, y: 1, visible: true }),
      getGraphemeString: (row, col) => {
        graphemeCalls.push(`screen:${row}:${col}`);
        return row === 1 && col === 0 ? "क्ष" : "ग";
      },
      getScrollbackGraphemeString: (offset, col) => {
        graphemeCalls.push(`scroll:${offset}:${col}`);
        return "ज्ञ";
      },
    };

    const result = buildFrameModel({
      wasm,
      cols,
      rows,
      rawViewportY: 1.4,
      forceAll: false,
      pendingWriteSinceRender: false,
      cursorBlinkEnabled: false,
      cursorStyle: "block",
      selectionRange: null,
      dirtySelectionRows: new Set<number>(),
      hoveredHyperlinkId: 0,
      hoveredLinkRange: null,
      theme: createTheme(),
      scrollbarOpacity: 0.8,
      now: 0,
      emptyCell: createCell({ codepoint: 0 }),
      cache: createFrameModelBuilderCache(),
      state: createState(),
    });

    expect(result.frame.viewportCells[0]).toBe(scrollbackLine[0]);
    expect(result.frame.graphemeRows[0]?.[0]).toBe("ज्ञ");
    expect(result.frame.graphemeRows[2]?.[0]).toBe("क्ष");
    expect(graphemeCalls).toContain("scroll:1:0");
    expect(graphemeCalls).toContain("screen:1:0");
  });

  test("preserves grapheme callback fallback when grapheme rows are sparse", () => {
    const cols = 2;
    const rows = 3;
    const viewportCells = [
      createCell({ codepoint: 71, grapheme_len: 1 }),
      createCell({ codepoint: 72 }),
      createCell({ codepoint: 73 }),
      createCell({ codepoint: 74 }),
      createCell({ codepoint: 75, grapheme_len: 1 }),
      createCell({ codepoint: 76 }),
    ];
    const wasm: FrameModelBuilderWasmAdapter = {
      update: () => DirtyState.PARTIAL,
      getDirtyReasons: () => 0,
      getScrollbackLength: () => 0,
      getViewport: () => viewportCells,
      getScrollbackLine: () => null,
      isRowDirty: (y) => y === 0,
      getCursorFromState: () => ({ x: 0, y: 0, visible: true }),
      getGraphemeString: (row, col) => {
        if (row === 0 && col === 0) return "ग्र";
        if (row === 2 && col === 0) return "क्ष";
        return "";
      },
      getScrollbackGraphemeString: () => "",
    };

    const result = buildFrameModel({
      wasm,
      cols,
      rows,
      rawViewportY: 0,
      forceAll: false,
      pendingWriteSinceRender: false,
      cursorBlinkEnabled: false,
      cursorStyle: "block",
      selectionRange: null,
      dirtySelectionRows: new Set<number>(),
      hoveredHyperlinkId: 0,
      hoveredLinkRange: null,
      theme: createTheme(),
      scrollbarOpacity: 0.8,
      now: 0,
      emptyCell: createCell({ codepoint: 0 }),
      cache: createFrameModelBuilderCache(),
      state: createState(),
    });

    expect(result.frame.graphemeRows[0]?.[0]).toBe("ग्र");
    expect(result.frame.graphemeRows[2]).toBeUndefined();
    expect(result.frame.getGraphemeString?.(2, 0)).toBe("क्ष");
  });
});
