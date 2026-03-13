/**
 * PtyManager — PTY creation, sync output buffering, history ring buffer
 *
 * Extracted from orchestrator.ts. Replaces hardcoded sendLiveData() with
 * a DataCallback parameter for flexible output routing.
 */

import type { ManagedSession, DataCallback, Logger } from '../types/index.ts';
import { MAX_HISTORY_SIZE } from '../transport/protocol.ts';

// --- Synchronized output buffering constants ---
const SYNC_OUTPUT_START = '\x1B[?2026h';
const SYNC_OUTPUT_END = '\x1B[?2026l';
const FLUSH_DELAY_MS = 8;
const SYNC_TIMEOUT_MS = 100;

// --- ONLCR flag ---
const ONLCR_FLAG = 0x0002;

export class PtyManager {
	private logger: Logger;
	private dataCallback: DataCallback | null = null;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	/** Set the callback that receives PTY output data for routing to clients. */
	setDataCallback(callback: DataCallback): void {
		this.dataCallback = callback;
	}

	/** Append data to a session's circular history buffer. */
	appendHistory(session: ManagedSession, buf: Buffer): void {
		session.outputHistory.push(buf);
		session.historySize += buf.length;

		while (session.historySize > MAX_HISTORY_SIZE && session.outputHistory.length > 0) {
			const removed = session.outputHistory.shift();
			if (removed) {
				session.historySize -= removed.length;
			}
		}
	}

	/**
	 * Create a Bun.Terminal with data callback wired to the session.
	 * Returns the terminal instance.
	 */
	createTerminal(session: ManagedSession, cols: number, rows: number): InstanceType<typeof Bun.Terminal> {
		const terminal = new Bun.Terminal({
			cols,
			rows,
			data: (_terminal, data) => {
				const rawBuf = Buffer.from(data);
				this.appendHistory(session, rawBuf);

				const str = typeof data === 'string'
					? data
					: session.decoder.decode(data, { stream: true });

				// Feed PTY output to xterm headless terminal for state detection
				session.xtermTerminal.write(str);

				session.dataBuffer += str;
				this.processBuffer(session);
			},
		});

		terminal.setRawMode(true);
		terminal.outputFlags = terminal.outputFlags & ~ONLCR_FLAG;

		return terminal;
	}

	/** Send live data via the data callback. */
	private sendLiveData(session: ManagedSession, data: string): void {
		if (!this.dataCallback || data.length === 0) return;
		this.dataCallback(session.id, data);
	}

	/** Flush any buffered data for a session. */
	flushBuffer(session: ManagedSession): void {
		if (session.dataBuffer.length === 0) return;
		const buffered = session.dataBuffer;
		session.dataBuffer = '';
		this.sendLiveData(session, buffered);
	}

	/** Process the session data buffer, handling sync output mode. */
	private processBuffer(session: ManagedSession): void {
		let madeProgress = true;
		while (madeProgress) {
			madeProgress = false;

			if (session.syncOutputMode) {
				const endIndex = session.dataBuffer.indexOf(SYNC_OUTPUT_END);
				if (endIndex !== -1) {
					const endOffset = endIndex + SYNC_OUTPUT_END.length;
					const frame = session.dataBuffer.slice(0, endOffset);
					session.dataBuffer = session.dataBuffer.slice(endOffset);
					session.syncOutputMode = false;
					if (session.flushTimer) {
						clearTimeout(session.flushTimer);
						session.flushTimer = null;
					}
					this.sendLiveData(session, frame);
					madeProgress = true;
					continue;
				}

				if (session.flushTimer) {
					clearTimeout(session.flushTimer);
				}
				session.flushTimer = setTimeout(() => {
					session.flushTimer = null;
					session.syncOutputMode = false;
					this.flushBuffer(session);
				}, SYNC_TIMEOUT_MS);
				return;
			}

			const startIndex = session.dataBuffer.indexOf(SYNC_OUTPUT_START);
			if (startIndex !== -1) {
				if (startIndex > 0) {
					const leading = session.dataBuffer.slice(0, startIndex);
					session.dataBuffer = session.dataBuffer.slice(startIndex);
					this.sendLiveData(session, leading);
					madeProgress = true;
					continue;
				}

				session.syncOutputMode = true;
				if (session.flushTimer) {
					clearTimeout(session.flushTimer);
					session.flushTimer = null;
				}
				madeProgress = true;
				continue;
			}

			if (session.flushTimer) {
				clearTimeout(session.flushTimer);
			}
			session.flushTimer = setTimeout(() => {
				session.flushTimer = null;
				this.flushBuffer(session);
			}, FLUSH_DELAY_MS);
		}
	}
}
