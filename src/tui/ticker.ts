/**
 * Status ticker bar — raw ANSI rendering during attached mode.
 *
 * Renders a persistent status bar at the bottom row of the terminal
 * showing all agent sessions with state indicators. Manages the scroll
 * region (DECSTBM) to confine PTY output above the ticker.
 */

import { store } from './store.ts';
import { getStateDisplay, colorToAnsi } from './agent-state.ts';
import { getPendingLines, isScrolled as isScrollModeActive } from './scroll-mode.ts';

const RESET = '\x1B[0m';
const BOLD = '\x1B[1m';
const DIM = '\x1B[2m';
const REVERSE = '\x1B[7m';
const SAVE_CURSOR = '\x1B7';
const RESTORE_CURSOR = '\x1B8';

// ── State ──────────────────────────────────────────────────────────

let active = false;
let navMode = false;
let scrollOffset = 0;
let tickerStdout: NodeJS.WriteStream | null = null;
let unsubscribe: (() => void) | null = null;
let redrawTimer: ReturnType<typeof setTimeout> | null = null;

// ── Public API ─────────────────────────────────────────────────────

export function getTickerHeight(): number {
	return 1;
}

export function setupTicker(opts: { stdout: NodeJS.WriteStream }): void {
	tickerStdout = opts.stdout;
	active = true;
	navMode = false;
	scrollOffset = 0;

	const rows = tickerStdout.rows || 24;

	// Set scroll region to all rows except the last one (ticker row)
	tickerStdout.write(`\x1B[1;${rows - getTickerHeight()}r`);

	// Move cursor to top-left within scroll region
	tickerStdout.write('\x1B[H');

	renderTicker();

	// Subscribe to store changes to re-render ticker when sessions update
	unsubscribe = store.subscribe((state, prev) => {
		if (!active) return;
		if (state.sessions !== prev.sessions || state.attachedSessionId !== prev.attachedSessionId) {
			autoScrollToAttached();
			renderTicker();
		}
	});
}

export function teardownTicker(): void {
	active = false;
	navMode = false;

	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}

	if (redrawTimer) {
		clearTimeout(redrawTimer);
		redrawTimer = null;
	}

	if (!tickerStdout) return;

	// Reset scroll region to full terminal
	tickerStdout.write('\x1B[r');

	// Clear the ticker row
	const rows = tickerStdout.rows || 24;
	tickerStdout.write(SAVE_CURSOR);
	tickerStdout.write(`\x1B[${rows};1H`);
	tickerStdout.write('\x1B[2K');
	tickerStdout.write(RESTORE_CURSOR);

	tickerStdout = null;
}

/** Re-establish scroll region and redraw ticker after a full screen clear. */
export function reassertTicker(): void {
	if (!active || !tickerStdout) return;

	const rows = tickerStdout.rows || 24;

	// Restore scroll region (confine PTY output above ticker).
	// DECSTBM implicitly homes the cursor, so save/restore around it.
	tickerStdout.write(SAVE_CURSOR);
	tickerStdout.write(`\x1B[1;${rows - getTickerHeight()}r`);
	tickerStdout.write(RESTORE_CURSOR);

	renderTicker();
}

export function renderTicker(): void {
	if (!active || !tickerStdout) return;

	const cols = tickerStdout.columns || 80;
	const rows = tickerStdout.rows || 24;
	const { sessions, attachedSessionId } = store.getState();

	// Build ticker entries
	const entries = buildEntries(sessions, attachedSessionId, cols);

	// Save cursor, move to ticker row, render, restore
	tickerStdout.write(SAVE_CURSOR);
	tickerStdout.write(`\x1B[${rows};1H`);
	tickerStdout.write(REVERSE);
	tickerStdout.write(entries);
	tickerStdout.write(RESET);
	tickerStdout.write(RESTORE_CURSOR);
}

export function scheduleTickerRedraw(): void {
	if (!active) return;
	if (redrawTimer) return;
	redrawTimer = setTimeout(() => {
		redrawTimer = null;
		renderTicker();
	}, 16);
}

export function tickerHandleResize(): { cols: number; rows: number } {
	if (!tickerStdout) {
		return { cols: 80, rows: 24 };
	}

	const cols = tickerStdout.columns || 80;
	const rows = tickerStdout.rows || 24;
	const ptyRows = rows - getTickerHeight();

	// Update scroll region (DECSTBM homes cursor implicitly — save/restore around it)
	tickerStdout.write(SAVE_CURSOR);
	tickerStdout.write(`\x1B[1;${ptyRows}r`);
	tickerStdout.write(RESTORE_CURSOR);

	renderTicker();

	return { cols, rows: ptyRows };
}

export function enterNavMode(): void {
	navMode = true;
	renderTicker();
}

export function exitNavMode(): void {
	navMode = false;
	renderTicker();
}

export function isNavMode(): boolean {
	return navMode;
}

export function scrollTickerLeft(): void {
	if (scrollOffset > 0) {
		scrollOffset--;
		renderTicker();
	}
}

export function scrollTickerRight(): void {
	const { sessions } = store.getState();
	if (scrollOffset < sessions.length - 1) {
		scrollOffset++;
		renderTicker();
	}
}

// ── Internal ───────────────────────────────────────────────────────

function autoScrollToAttached(): void {
	const { sessions, attachedSessionId } = store.getState();
	if (!attachedSessionId) return;

	const idx = sessions.findIndex(s => s.id === attachedSessionId);
	if (idx === -1) return;

	// Ensure the attached session is visible (simple: if before scroll, adjust)
	if (idx < scrollOffset) {
		scrollOffset = idx;
	}
	// We'll also check if it's past the visible window in buildEntries,
	// but a rough adjustment here helps
	if (!tickerStdout) return;
	const cols = tickerStdout.columns || 80;
	const visibleWidth = cols - 2; // account for possible overflow indicators
	let usedWidth = 0;
	for (let i = scrollOffset; i < sessions.length; i++) {
		const entryLen = sessions[i].name.length + 2; // "dot name" or "N:name"
		if (i > scrollOffset) usedWidth += 3; // " | " separator
		usedWidth += entryLen;
		if (i === idx && usedWidth > visibleWidth) {
			scrollOffset = idx;
			break;
		}
		if (i === idx) break;
	}
}

function buildEntries(sessions: import('../types/index.ts').SessionInfo[], attachedSessionId: string | null, cols: number): string {
	if (sessions.length === 0) {
		const empty = ' no agents ';
		const pad = Math.max(0, cols - empty.length);
		return empty + ' '.repeat(pad);
	}

	const hasLeftOverflow = scrollOffset > 0;
	const availableCols = cols - (hasLeftOverflow ? 2 : 0); // reserve 2 for "< " or " >"

	// Build visible entries
	const parts: string[] = [];
	let totalWidth = 0;
	let rightOverflow = false;
	const visibleStart = scrollOffset;

	for (let i = visibleStart; i < sessions.length; i++) {
		const s = sessions[i];
		const { dot, color } = getStateDisplay(s);
		const isAttached = s.id === attachedSessionId;
		const isLocked = s.locked && !isAttached;
		const posInView = i - scrollOffset;

		let label: string;
		let labelLen: number;
		if (navMode) {
			const slot = posInView < 9 ? String(posInView + 1) : '\u00B7';
			label = isLocked ? `${slot}:🔒${s.name}` : `${slot}:${s.name}`;
			labelLen = isLocked ? label.length + 1 : label.length; // 🔒 is 2 bytes but 1-2 cells wide
		} else {
			const displayDot = isLocked ? '🔒' : dot;
			label = `${displayDot} ${s.name}`;
			labelLen = 2 + s.name.length;
		}

		// Separator width
		const sepWidth = parts.length > 0 ? 3 : 0;
		const entryWidth = sepWidth + labelLen;

		// Check if this entry fits (reserve 2 for possible " >" indicator)
		if (totalWidth + entryWidth > availableCols - 2 && i < sessions.length - 1) {
			rightOverflow = true;
			break;
		}
		// Even the last entry: check it fits
		if (totalWidth + entryWidth > availableCols) {
			rightOverflow = true;
			break;
		}

		// Build styled entry string
		let styledEntry: string;
		if (navMode) {
			const slot = posInView < 9 ? String(posInView + 1) : '\u00B7';
			if (isAttached) {
				styledEntry = `${BOLD}${slot}:${s.name}${RESET}${REVERSE}`;
			} else if (isLocked) {
				styledEntry = `${DIM}${slot}:🔒${s.name}${RESET}${REVERSE}`;
			} else {
				styledEntry = `${slot}:${s.name}`;
			}
		} else {
			const ansi = colorToAnsi(color);
			if (isAttached) {
				styledEntry = `${ansi}${dot}${RESET}${REVERSE} ${BOLD}${s.name}${RESET}${REVERSE}`;
			} else if (isLocked) {
				styledEntry = `${DIM}🔒 ${s.name}${RESET}${REVERSE}`;
			} else {
				styledEntry = `${ansi}${dot}${RESET}${REVERSE} ${s.name}`;
			}
		}

		if (parts.length > 0) {
			parts.push(`${DIM}|${RESET}${REVERSE}`);
		}
		parts.push(` ${styledEntry} `);
		totalWidth += entryWidth + (sepWidth === 0 ? 2 : 0); // +2 for surrounding spaces on first entry
		if (sepWidth > 0) totalWidth += 0; // separator already counted
	}

	// Recalculate actual character width for padding
	let result = '';
	if (hasLeftOverflow) {
		result += `${DIM}<${RESET}${REVERSE} `;
	}
	result += parts.join('');
	if (rightOverflow) {
		result += ` ${DIM}>${RESET}${REVERSE}`;
	}

	// Append "new lines" indicator when scrolled
	if (isScrollModeActive()) {
		const pending = getPendingLines();
		if (pending > 0) {
			result += ` ${DIM}\u2193 ${pending} new${RESET}${REVERSE}`;
		}
	}

	// Pad to fill the full width — calculate visible char count
	// We need to strip ANSI codes to measure visible length
	const visibleLen = stripAnsi(result).length;
	const pad = Math.max(0, cols - visibleLen);
	result += ' '.repeat(pad);

	return result;
}

function stripAnsi(str: string): string {
	return str.replace(/\x1B\[[0-9;]*m/g, '').replace(/\x1B[78]/g, '');
}
