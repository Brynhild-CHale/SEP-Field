/**
 * Connection manager — React-external singleton.
 *
 * Talks to the daemon over Unix socket (binary frame protocol) and the
 * HTTP API. Updates the zustand store on server-pushed frames.
 */

import {
	ORCHESTRATOR_SOCKET_PATH,
	MSG_HISTORY,
	MSG_HISTORY_END,
	MSG_LIVE_DATA,
	MSG_PTY_EXIT,
	MSG_SESSION_LIST,
	MSG_ATTACH_RESULT,
	MSG_STDIN,
	MSG_RESIZE,
	MSG_DETACH,
	MSG_ATTACH,
	API_DEFAULT_PORT,
	encodeFrame,
	FrameParser,
	type SessionInfo,
} from '../transport/protocol.ts';
import type { Action, SelectOption } from '../types/index.ts';
import { store } from './store.ts';
import { sanitizeReplayBuffer, normalizeLineEndings } from './sanitize.ts';

const { stdout } = process;
const apiBase = `http://localhost:${process.env.API_PORT || API_DEFAULT_PORT}`;

// ── Types ──────────────────────────────────────────────────────────

export type DisconnectCallback = () => void;

// ── State ──────────────────────────────────────────────────────────

let socket: ReturnType<typeof Bun.connect> extends Promise<infer T> ? T : never;
let connected = false;
const parser = new FrameParser();
const historyChunks: Buffer[] = [];

let onDisconnect: DisconnectCallback | null = null;
let historyReplayCallback: ((data: string) => void) | null = null;

// ── Public API ─────────────────────────────────────────────────────

export function setOnDisconnect(cb: DisconnectCallback | null) { onDisconnect = cb; }

export function setHistoryReplayCallback(cb: ((data: string) => void) | null) { historyReplayCallback = cb; }

export function isConnected() { return connected; }

export function sendRawFrame(frame: Buffer) {
	if (!connected) return;
	socket.write(frame);
}

export function sendStdin(data: Buffer | Uint8Array) {
	if (!connected) return;
	socket.write(encodeFrame(MSG_STDIN, Buffer.from(data)));
}

export function sendResize(cols: number, rows: number) {
	if (!connected) return;
	socket.write(encodeFrame(MSG_RESIZE, Buffer.from(JSON.stringify({ cols, rows }), 'utf8')));
}

export function attach(sessionId: string, tickerHeight: number = 0) {
	if (!connected) return;
	stdout.write('\x1B[2J\x1B[H');
	historyChunks.length = 0;
	const cols = stdout.columns || 80;
	const rows = (stdout.rows || 24) - tickerHeight;
	socket.write(
		encodeFrame(MSG_ATTACH, Buffer.from(JSON.stringify({ sessionId, cols, rows }), 'utf8')),
	);
	store.setState({ pendingAttachSessionId: sessionId });
}

export function switchToSession(sessionId: string, tickerHeight: number) {
	if (!connected) return;

	// Detach from current session (server-side only, no store update)
	socket.write(encodeFrame(MSG_DETACH));

	// Clear history state
	historyChunks.length = 0;

	// Clear screen within scroll region (DECSTBM constrains this)
	stdout.write('\x1B[2J\x1B[H');

	// Attach to new session with adjusted rows
	const cols = stdout.columns || 80;
	const rows = (stdout.rows || 24) - tickerHeight;
	socket.write(
		encodeFrame(MSG_ATTACH, Buffer.from(JSON.stringify({ sessionId, cols, rows }), 'utf8')),
	);

	// Deferred — actual attachedSessionId update happens in handleAttachResult
	store.setState({ pendingAttachSessionId: sessionId });
}

export function detach() {
	if (!connected) return;
	historyChunks.length = 0;
	socket.write(encodeFrame(MSG_DETACH));
	store.setState({ mode: 'switcher', attachedSessionId: null });
}

export async function fetchActions(): Promise<Action[]> {
	try {
		const res = await fetch(`${apiBase}/actions`);
		if (res.ok) {
			const actions = (await res.json()) as Action[];
			store.setState({ actions });
			return actions;
		}
	} catch {
		// API not available
	}
	return [];
}

export async function fetchParamOptions(
	actionName: string,
	paramName: string,
): Promise<SelectOption[]> {
	try {
		const res = await fetch(`${apiBase}/actions/${actionName}/options/${paramName}`);
		if (res.ok) {
			return (await res.json()) as SelectOption[];
		}
	} catch {
		// API not available
	}
	return [];
}

export async function executeAction(
	actionName: string,
	params: Record<string, unknown>,
): Promise<{ success: boolean; message: string }> {
	try {
		const res = await fetch(`${apiBase}/actions/${actionName}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		});
		const result = (await res.json()) as { success: boolean; data?: unknown; error?: string };
		if (result.success) {
			return { success: true, message: JSON.stringify(result.data, null, 2) };
		}
		return { success: false, message: result.error || 'Unknown error' };
	} catch (err) {
		return { success: false, message: String(err) };
	}
}

// ── Frame handlers ─────────────────────────────────────────────────

function handleSessionList(payload: Buffer) {
	try {
		const sessions = JSON.parse(payload.toString('utf8')) as SessionInfo[];
		store.setState({ sessions });
	} catch { /* ignore parse errors */ }
}

function handleHistory(payload: Buffer) {
	historyChunks.push(payload);
}

function handleHistoryEndFrame() {
	if (historyChunks.length === 0) return;

	const all = Buffer.concat(historyChunks);
	const historyStr = all.toString('utf8');
	const sanitized = sanitizeReplayBuffer(historyStr);
	const normalized = normalizeLineEndings(sanitized);
	const cleaned = normalized.replace(/^\x1B\[2J/, '').replace(/^\x1B\[H/, '');

	if (cleaned.length > 0) {
		stdout.write(cleaned);
		historyReplayCallback?.(cleaned);
	}

	historyChunks.length = 0;
	store.setState({ historyEndSignal: store.getState().historyEndSignal + 1 });
}

function handleLiveData(payload: Buffer) {
	store.setState({ liveDataPayload: payload });
}

function handleAttachResult(payload: Buffer) {
	try {
		const { success, sessionId, reason } = JSON.parse(payload.toString('utf8')) as {
			success: boolean;
			sessionId: string;
			reason?: string;
		};
		const state = store.getState();

		if (success) {
			store.setState({
				mode: 'attached',
				attachedSessionId: sessionId,
				pendingAttachSessionId: null,
				attachRejectedReason: null,
			});
		} else {
			// If we were already attached (switchToSession case), go back to switcher
			const newMode = state.mode === 'attached' ? 'switcher' : state.mode;
			const newAttached = state.mode === 'attached' ? null : state.attachedSessionId;
			store.setState({
				mode: newMode,
				attachedSessionId: newAttached,
				pendingAttachSessionId: null,
				attachRejectedReason: reason ?? 'Attach rejected',
			});
		}
	} catch { /* ignore */ }
}

function handlePtyExit(payload: Buffer) {
	try {
		const { sessionId } = JSON.parse(payload.toString('utf8'));
		const state = store.getState();
		if (state.mode === 'attached' && state.attachedSessionId === sessionId) {
			store.setState({ mode: 'switcher', attachedSessionId: null });
		}
	} catch { /* ignore */ }
}

// ── Connect ────────────────────────────────────────────────────────

export async function connect(): Promise<void> {
	socket = await Bun.connect({
		unix: ORCHESTRATOR_SOCKET_PATH,
		socket: {
			open() {
				connected = true;
			},

			data(_socket, data) {
				const frames = parser.push(Buffer.from(data));
				for (const frame of frames) {
					switch (frame.type) {
						case MSG_SESSION_LIST:
							handleSessionList(frame.payload);
							break;
						case MSG_HISTORY:
							handleHistory(frame.payload);
							break;
						case MSG_HISTORY_END:
							handleHistoryEndFrame();
							break;
						case MSG_ATTACH_RESULT:
							handleAttachResult(frame.payload);
							break;
						case MSG_LIVE_DATA:
							handleLiveData(frame.payload);
							break;
						case MSG_PTY_EXIT:
							handlePtyExit(frame.payload);
							break;
					}
				}
			},

			close() {
				connected = false;
				onDisconnect?.();
			},

			error(_socket, error) {
				console.error('\r\nSocket error:', error);
				connected = false;
				onDisconnect?.();
			},
		},
	});
}
