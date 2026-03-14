/**
 * SEP-Field TUI Client — Entry Point Orchestrator
 *
 * Architecture: Ink mounts/unmounts around raw PTY passthrough.
 *
 * - Mount Ink when in switcher, management, or transition modes
 * - Unmount Ink when user attaches to a session (raw PTY passthrough)
 * - Re-mount Ink on Ctrl+q detach (store state preserved externally)
 * - Ticker bar persists at bottom row during attached mode
 */

import { existsSync, writeSync } from 'fs';
import { render, type Instance } from 'ink';
import React from 'react';
import { ORCHESTRATOR_SOCKET_PATH } from '../transport/protocol.ts';
import { store } from './store.ts';
import {
	connect,
	detach,
	isConnected,
	setOnDisconnect,
	sendStdin,
	sendResize,
	fetchActions,
	checkForUpdate,
} from './connection.ts';
import { restoreTerminal } from './sanitize.ts';
import { App } from './components/App.tsx';
import { teardownTicker, tickerHandleResize, reassertTicker, getTickerHeight } from './ticker.ts';
import {
	initAttachedMode,
	enterAttachedMode,
	exitAttachedModeCleanup,
	isAttachedModeActive,
} from './attached-mode.ts';
import {
	handleScrollResize,
	setResizePending,
	scheduleResizeRepaint,
	repaintFromBuffer,
	isScrolled,
} from './scroll-mode.ts';

const { stdout, stdin } = process;

// ── Pre-flight ─────────────────────────────────────────────────────

if (!existsSync(ORCHESTRATOR_SOCKET_PATH)) {
	console.error('Daemon not running. Start it with: sep start');
	process.exit(1);
}

// ── Ink instance management ────────────────────────────────────────

let inkInstance: Instance | null = null;

function mountInk() {
	if (inkInstance) return;

	inkInstance = render(React.createElement(App), {
		exitOnCtrlC: false,
	});
}

function unmountInk() {
	if (!inkInstance) return;
	inkInstance.clear();
	inkInstance.unmount();
	inkInstance = null;
}

// Wire up attached mode with Ink lifecycle hooks
initAttachedMode({ mountInk, unmountInk });

// ── Mode change listener (vanilla subscription, not React) ─────────

store.subscribe((state, prev) => {
	if (state.mode === 'attached' && prev.mode !== 'attached') {
		enterAttachedMode();
	}

	// PTY exit while attached: server already sent PTY_EXIT and
	// connection.ts set mode to 'switcher', so just clean up client-side
	if (prev.mode === 'attached' && state.mode !== 'attached' && isAttachedModeActive()) {
		exitAttachedModeCleanup();
	}
});

// ── Alternate screen buffer cleanup (runs on ALL exit paths) ────────

process.on('exit', () => {
	writeSync(1, '\x1B[?1049l');
});

// ── Signal handling ────────────────────────────────────────────────

function cleanExit(code: number = 0): void {
	teardownTicker();
	unmountInk();
	restoreTerminal();
	process.exit(code);
}

process.on('SIGINT', () => {
	const { mode } = store.getState();
	if (mode === 'attached' && isConnected()) {
		sendStdin(Buffer.from([0x03]));
	} else {
		cleanExit(0);
	}
});

process.on('SIGTERM', () => {
	const { mode } = store.getState();
	if (mode === 'attached' && isConnected()) {
		detach();
	}
	cleanExit(0);
});

// ── Resize handling ────────────────────────────────────────────────

stdout.on('resize', () => {
	const { mode } = store.getState();
	if (mode === 'attached' && isConnected()) {
		// Immediate: send dimensions + resize xterm + fix DECSTBM
		const cols = stdout.columns || 80;
		const ptyRows = (stdout.rows || 24) - getTickerHeight();
		sendResize(cols, ptyRows);
		handleScrollResize(cols, ptyRows);
		setResizePending(true);
		tickerHandleResize();

		// Debounced: repaint from buffer after resize settles
		scheduleResizeRepaint(() => {
			if (!isScrolled()) {
				repaintFromBuffer(stdout);
			}
			reassertTicker();
		});
	}
});

// ── Disconnect handler ─────────────────────────────────────────────

setOnDisconnect(() => {
	console.error('\r\nDisconnected from daemon');
	cleanExit(0);
});

// ── Bootstrap ──────────────────────────────────────────────────────

if (stdin.isTTY) {
	stdin.setRawMode(true);
}

await connect();
fetchActions();
checkForUpdate(); // Best-effort, non-blocking
stdout.write('\x1B[?1049h'); // Enter alternate screen buffer
stdout.write('\x1B[2J\x1B[H');
mountInk();
