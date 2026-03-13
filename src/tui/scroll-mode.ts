/**
 * Scroll mode — client-side xterm buffer + viewport rendering.
 *
 * Provides scrollback navigation when attached to an agent session.
 * Two mechanisms: mouse wheel (input still forwarded to PTY) and
 * keyboard nav via Ctrl+B (input captured for navigation keys).
 */

import { Terminal } from '@xterm/headless';
import { SCROLL_MODE_CHAR } from '../transport/protocol.ts';

const RESET = '\x1B[0m';
const DIM = '\x1B[2m';
const REVERSE = '\x1B[7m';

// ── State ──────────────────────────────────────────────────────────

let xtermClient: Terminal | null = null;
let scrollOffset = 0;           // lines from bottom, 0 = live edge
let keyboardNavActive = false;
let pendingLines = 0;           // new lines arrived while scrolled
let viewportRows = 24;
let viewportCols = 80;
let scrollStdout: NodeJS.WriteStream | null = null;
let inScrolledState = false;    // true when alt screen is active for scroll
let resizePending = false;
let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Public API ─────────────────────────────────────────────────────

export function initClientXterm(cols: number, rows: number): void {
	xtermClient = new Terminal({
		cols,
		rows,
		scrollback: 10_000,
		allowProposedApi: true,
	});
	viewportCols = cols;
	viewportRows = rows;
	scrollOffset = 0;
	keyboardNavActive = false;
	pendingLines = 0;
	inScrolledState = false;
}

export function destroyClientXterm(): void {
	if (xtermClient) {
		xtermClient.dispose();
		xtermClient = null;
	}
	scrollOffset = 0;
	keyboardNavActive = false;
	pendingLines = 0;
	inScrolledState = false;
	scrollStdout = null;
}

export function feedXterm(data: string): void {
	if (!xtermClient) return;
	xtermClient.write(data);
	if (inScrolledState) {
		// Count approximate new lines for ticker indicator
		const newlines = data.split('\n').length - 1;
		pendingLines += Math.max(1, newlines);
	}
}

export function isScrolled(): boolean {
	return inScrolledState;
}

export function isKeyboardNav(): boolean {
	return keyboardNavActive;
}

export function getPendingLines(): number {
	return pendingLines;
}

export function isResizePending(): boolean {
	return resizePending;
}

export function setResizePending(value: boolean): void {
	resizePending = value;
}

export function scheduleResizeRepaint(callback: () => void, delay = 500): void {
	if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
	resizeDebounceTimer = setTimeout(() => {
		resizeDebounceTimer = null;
		resizePending = false;
		callback();
	}, delay);
}

export function clearResizeDebounce(): void {
	if (resizeDebounceTimer) {
		clearTimeout(resizeDebounceTimer);
		resizeDebounceTimer = null;
	}
	resizePending = false;
}

export function repaintFromBuffer(stdout: NodeJS.WriteStream): void {
	if (!xtermClient) return;

	const buf = xtermClient.buffer.normal;
	const rows = viewportRows;
	const cols = viewportCols;

	let output = '';

	for (let r = 0; r < rows; r++) {
		const line = buf.getLine(buf.baseY + r);
		output += `\x1B[${r + 1};1H\x1B[2K`;
		if (!line) continue;
		output += serializeLine(line, cols);
	}

	// Restore cursor position
	output += `\x1B[${buf.cursorY + 1};${buf.cursorX + 1}H`;

	stdout.write(output);
}

export function scrollUp(lines: number): void {
	if (!xtermClient) return;

	const buf = xtermClient.buffer.normal;
	const totalLines = buf.length;
	const maxOffset = Math.max(0, totalLines - viewportRows);

	scrollOffset = Math.min(scrollOffset + lines, maxOffset);

	if (!inScrolledState && scrollOffset > 0) {
		enterScrolledState(process.stdout);
	} else if (inScrolledState) {
		renderScrollViewport();
	}
}

export function scrollDown(lines: number): void {
	if (!xtermClient) return;

	scrollOffset = Math.max(0, scrollOffset - lines);

	if (scrollOffset === 0 && inScrolledState) {
		exitScrolledState();
	} else if (inScrolledState) {
		renderScrollViewport();
	}
}

export function enterKeyboardNav(): void {
	keyboardNavActive = true;

	if (!inScrolledState) {
		// Enter scrolled state at current position (bottom)
		scrollOffset = 0;
		enterScrolledState(process.stdout);
	} else {
		renderScrollViewport(); // re-render to show keyboard nav status bar
	}
}

export function exitKeyboardNav(): void {
	keyboardNavActive = false;

	if (inScrolledState) {
		// Snap to bottom and exit
		scrollOffset = 0;
		exitScrolledState();
	}
}

export function enterScrolledState(stdout: NodeJS.WriteStream): void {
	if (inScrolledState) return;
	scrollStdout = stdout;
	inScrolledState = true;
	pendingLines = 0;

	// Switch to alt screen for scroll viewport
	stdout.write('\x1B[?1049h');
	renderScrollViewport();
}

export function exitScrolledState(): void {
	if (!inScrolledState || !scrollStdout) return;

	// Switch back from alt screen
	scrollStdout.write('\x1B[?1049l');

	inScrolledState = false;
	scrollOffset = 0;
	pendingLines = 0;
	keyboardNavActive = false;
	scrollStdout = null;
}

export function handleScrollResize(cols: number, rows: number): void {
	viewportCols = cols;
	viewportRows = rows;
	if (xtermClient) {
		xtermClient.resize(cols, rows);
	}
	if (inScrolledState) {
		renderScrollViewport();
	}
}

/**
 * Handle keyboard navigation input. Returns true if the key was consumed.
 */
export function handleKeyboardNavInput(data: Buffer): boolean {
	if (!keyboardNavActive) return false;

	// Single byte keys
	if (data.length === 1) {
		const byte = data[0];
		switch (byte) {
			case 0x6B: // k - scroll up 1
				scrollUp(1);
				return true;
			case 0x6A: // j - scroll down 1
				scrollDown(1);
				return true;
			case 0x67: // g - jump to top
				jumpToTop();
				return true;
			case 0x47: // G - jump to bottom + exit
				exitKeyboardNav();
				return true;
			case 0x71: // q - exit keyboard nav
				exitKeyboardNav();
				return true;
			case 0x1B: // Esc - exit keyboard nav
				exitKeyboardNav();
				return true;
			case SCROLL_MODE_CHAR: // Ctrl+B - exit keyboard nav
				exitKeyboardNav();
				return true;
		}
		return false;
	}

	// Escape sequences
	if (data.length >= 3 && data[0] === 0x1B && data[1] === 0x5B) {
		// Arrow keys
		if (data.length === 3) {
			switch (data[2]) {
				case 0x41: // Up arrow
					scrollUp(1);
					return true;
				case 0x42: // Down arrow
					scrollDown(1);
					return true;
			}
		}

		// Page Up: \x1B[5~
		if (data.length === 4 && data[2] === 0x35 && data[3] === 0x7E) {
			scrollUp(Math.floor(viewportRows / 2));
			return true;
		}
		// Page Down: \x1B[6~
		if (data.length === 4 && data[2] === 0x36 && data[3] === 0x7E) {
			scrollDown(Math.floor(viewportRows / 2));
			return true;
		}
	}

	return false;
}

/**
 * Parse SGR mouse events from input data.
 * SGR format: \x1B[<btn;col;rowM (press) or \x1B[<btn;col;rowm (release)
 */
export function parseMouseEvent(data: Buffer, offset: number): { type: 'wheel-up' | 'wheel-down' | 'other'; length: number } | null {
	// Need at least \x1B[< = 3 bytes prefix
	if (offset + 3 > data.length) return null;
	if (data[offset] !== 0x1B || data[offset + 1] !== 0x5B || data[offset + 2] !== 0x3C) return null;

	// Find the terminator M or m
	let end = offset + 3;
	while (end < data.length) {
		const b = data[end];
		if (b === 0x4D || b === 0x6D) { // 'M' or 'm'
			break;
		}
		// Parameter bytes: digits and semicolons
		if ((b >= 0x30 && b <= 0x39) || b === 0x3B) {
			end++;
			continue;
		}
		return null; // unexpected byte
	}

	if (end >= data.length) return null;

	const paramStr = data.subarray(offset + 3, end).toString('ascii');
	const seqLength = end - offset + 1;

	const parts = paramStr.split(';');
	if (parts.length < 3) return null;

	const button = parseInt(parts[0], 10);

	if (button === 64) return { type: 'wheel-up', length: seqLength };
	if (button === 65) return { type: 'wheel-down', length: seqLength };

	return { type: 'other', length: seqLength };
}

/**
 * Check if the buffer starts with a mouse sequence at the given offset.
 */
export function isMouseSequence(data: Buffer, offset: number): boolean {
	return offset + 2 < data.length
		&& data[offset] === 0x1B
		&& data[offset + 1] === 0x5B
		&& data[offset + 2] === 0x3C;
}

// ── Internal ───────────────────────────────────────────────────────

function serializeLine(line: import('@xterm/headless').IBufferLine, cols: number): string {
	let result = '';
	let lastSgr = '';
	const cell = xtermClient!.buffer.normal.getNullCell();

	for (let x = 0; x < cols; x++) {
		line.getCell(x, cell);
		if (!cell) break;

		const chars = cell.getChars();
		const width = cell.getWidth();

		// Skip continuation cells (wide char second cell)
		if (width === 0 && chars === '') continue;

		// Build SGR for this cell
		let sgr = '';
		if (cell.isAttributeDefault()) {
			if (lastSgr !== '') {
				sgr = '\x1B[0m';
			}
		} else {
			const parts: number[] = [0]; // reset first

			if (cell.isBold()) parts.push(1);
			if (cell.isDim()) parts.push(2);
			if (cell.isItalic()) parts.push(3);
			if (cell.isUnderline()) parts.push(4);
			if (cell.isInverse()) parts.push(7);
			if (cell.isStrikethrough()) parts.push(9);
			if (cell.isOverline()) parts.push(53);

			// Foreground
			if (cell.isFgPalette()) {
				const color = cell.getFgColor();
				if (color < 8) parts.push(30 + color);
				else if (color < 16) parts.push(90 + color - 8);
				else parts.push(38, 5, color);
			} else if (cell.isFgRGB()) {
				const color = cell.getFgColor();
				parts.push(38, 2, (color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF);
			}

			// Background
			if (cell.isBgPalette()) {
				const color = cell.getBgColor();
				if (color < 8) parts.push(40 + color);
				else if (color < 16) parts.push(100 + color - 8);
				else parts.push(48, 5, color);
			} else if (cell.isBgRGB()) {
				const color = cell.getBgColor();
				parts.push(48, 2, (color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF);
			}

			sgr = `\x1B[${parts.join(';')}m`;
		}

		if (sgr !== lastSgr) {
			result += sgr;
			lastSgr = sgr;
		}

		result += chars || ' ';
	}

	// Reset at end of line
	if (lastSgr !== '') result += '\x1B[0m';

	return result;
}

function jumpToTop(): void {
	if (!xtermClient) return;
	const buf = xtermClient.buffer.normal;
	const maxOffset = Math.max(0, buf.length - viewportRows);
	scrollOffset = maxOffset;
	if (inScrolledState) {
		renderScrollViewport();
	}
}

function renderScrollViewport(): void {
	if (!scrollStdout || !xtermClient) return;

	const buf = xtermClient.buffer.normal;
	const totalLines = buf.length;

	// Calculate the top line to display
	// viewportRows - 1 to leave room for status bar
	const displayRows = viewportRows - 1;
	const topLine = Math.max(0, totalLines - displayRows - scrollOffset);
	const currentLine = totalLines - scrollOffset;

	let output = '';

	for (let r = 0; r < displayRows; r++) {
		const lineIdx = topLine + r;
		let text = '';
		if (lineIdx < totalLines) {
			const line = buf.getLine(lineIdx);
			if (line) {
				text = line.translateToString(true, 0, viewportCols);
			}
		}
		// Position cursor, clear line, write text
		output += `\x1B[${r + 1};1H\x1B[2K${text}`;
	}

	// Status bar on last row
	const statusRow = viewportRows;
	let statusText: string;
	if (keyboardNavActive) {
		statusText = ` [SCROLL] ${currentLine}/${totalLines} | j/k \u2191\u2193 PgUp/PgDn g/G | Ctrl+B exit `;
	} else {
		statusText = ` [SCROLL] ${currentLine}/${totalLines} | scroll \u2193 to return `;
	}

	const pad = Math.max(0, viewportCols - statusText.length);
	output += `\x1B[${statusRow};1H\x1B[2K${REVERSE}${statusText}${' '.repeat(pad)}${RESET}`;

	scrollStdout.write(output);
}
