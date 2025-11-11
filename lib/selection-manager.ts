/**
 * Selection Manager - Handles text selection in the terminal
 * 
 * Features:
 * - Mouse drag selection
 * - Double-click word selection
 * - Text extraction from terminal buffer
 * - Automatic clipboard copy
 * - Visual selection overlay (rendered by CanvasRenderer)
 */

import type { Terminal } from './terminal';
import type { CanvasRenderer } from './renderer';
import type { GhosttyTerminal } from './ghostty';
import type { GhosttyCell } from './types';
import type { IEvent } from './interfaces';
import { EventEmitter } from './event-emitter';

// ============================================================================
// Type Definitions
// ============================================================================

export interface SelectionCoordinates {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

// ============================================================================
// SelectionManager Class
// ============================================================================

export class SelectionManager {
  private terminal: Terminal;
  private renderer: CanvasRenderer;
  private wasmTerm: GhosttyTerminal;
  
  // Selection state
  private selectionStart: { col: number; row: number } | null = null;
  private selectionEnd: { col: number; row: number } | null = null;
  private isSelecting: boolean = false;
  
  // Track previous selection for clearing
  private previousSelection: SelectionCoordinates | null = null;
  
  // Event emitter
  private selectionChangedEmitter = new EventEmitter<void>();
  
  constructor(
    terminal: Terminal,
    renderer: CanvasRenderer,
    wasmTerm: GhosttyTerminal
  ) {
    this.terminal = terminal;
    this.renderer = renderer;
    this.wasmTerm = wasmTerm;
    
    // Attach mouse event listeners
    this.attachEventListeners();
  }
  
  // ==========================================================================
  // Public API
  // ==========================================================================
  
  /**
   * Get the selected text as a string
   */
  getSelection(): string {
    const coords = this.normalizeSelection();
    if (!coords) return '';
    
    const { startCol, startRow, endCol, endRow } = coords;
    let text = '';
    
    for (let row = startRow; row <= endRow; row++) {
      const line = this.wasmTerm.getLine(row);
      if (!line) continue;
      
      const colStart = (row === startRow) ? startCol : 0;
      const colEnd = (row === endRow) ? endCol : line.length - 1;
      
      for (let col = colStart; col <= colEnd; col++) {
        const cell = line[col];
        
        // Skip padding cells for wide characters (width=0)
        if (!cell || cell.width === 0) continue;
        
        // Convert codepoint to character
        if (cell.codepoint !== 0) {
          text += String.fromCodePoint(cell.codepoint);
        } else {
          text += ' '; // Treat empty cells as spaces
        }
      }
      
      // Add newline between rows (but not after last row)
      if (row < endRow) {
        text += '\n';
      }
    }
    
    return text;
  }
  
  /**
   * Check if there's an active selection
   */
  hasSelection(): boolean {
    return this.selectionStart !== null && this.selectionEnd !== null;
  }
  
  /**
   * Clear the selection
   */
  clearSelection(): void {
    if (!this.hasSelection()) return;
    
    // Save current selection so we can force redraw of those lines
    this.previousSelection = this.normalizeSelection();
    
    this.selectionStart = null;
    this.selectionEnd = null;
    this.isSelecting = false;
    
    // Force redraw of previously selected lines to clear the overlay
    this.requestRender();
  }
  
  /**
   * Select all text in the terminal
   */
  selectAll(): void {
    const dims = this.wasmTerm.getDimensions();
    this.selectionStart = { col: 0, row: 0 };
    this.selectionEnd = { col: dims.cols - 1, row: dims.rows - 1 };
    this.requestRender();
    this.selectionChangedEmitter.fire();
  }
  
  /**
   * Get normalized selection coordinates (for rendering)
   */
  getSelectionCoords(): SelectionCoordinates | null {
    return this.normalizeSelection();
  }
  
  /**
   * Get previous selection coordinates (for clearing old highlight)
   */
  getPreviousSelectionCoords(): SelectionCoordinates | null {
    return this.previousSelection;
  }
  
  /**
   * Clear the previous selection tracking (after redraw)
   */
  clearPreviousSelection(): void {
    this.previousSelection = null;
  }
  
  /**
   * Get selection change event accessor
   */
  get onSelectionChange(): IEvent<void> {
    return this.selectionChangedEmitter.event;
  }
  
  /**
   * Cleanup resources
   */
  dispose(): void {
    this.selectionChangedEmitter.dispose();
    // Event listeners will be cleaned up when canvas is removed from DOM
  }
  
  // ==========================================================================
  // Private Methods
  // ==========================================================================
  
  /**
   * Attach mouse event listeners to canvas
   */
  private attachEventListeners(): void {
    const canvas = this.renderer.getCanvas();
    
    // Mouse down - start selection or clear existing
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 0) { // Left click only
        // CRITICAL: Focus the terminal so it can receive keyboard input
        // The canvas doesn't have tabindex, but the parent container does
        if (canvas.parentElement) {
          canvas.parentElement.focus();
        }
        
        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        
        // Always clear previous selection on new click
        const hadSelection = this.hasSelection();
        if (hadSelection) {
          this.clearSelection();
        }
        
        // Start new selection
        this.selectionStart = cell;
        this.selectionEnd = cell;
        this.isSelecting = true;
      }
    });
    
    // Mouse move - update selection
    canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.isSelecting) {
        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        this.selectionEnd = cell;
        this.requestRender();
      }
    });
    
    // Mouse up - finish selection and copy
    canvas.addEventListener('mouseup', (e: MouseEvent) => {
      if (this.isSelecting) {
        this.isSelecting = false;
        
        const text = this.getSelection();
        if (text) {
          this.copyToClipboard(text);
          this.selectionChangedEmitter.fire();
        }
      }
    });
    
    // Double-click - select word
    canvas.addEventListener('dblclick', (e: MouseEvent) => {
      const cell = this.pixelToCell(e.offsetX, e.offsetY);
      const word = this.getWordAtCell(cell.col, cell.row);
      
      if (word) {
        this.selectionStart = { col: word.startCol, row: cell.row };
        this.selectionEnd = { col: word.endCol, row: cell.row };
        this.requestRender();
        
        const text = this.getSelection();
        if (text) {
          this.copyToClipboard(text);
          this.selectionChangedEmitter.fire();
        }
      }
    });
    
    // Right-click (context menu) - copy selection if exists
    canvas.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault(); // Prevent default context menu
      
      if (this.hasSelection()) {
        const text = this.getSelection();
        if (text) {
          this.copyToClipboard(text);
          console.log('Copied selection to clipboard (via right-click)');
        }
      }
    });
  }
  
  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  private pixelToCell(x: number, y: number): { col: number; row: number } {
    const metrics = this.renderer.getMetrics();
    
    const col = Math.floor(x / metrics.width);
    const row = Math.floor(y / metrics.height);
    
    // Clamp to terminal bounds
    return {
      col: Math.max(0, Math.min(col, this.terminal.cols - 1)),
      row: Math.max(0, Math.min(row, this.terminal.rows - 1))
    };
  }
  
  /**
   * Normalize selection coordinates (handle backward selection)
   */
  private normalizeSelection(): SelectionCoordinates | null {
    if (!this.selectionStart || !this.selectionEnd) return null;
    
    let { col: startCol, row: startRow } = this.selectionStart;
    let { col: endCol, row: endRow } = this.selectionEnd;
    
    // Swap if selection goes backwards
    if (startRow > endRow || (startRow === endRow && startCol > endCol)) {
      [startCol, endCol] = [endCol, startCol];
      [startRow, endRow] = [endRow, startRow];
    }
    
    return { startCol, startRow, endCol, endRow };
  }
  
  /**
   * Get word boundaries at a cell position
   */
  private getWordAtCell(col: number, row: number): { startCol: number; endCol: number } | null {
    const line = this.wasmTerm.getLine(row);
    if (!line) return null;
    
    // Word characters: letters, numbers, underscore, dash
    const isWordChar = (cell: GhosttyCell) => {
      if (!cell || cell.codepoint === 0) return false;
      const char = String.fromCodePoint(cell.codepoint);
      return /[\w-]/.test(char);
    };
    
    // Only return if we're actually on a word character
    if (!isWordChar(line[col])) return null;
    
    // Find start of word
    let startCol = col;
    while (startCol > 0 && isWordChar(line[startCol - 1])) {
      startCol--;
    }
    
    // Find end of word
    let endCol = col;
    while (endCol < line.length - 1 && isWordChar(line[endCol + 1])) {
      endCol++;
    }
    
    return { startCol, endCol };
  }
  
  /**
   * Copy text to clipboard
   */
  private copyToClipboard(text: string): void {
    if (!text) return;
    
    // Try modern Clipboard API first (requires secure context)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          console.log('✅ Copied to clipboard (Clipboard API):', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
        })
        .catch(err => {
          console.error('❌ Clipboard API failed:', err);
          // Fall back to execCommand
          this.copyToClipboardFallback(text);
        });
    } else {
      // Fallback to execCommand for non-secure contexts (like mux.coder)
      console.log('💡 Using fallback copy method (Clipboard API requires HTTPS)');
      this.copyToClipboardFallback(text);
    }
  }
  
  /**
   * Fallback clipboard copy using execCommand (works in more contexts)
   */
  private copyToClipboardFallback(text: string): void {
    try {
      // Create a temporary textarea element
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed'; // Avoid scrolling to bottom
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      
      // Select and copy the text
      textarea.select();
      textarea.setSelectionRange(0, text.length); // For mobile devices
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      
      if (successful) {
        console.log('✅ Copied to clipboard (fallback):', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
      } else {
        console.error('❌ Copy failed (both methods)');
      }
    } catch (err) {
      console.error('❌ Fallback copy failed:', err);
    }
  }
  
  /**
   * Request a render update (triggers selection overlay redraw)
   */
  private requestRender(): void {
    // The render loop will automatically pick up the new selection state
    // and redraw the affected lines. This happens at 60fps.
    // 
    // Note: When clearSelection() is called, it sets previousSelection
    // which the renderer can use to know which lines to redraw.
  }
}
