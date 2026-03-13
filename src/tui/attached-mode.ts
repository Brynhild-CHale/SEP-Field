/**
 * Attached mode — raw PTY passthrough with ticker bar.
 *
 * Manages the lifecycle of direct terminal I/O when the user attaches
 * to an agent session. Ink is unmounted during this mode; stdin/stdout
 * are wired directly to the daemon socket.
 */

import {
	NAV_TOGGLE_CHAR,
	SCROLL_LEFT_CHAR,
	SCROLL_RIGHT_CHAR,
	encodeFrame,
	MSG_DEBUG,
} from '../transport/protocol.ts';
import { matchCsiU, findNextKeybinding } from './keybindings.ts';
import { store } from './store.ts';
import {
	detach,
	isConnected,
	sendStdin,
	sendResize,
	sendRawFrame,
	switchToSession,
	setHistoryReplayCallback,
} from './connection.ts';
import { normalizeLineEndings } from './sanitize.ts';
import {
	setupTicker,
	teardownTicker,
	reassertTicker,
	scheduleTickerRedraw,
	enterNavMode,
	exitNavMode,
	isNavMode,
	scrollTickerLeft,
	scrollTickerRight,
	getTickerHeight,
} from './ticker.ts';
import {
	initClientXterm,
	destroyClientXterm,
	feedXterm,
	isScrolled,
	isKeyboardNav,
	scrollUp,
	scrollDown,
	enterKeyboardNav,
	exitKeyboardNav,
	exitScrolledState,
	handleKeyboardNavInput,
	handleScrollResize,
	parseMouseEvent,
	isMouseSequence,
	isResizePending,
	clearResizeDebounce,
} from './scroll-mode.ts';

const { stdout, stdin } = process;

// ── Ink lifecycle hooks (set by client.tsx via init) ────────────────

let mountInkFn: () => void;
let unmountInkFn: () => void;

export function initAttachedMode(hooks: { mountInk: () => void; unmountInk: () => void }) {
	mountInkFn = hooks.mountInk;
	unmountInkFn = hooks.unmountInk;
}

// ── State ──────────────────────────────────────────────────────────

let rawStdinHandler: ((data: Buffer) => void) | null = null;
let unsubLiveData: (() => void) | null = null;
let unsubHistoryEnd: (() => void) | null = null;
const liveDecoder = new TextDecoder('utf-8');

// ── Debug logging (sent to daemon via MSG_DEBUG) ───────────────────

function debugLog(msg: string) {
	if (isConnected()) sendRawFrame(encodeFrame(MSG_DEBUG, Buffer.from(msg, 'utf8')));
}

// ── Public API ─────────────────────────────────────────────────────

export function enterAttachedMode() {
	unmountInkFn();

	// Ink disables raw mode on unmount — re-enable for PTY passthrough
	if (stdin.isTTY) {
		stdin.setRawMode(true);
		stdin.resume();
		stdin.ref();
	}

	// Set up ticker bar
	setupTicker({ stdout });

	// Send corrected resize to PTY (exclude ticker height)
	const ptyRows = (stdout.rows || 24) - getTickerHeight();
	sendResize(stdout.columns || 80, ptyRows);

	// Init client-side xterm for scrollback
	initClientXterm(stdout.columns || 80, ptyRows);

	// Enable SGR mouse tracking for scroll wheel
	stdout.write('\x1B[?1000h\x1B[?1006h');

	// Register history replay callback to feed xterm
	setHistoryReplayCallback((data: string) => feedXterm(data));

	// Subscribe to live data from store (written by connection.ts)
	unsubLiveData = store.subscribe((state, prev) => {
		if (state.liveDataPayload && state.liveDataPayload !== prev.liveDataPayload) {
			const str = liveDecoder.decode(state.liveDataPayload, { stream: true });
			const normalized = normalizeLineEndings(str);
			// Always feed xterm buffer
			feedXterm(normalized);
			if (isScrolled() || isResizePending()) {
				// Don't write to stdout while scrolled — viewport stays at user's position
				// Ticker will show "new lines" indicator
				scheduleTickerRedraw();
			} else {
				stdout.write(normalized);
				scheduleTickerRedraw();
			}
		}
	});

	// Re-assert ticker after history replay finishes (initial attach + session switch)
	unsubHistoryEnd = store.subscribe((state, prev) => {
		if (state.historyEndSignal !== prev.historyEndSignal) {
			reassertTicker();
		}
	});

	// Handle stdin: forward to PTY, intercept keybindings + scroll
	rawStdinHandler = (rawData: Buffer) => {
		if (!isConnected()) return;
		const data = Buffer.from(rawData);

		debugLog(`stdin hex [${data.length}]: ${data.toString('hex')}`);

		// 1. Parse mouse events first (before keybindings)
		if (isMouseSequence(data, 0)) {
			handleMouseInput(data);
			return;
		}

		// 2. If keyboard nav is active, route to keyboard nav handler
		if (isKeyboardNav()) {
			handleScrollKeyboardNavInput(data);
			return;
		}

		// 3. Nav mode (ticker number select)
		if (isNavMode()) {
			handleNavModeInput(data);
			return;
		}

		// 4. Normal keybinding scan
		const match = findNextKeybinding(data, 0);
		debugLog(`findNextKeybinding: ${match ? `action=${match.action} offset=${match.offset} len=${match.length}` : 'no match'}`);
		if (!match) {
			sendStdin(data);
			return;
		}

		// Forward bytes before the match to PTY
		if (match.offset > 0) sendStdin(data.subarray(0, match.offset));

		// Handle the matched keybinding
		const remaining = match.offset + match.length < data.length
			? data.subarray(match.offset + match.length)
			: null;

		handleKeybindingAction(match.action);

		// Process remaining bytes
		if (remaining) rawStdinHandler!(remaining);
	};

	stdin.on('data', rawStdinHandler);
}

export function exitAttachedModeCleanup() {
	// Remove raw stdin handler
	if (rawStdinHandler) {
		stdin.removeListener('data', rawStdinHandler);
		rawStdinHandler = null;
	}

	// Unsubscribe store listeners
	if (unsubLiveData) { unsubLiveData(); unsubLiveData = null; }
	if (unsubHistoryEnd) { unsubHistoryEnd(); unsubHistoryEnd = null; }

	// Clear stale signals
	store.setState({ liveDataPayload: null });

	// Cancel any pending resize repaint
	clearResizeDebounce();

	// Exit scrolled state if active
	if (isScrolled()) {
		exitScrolledState();
	}

	// Disable mouse tracking
	stdout.write('\x1B[?1000l\x1B[?1006l');

	// Destroy client xterm
	destroyClientXterm();

	// Clear history replay callback
	setHistoryReplayCallback(null);

	// Tear down ticker
	teardownTicker();

	// Clear the terminal so the agent's last frame doesn't show behind the switcher
	stdout.write('\x1B[2J\x1B[H');

	// Release raw mode before Ink re-mounts (it will re-enable it)
	if (stdin.isTTY) {
		stdin.setRawMode(false);
	}

	// Re-mount Ink
	mountInkFn();
}

export function exitAttachedMode() {
	exitAttachedModeCleanup();
	detach();
}

export function isAttachedModeActive(): boolean {
	return rawStdinHandler !== null;
}

// ── Internal ───────────────────────────────────────────────────────

function handleKeybindingAction(action: string) {
	switch (action) {
		case 'detach':
			exitAttachedMode();
			return;
		case 'nav-toggle':
			enterNavMode();
			break;
		case 'scroll-mode':
			if (isScrolled()) {
				if (isKeyboardNav()) exitKeyboardNav(); else enterKeyboardNav();
			} else {
				enterKeyboardNav();
			}
			break;
		case 'scroll-left': {
			if (isScrolled()) exitScrolledState();
			const { sessions, attachedSessionId } = store.getState();
			const idx = sessions.findIndex(s => s.id === attachedSessionId);
			for (let i = idx - 1; i >= 0; i--) {
				if (!sessions[i].locked) {
					switchToSession(sessions[i].id, getTickerHeight());
					reassertTicker();
					break;
				}
			}
			break;
		}
		case 'scroll-right': {
			if (isScrolled()) exitScrolledState();
			const { sessions, attachedSessionId } = store.getState();
			const idx = sessions.findIndex(s => s.id === attachedSessionId);
			for (let i = idx + 1; i < sessions.length; i++) {
				if (!sessions[i].locked) {
					switchToSession(sessions[i].id, getTickerHeight());
					reassertTicker();
					break;
				}
			}
			break;
		}
	}
}

function handleMouseInput(data: Buffer) {
	let offset = 0;
	while (offset < data.length) {
		if (isMouseSequence(data, offset)) {
			const event = parseMouseEvent(data, offset);
			if (!event) {
				// Malformed mouse sequence, forward rest to PTY
				sendStdin(data.subarray(offset));
				return;
			}

			if (event.type === 'wheel-up') {
				scrollUp(3);
			} else if (event.type === 'wheel-down') {
				scrollDown(3);
			} else {
				// Non-wheel mouse events: forward to PTY
				sendStdin(data.subarray(offset, offset + event.length));
			}

			offset += event.length;
		} else {
			// Non-mouse data after mouse sequences — process normally
			const rest = data.subarray(offset);
			rawStdinHandler!(rest);
			return;
		}
	}
}

function handleScrollKeyboardNavInput(data: Buffer) {
	// Check for mouse events even during keyboard nav
	if (isMouseSequence(data, 0)) {
		handleMouseInput(data);
		return;
	}

	// Global keybindings that should exit scroll first
	const match = findNextKeybinding(data, 0);
	if (match) {
		if (match.action === 'detach') {
			exitScrolledState();
			exitAttachedMode();
			return;
		}
		if (match.action === 'scroll-left' || match.action === 'scroll-right') {
			exitScrolledState();
			handleKeybindingAction(match.action);
			return;
		}
		if (match.action === 'nav-toggle') {
			exitScrolledState();
			enterNavMode();
			return;
		}
		if (match.action === 'scroll-mode') {
			exitKeyboardNav();
			return;
		}
	}

	// Try keyboard nav keys (j/k/arrows/PgUp/PgDn/g/G/q/Esc)
	if (handleKeyboardNavInput(data)) {
		return;
	}

	// Unrecognized key in keyboard nav: exit and forward to PTY
	exitKeyboardNav();
	sendStdin(data);
}

function handleNavModeInput(data: Buffer) {
	debugLog(`navMode hex [${data.length}]: ${Buffer.from(data).toString('hex')}`);
	for (let i = 0; i < data.length; i++) {
		const byte = data[i];

		// Ctrl+n toggles nav mode off — check raw byte
		if (byte === NAV_TOGGLE_CHAR) {
			exitNavMode();
			if (i + 1 < data.length) {
				rawStdinHandler!(data.subarray(i + 1));
			}
			return;
		}

		// CSI u sequences: check for Ctrl+n (toggle off) and Ctrl+h/l (scroll)
		if (byte === 0x1B) {
			const csiMatch = matchCsiU(data, i);
			if (csiMatch) {
				if (csiMatch.action === 'nav-toggle') {
					exitNavMode();
					const after = i + csiMatch.length;
					if (after < data.length) {
						rawStdinHandler!(data.subarray(after));
					}
					return;
				}
				if (csiMatch.action === 'scroll-left') {
					scrollTickerLeft();
					i += csiMatch.length - 1; // -1 because loop increments
					continue;
				}
				if (csiMatch.action === 'scroll-right') {
					scrollTickerRight();
					i += csiMatch.length - 1;
					continue;
				}
			}
		}

		// Ctrl+h / Ctrl+l raw bytes: scroll ticker, stay in nav mode
		if (byte === SCROLL_LEFT_CHAR) {
			scrollTickerLeft();
			continue;
		}
		if (byte === SCROLL_RIGHT_CHAR) {
			scrollTickerRight();
			continue;
		}

		// Digits 1-9: switch to agent at that ticker position
		if (byte >= 0x31 && byte <= 0x39) {
			const position = byte - 0x30; // 1-based
			exitNavMode();
			switchToAgentByPosition(position);
			return;
		}

		// Any other key: cancel nav mode, forward this key + remaining to PTY
		exitNavMode();
		sendStdin(data.subarray(i));
		return;
	}
}

function switchToAgentByPosition(position: number) {
	const { sessions, attachedSessionId } = store.getState();
	const index = position - 1;
	if (index >= 0 && index < sessions.length) {
		const targetSession = sessions[index];
		if (targetSession.id !== attachedSessionId && !targetSession.locked) {
			switchToSession(targetSession.id, getTickerHeight());
			reassertTicker();
		}
	}
}
