/**
 * Canvas Renderer for Terminal Display
 *
 * High-performance canvas-based renderer that draws the terminal using
 * Ghostty's WASM terminal emulator. Features:
 * - Font metrics measurement with DPI scaling
 * - Full color support (256-color palette + RGB)
 * - All text styles (bold, italic, underline, strikethrough, etc.)
 * - Multiple cursor styles (block, underline, bar)
 * - Dirty line optimization for 60 FPS
 */

import type { ITheme } from "./interfaces";
import type {
  CellMetrics,
  CursorStyle,
  HyperlinkRange,
  RenderInput,
  Renderer,
  SelectionRange,
  TerminalTheme,
} from "./renderer-types";
import { ROW_DIRTY, ROW_HAS_HYPERLINK, ROW_HAS_SELECTION } from "./renderer-types";
import { CellFlags, DirtyState, type GhosttyCell } from "./types";
import { profileDuration, profileStart } from "./profile";
import { DEFAULT_THEME, rgbaToCss, resolveTheme } from "./theme";

// ============================================================================
// Type Definitions
// ============================================================================

export interface RendererOptions {
  fontSize?: number; // Default: 15
  fontFamily?: string; // Default: 'monospace'
  cursorStyle?: CursorStyle; // Deprecated: use RenderInput
  cursorBlink?: boolean; // Deprecated: use RenderInput
  theme?: ITheme;
  devicePixelRatio?: number; // Default: window.devicePixelRatio
}

export type FontMetrics = CellMetrics;

// ============================================================================
// Default Theme
// ============================================================================

export { DEFAULT_THEME };

// ============================================================================
// CanvasRenderer Class
// ============================================================================

export class CanvasRenderer implements Renderer {
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private fontSize: number;
  private fontFamily: string;
  private theme: TerminalTheme;
  private devicePixelRatio: number;
  private metrics: CellMetrics;
  private currentSelectionRange: SelectionRange | null = null;
  private currentHoveredLink: HyperlinkRange | null = null;
  private currentGetGraphemeString?: (viewportRow: number, col: number) => string;

  constructor(
    canvasOrOptions?: HTMLCanvasElement | RendererOptions,
    options: RendererOptions = {},
  ) {
    let resolvedOptions = options;
    let canvas: HTMLCanvasElement | undefined;
    if (canvasOrOptions instanceof HTMLCanvasElement) {
      canvas = canvasOrOptions;
    } else if (canvasOrOptions) {
      resolvedOptions = canvasOrOptions;
    }

    // Apply options
    this.fontSize = resolvedOptions.fontSize ?? 15;
    this.fontFamily = resolvedOptions.fontFamily ?? "monospace";
    this.theme = resolveTheme(resolvedOptions.theme);
    const defaultDpr =
      typeof window !== "undefined" && typeof window.devicePixelRatio === "number"
        ? window.devicePixelRatio
        : 1;
    this.devicePixelRatio = resolvedOptions.devicePixelRatio ?? defaultDpr;

    // Measure font metrics
    this.metrics = this.measureFont();

    if (canvas) {
      this.attach(canvas);
    }
  }

  // ==========================================================================
  // Font Metrics Measurement
  // ==========================================================================

  private measureFont(): FontMetrics {
    // Use an offscreen canvas for measurement
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    // Set font (use actual pixel size for accurate measurement)
    ctx.font = `${this.fontSize}px ${this.fontFamily}`;

    // Measure width using 'M' (typically widest character)
    const widthMetrics = ctx.measureText("M");
    const width = Math.ceil(widthMetrics.width);

    // Measure height using ascent + descent with padding for glyph overflow
    const ascent = widthMetrics.actualBoundingBoxAscent || this.fontSize * 0.8;
    const descent = widthMetrics.actualBoundingBoxDescent || this.fontSize * 0.2;

    // Add 2px padding to height to account for glyphs that overflow (like 'f', 'd', 'g', 'p')
    // and anti-aliasing pixels
    const height = Math.ceil(ascent + descent) + 2;
    const baseline = Math.ceil(ascent) + 1; // Offset baseline by half the padding

    return { width, height, baseline };
  }

  /**
   * Remeasure font metrics (call after font loads or changes)
   */
  public remeasureFont(): void {
    this.metrics = this.measureFont();
  }

  // ==========================================================================
  // Color Conversion
  // ==========================================================================

  private rgbToCSS(r: number, g: number, b: number): string {
    return `rgb(${r}, ${g}, ${b})`;
  }

  private requireContext(): CanvasRenderingContext2D {
    if (!this.ctx || !this.canvas) {
      throw new Error("CanvasRenderer is not attached to a canvas");
    }
    return this.ctx;
  }

  private requireCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      throw new Error("CanvasRenderer is not attached to a canvas");
    }
    return this.canvas;
  }

  // ==========================================================================
  // Attachment
  // ==========================================================================

  public attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      throw new Error("Failed to get 2D rendering context");
    }
    this.ctx = ctx;
  }

  // ==========================================================================
  // Canvas Sizing
  // ==========================================================================

  /**
   * Resize canvas to fit terminal dimensions
   */
  public resize(cols: number, rows: number): void {
    const canvas = this.requireCanvas();
    const ctx = this.requireContext();
    const cssWidth = cols * this.metrics.width;
    const cssHeight = rows * this.metrics.height;

    // Set CSS size (what user sees)
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    // Set actual canvas size (scaled for DPI)
    canvas.width = cssWidth * this.devicePixelRatio;
    canvas.height = cssHeight * this.devicePixelRatio;

    // Scale context to match DPI (setting canvas.width/height resets the context)
    ctx.scale(this.devicePixelRatio, this.devicePixelRatio);

    // Set text rendering properties for crisp text
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Fill background after resize
    ctx.fillStyle = rgbaToCss(this.theme.background);
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  }

  // ==========================================================================
  // Main Rendering
  // ==========================================================================

  /**
   * Render the terminal buffer to canvas
   */
  public render(input: RenderInput): void {
    this.requireContext();
    const renderStart = profileStart();
    this.theme = input.theme;
    this.currentSelectionRange = input.selectionRange;
    this.currentHoveredLink = input.hoveredLink;
    this.currentGetGraphemeString = input.getGraphemeString;

    const cols = input.cols;
    const rows = input.rows;
    const forceAll = input.dirtyState === DirtyState.FULL;
    const rowsToRender = new Set<number>();

    const buildRowsStart = profileStart();
    for (let y = 0; y < rows; y++) {
      const flags = input.rowFlags[y] ?? 0;
      const needsRender =
        forceAll || (flags & (ROW_DIRTY | ROW_HAS_SELECTION | ROW_HAS_HYPERLINK)) !== 0;

      if (needsRender) {
        rowsToRender.add(y);
        if (y > 0) rowsToRender.add(y - 1);
        if (y < rows - 1) rowsToRender.add(y + 1);
      }
    }
    profileDuration("bootty:canvas:build-rows", buildRowsStart, {
      cols,
      rows,
      rowsToRender: rowsToRender.size,
      dirtyState: input.dirtyState,
    });

    const rowsStart = profileStart();
    for (let y = 0; y < rows; y++) {
      if (!rowsToRender.has(y)) continue;
      this.renderLine(input.viewportCells, y, cols);
    }
    profileDuration("bootty:canvas:rows", rowsStart, {
      cols,
      rows,
      rowsToRender: rowsToRender.size,
      dirtyState: input.dirtyState,
    });

    if (input.cursorVisible) {
      const cursorStart = profileStart();
      this.renderCursor(input.cursorX, input.cursorY, input.cursorStyle);
      profileDuration("bootty:canvas:cursor", cursorStart, {
        cursorStyle: input.cursorStyle,
      });
    }

    if (input.scrollbarOpacity > 0 && input.scrollbackLength > 0) {
      const scrollbarStart = profileStart();
      this.renderScrollbar(input.viewportY, input.scrollbackLength, rows, input.scrollbarOpacity);
      profileDuration("bootty:canvas:scrollbar", scrollbarStart, {
        scrollbackLength: input.scrollbackLength,
        scrollbarOpacity: input.scrollbarOpacity,
      });
    }

    profileDuration("bootty:canvas:render", renderStart, {
      cols,
      rows,
      rowsToRender: rowsToRender.size,
      dirtyState: input.dirtyState,
      cursorVisible: input.cursorVisible,
      scrollbarOpacity: input.scrollbarOpacity,
    });
  }

  /**
   * Render a single line using two-pass approach:
   * 1. First pass: Draw all cell backgrounds
   * 2. Second pass: Draw all cell text and decorations
   *
   * This two-pass approach is necessary for proper rendering of complex scripts
   * like Devanagari where diacritics (like vowel sign ि) can extend LEFT of the
   * base character into the previous cell's visual area. If we draw backgrounds
   * and text in a single pass (cell by cell), the background of cell N would
   * cover any left-extending portions of graphemes from cell N-1.
   */
  private renderLine(viewportCells: GhosttyCell[], row: number, cols: number): void {
    const ctx = this.requireContext();
    const lineY = row * this.metrics.height;

    // Clear line background with theme color.
    // We clear just the cell area - glyph overflow is handled by also
    // redrawing adjacent rows (see render() method).
    ctx.fillStyle = rgbaToCss(this.theme.background);
    ctx.fillRect(0, lineY, cols * this.metrics.width, this.metrics.height);

    // PASS 1: Draw all cell backgrounds first
    // This ensures all backgrounds are painted before any text, allowing text
    // to "bleed" across cell boundaries without being covered by adjacent backgrounds
    const lineStart = row * cols;
    for (let x = 0; x < cols; x++) {
      const cell = viewportCells[lineStart + x];
      if (!cell) continue;
      if (cell.width === 0) continue; // Skip spacer cells for wide characters
      this.renderCellBackground(cell, x, row);
    }

    // PASS 2: Draw all cell text and decorations
    // Now text can safely extend beyond cell boundaries (for complex scripts)
    for (let x = 0; x < cols; x++) {
      const cell = viewportCells[lineStart + x];
      if (!cell) continue;
      if (cell.width === 0) continue; // Skip spacer cells for wide characters
      this.renderCellText(cell, x, row);
    }
  }

  /**
   * Render a cell's background only (Pass 1 of two-pass rendering)
   * Selection highlighting is integrated here to avoid z-order issues with
   * complex glyphs (like Devanagari) that extend outside their cell bounds.
   */
  private renderCellBackground(cell: GhosttyCell, x: number, y: number): void {
    const ctx = this.requireContext();
    const cellX = x * this.metrics.width;
    const cellY = y * this.metrics.height;
    const cellWidth = this.metrics.width * cell.width;

    // Check if this cell is selected
    const isSelected = this.isInSelection(x, y);

    // For selected cells, we'll draw the selection overlay AFTER the normal background
    // This creates a tinted effect like VS Code's editor selection

    // Extract background color and handle inverse
    let bg_r = cell.bg_r,
      bg_g = cell.bg_g,
      bg_b = cell.bg_b;

    if (cell.flags & CellFlags.INVERSE) {
      // When inverted, background becomes foreground
      bg_r = cell.fg_r;
      bg_g = cell.fg_g;
      bg_b = cell.fg_b;
    }

    // Only draw cell background if it's different from the default (black)
    // This lets the theme background (drawn earlier) show through for default cells
    const isDefaultBg = bg_r === 0 && bg_g === 0 && bg_b === 0;
    if (!isDefaultBg) {
      ctx.fillStyle = this.rgbToCSS(bg_r, bg_g, bg_b);
      ctx.fillRect(cellX, cellY, cellWidth, this.metrics.height);
    }

    // Draw selection overlay on top (semi-transparent like VS Code editor)
    // This creates a tinted highlight effect that preserves text readability
    // TODO: Make opacity configurable via theme.selectionOpacity (default 0.4)
    if (isSelected) {
      const selectionOpacity = this.theme.selectionOpacity;
      ctx.globalAlpha = selectionOpacity;
      ctx.fillStyle = rgbaToCss(this.theme.selectionBackground);
      ctx.fillRect(cellX, cellY, cellWidth, this.metrics.height);
      ctx.globalAlpha = 1.0;
    }
  }

  /**
   * Render a cell's text and decorations (Pass 2 of two-pass rendering)
   * Selection foreground color is applied here to match the selection background.
   */
  private renderCellText(cell: GhosttyCell, x: number, y: number): void {
    const ctx = this.requireContext();
    const cellX = x * this.metrics.width;
    const cellY = y * this.metrics.height;
    const cellWidth = this.metrics.width * cell.width;

    // Skip rendering if invisible
    if (cell.flags & CellFlags.INVISIBLE) {
      return;
    }

    // Check if this cell is selected
    const isSelected = this.isInSelection(x, y);

    // Set text style
    let fontStyle = "";
    if (cell.flags & CellFlags.ITALIC) fontStyle += "italic ";
    if (cell.flags & CellFlags.BOLD) fontStyle += "bold ";
    ctx.font = `${fontStyle}${this.fontSize}px ${this.fontFamily}`;

    // Extract colors and handle inverse
    let fg_r = cell.fg_r,
      fg_g = cell.fg_g,
      fg_b = cell.fg_b;

    if (cell.flags & CellFlags.INVERSE) {
      // When inverted, foreground becomes background
      fg_r = cell.bg_r;
      fg_g = cell.bg_g;
      fg_b = cell.bg_b;
    }

    // Set text color - use selection foreground only if explicitly defined
    // Otherwise keep original text color (works better with semi-transparent overlay)
    const selFg = this.theme.selectionForeground;
    if (isSelected && selFg) {
      ctx.fillStyle = rgbaToCss(selFg);
    } else {
      ctx.fillStyle = this.rgbToCSS(fg_r, fg_g, fg_b);
    }

    // Apply faint effect
    if (cell.flags & CellFlags.FAINT) {
      ctx.globalAlpha = 0.5;
    }

    // Draw text
    const textX = cellX;
    const textY = cellY + this.metrics.baseline;

    // Get the character to render - use grapheme lookup for complex scripts
    let char: string;
    if (cell.grapheme_len > 0 && this.currentGetGraphemeString) {
      char = this.currentGetGraphemeString(y, x);
    } else {
      // Simple cell - single codepoint
      char = String.fromCodePoint(cell.codepoint || 32); // Default to space if null
    }
    ctx.fillText(char, textX, textY);

    // Reset alpha
    if (cell.flags & CellFlags.FAINT) {
      ctx.globalAlpha = 1.0;
    }

    // Draw underline
    if (cell.flags & CellFlags.UNDERLINE) {
      const underlineY = cellY + this.metrics.baseline + 2;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cellX, underlineY);
      ctx.lineTo(cellX + cellWidth, underlineY);
      ctx.stroke();
    }

    // Draw strikethrough
    if (cell.flags & CellFlags.STRIKETHROUGH) {
      const strikeY = cellY + this.metrics.height / 2;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cellX, strikeY);
      ctx.lineTo(cellX + cellWidth, strikeY);
      ctx.stroke();
    }

    // Draw hyperlink underline (for OSC8 hyperlinks)
    if (cell.hyperlink_id > 0) {
      const hoveredHyperlinkId = this.currentHoveredLink?.hyperlinkId ?? 0;
      const isHovered = cell.hyperlink_id === hoveredHyperlinkId;

      // Only show underline when hovered (cleaner look)
      if (isHovered) {
        const underlineY = cellY + this.metrics.baseline + 2;
        ctx.strokeStyle = "#4A90E2"; // Blue underline on hover
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cellX, underlineY);
        ctx.lineTo(cellX + cellWidth, underlineY);
        ctx.stroke();
      }
    }

    // Draw regex link underline (for plain text URLs)
    if (this.currentHoveredLink?.range) {
      const range = this.currentHoveredLink.range;
      // Check if this cell is within the hovered link range
      const isInRange =
        (y === range.startY && x >= range.startX && (y < range.endY || x <= range.endX)) ||
        (y > range.startY && y < range.endY) ||
        (y === range.endY && x <= range.endX && (y > range.startY || x >= range.startX));

      if (isInRange) {
        const underlineY = cellY + this.metrics.baseline + 2;
        ctx.strokeStyle = "#4A90E2"; // Blue underline on hover
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cellX, underlineY);
        ctx.lineTo(cellX + cellWidth, underlineY);
        ctx.stroke();
      }
    }
  }

  /**
   * Render cursor
   */
  private renderCursor(x: number, y: number, style: CursorStyle): void {
    const ctx = this.requireContext();
    const cursorX = x * this.metrics.width;
    const cursorY = y * this.metrics.height;

    ctx.fillStyle = rgbaToCss(this.theme.cursor);

    switch (style) {
      case "block":
        // Full cell block
        ctx.fillRect(cursorX, cursorY, this.metrics.width, this.metrics.height);
        break;

      case "underline":
        // Underline at bottom of cell
        const underlineHeight = Math.max(2, Math.floor(this.metrics.height * 0.15));
        ctx.fillRect(
          cursorX,
          cursorY + this.metrics.height - underlineHeight,
          this.metrics.width,
          underlineHeight,
        );
        break;

      case "bar":
        // Vertical bar at left of cell
        const barWidth = Math.max(2, Math.floor(this.metrics.width * 0.15));
        ctx.fillRect(cursorX, cursorY, barWidth, this.metrics.height);
        break;
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Update theme colors
   */
  public updateTheme(theme: TerminalTheme): void {
    this.theme = theme;
  }

  /**
   * Backward-compatible theme update using ITheme
   */
  public setTheme(theme: ITheme): void {
    this.theme = resolveTheme(theme);
  }

  /**
   * Update font size
   */
  public setFontSize(size: number): void {
    this.fontSize = size;
    this.metrics = this.measureFont();
  }

  /**
   * Update font family
   */
  public setFontFamily(family: string): void {
    this.fontFamily = family;
    this.metrics = this.measureFont();
  }

  /**
   * Get current font metrics
   */

  /**
   * Render scrollbar (Phase 2)
   * Shows scroll position and allows click/drag interaction
   * @param opacity Opacity level (0-1) for fade in/out effect
   */
  private renderScrollbar(
    viewportY: number,
    scrollbackLength: number,
    visibleRows: number,
    opacity: number = 1,
  ): void {
    const ctx = this.requireContext();
    const canvas = this.requireCanvas();
    const canvasHeight = canvas.height / this.devicePixelRatio;
    const canvasWidth = canvas.width / this.devicePixelRatio;

    // Scrollbar dimensions
    const scrollbarWidth = 8;
    const scrollbarX = canvasWidth - scrollbarWidth - 4;
    const scrollbarPadding = 4;
    const scrollbarTrackHeight = canvasHeight - scrollbarPadding * 2;

    // Always clear the scrollbar area first (fixes ghosting when fading out)
    ctx.fillStyle = rgbaToCss(this.theme.background);
    ctx.fillRect(scrollbarX - 2, 0, scrollbarWidth + 6, canvasHeight);

    // Don't draw scrollbar if fully transparent or no scrollback
    if (opacity <= 0 || scrollbackLength === 0) return;

    // Calculate scrollbar thumb size and position
    const totalLines = scrollbackLength + visibleRows;
    const thumbHeight = Math.max(20, (visibleRows / totalLines) * scrollbarTrackHeight);

    // Position: 0 = at bottom, scrollbackLength = at top
    const scrollPosition = viewportY / scrollbackLength; // 0 to 1
    const thumbY = scrollbarPadding + (scrollbarTrackHeight - thumbHeight) * (1 - scrollPosition);

    // Draw scrollbar track (subtle background) with opacity
    ctx.fillStyle = `rgba(128, 128, 128, ${0.1 * opacity})`;
    ctx.fillRect(scrollbarX, scrollbarPadding, scrollbarWidth, scrollbarTrackHeight);

    // Draw scrollbar thumb with opacity
    const isScrolled = viewportY > 0;
    const baseOpacity = isScrolled ? 0.5 : 0.3;
    ctx.fillStyle = `rgba(128, 128, 128, ${baseOpacity * opacity})`;
    ctx.fillRect(scrollbarX, thumbY, scrollbarWidth, thumbHeight);
  }
  public getMetrics(): FontMetrics {
    return { ...this.metrics };
  }

  /**
   * Get canvas element
   */
  public getCanvas(): HTMLCanvasElement {
    return this.requireCanvas();
  }

  /**
   * Check if a cell at (x, y) is within the current selection.
   * Uses cached selection coordinates for performance.
   */
  private isInSelection(x: number, y: number): boolean {
    const sel = this.currentSelectionRange;
    if (!sel) return false;

    const { startCol, startRow, endCol, endRow } = sel;

    // Single line selection
    if (startRow === endRow) {
      return y === startRow && x >= startCol && x <= endCol;
    }

    // Multi-line selection
    if (y === startRow) {
      // First line: from startCol to end of line
      return x >= startCol;
    } else if (y === endRow) {
      // Last line: from start of line to endCol
      return x <= endCol;
    } else if (y > startRow && y < endRow) {
      // Middle lines: entire line is selected
      return true;
    }

    return false;
  }

  /**
   * Get character cell width (for coordinate conversion)
   */
  public get charWidth(): number {
    return this.metrics.width;
  }

  /**
   * Get character cell height (for coordinate conversion)
   */
  public get charHeight(): number {
    return this.metrics.height;
  }

  /**
   * Clear entire canvas
   */
  public clear(): void {
    const ctx = this.requireContext();
    const canvas = this.requireCanvas();
    ctx.fillStyle = rgbaToCss(this.theme.background);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    // No-op: Canvas resources are managed by the browser.
  }
}
