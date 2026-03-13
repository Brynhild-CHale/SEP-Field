/**
 * StreamServer — Unix socket server for PTY streaming
 *
 * Multi-client model with per-session locking. Each connected TUI client
 * gets its own ClientState. A session lock table ensures only one client
 * can attach to a given session at a time.
 */

import { existsSync, unlinkSync } from 'fs';
import type { SEPSysInterface, Logger, ManagedSession, SessionInfo } from '../types/index.ts';
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
	MSG_DEBUG,
	encodeFrame,
	FrameParser,
} from './protocol.ts';
import { checkSocketAlive } from '../service/liveness.ts';

const HISTORY_CHUNK_SIZE = 4096;

interface ClientState {
	id: number;
	label: string;
	socket: unknown;
	writer: { write(data: Buffer | Uint8Array): void; close(): void };
	parser: FrameParser;
	attachedSessionId: string | null;
	writeQueue: Buffer[];
	writePaused: boolean;
}

export class StreamServer {
	private logger: Logger;
	private sepSys: SEPSysInterface;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private server: any = null;

	private nextClientId = 1;
	private clients = new Map<number, ClientState>();
	private sessionLocks = new Map<string, number>(); // sessionId -> clientId

	constructor(sepSys: SEPSysInterface, logger: Logger) {
		this.sepSys = sepSys;
		this.logger = logger;

		// Wire data handler — routes PTY output to the lock holder
		sepSys.setDataHandler((sessionId: string, data: string) => {
			if (data.length === 0) return;
			const lockHolder = this.sessionLocks.get(sessionId);
			if (lockHolder === undefined) return;
			const client = this.clients.get(lockHolder);
			if (!client) return;
			client.writer.write(encodeFrame(MSG_LIVE_DATA, Buffer.from(data, 'utf8')));
		});

		// Wire event handler — broadcasts session list on changes, notifies on exit
		sepSys.onEvent((event) => {
			switch (event.type) {
				case 'session-list-changed':
					this.broadcastSessionList();
					break;
				case 'session-exited': {
					const lockHolder = this.sessionLocks.get(event.sessionId);
					if (lockHolder !== undefined) {
						const client = this.clients.get(lockHolder);
						if (client) {
							const exitCode = (event.data as { exitCode: number })?.exitCode;
							const payload = Buffer.from(JSON.stringify({ sessionId: event.sessionId, exitCode }), 'utf8');
							client.writer.write(encodeFrame(MSG_PTY_EXIT, payload));
							client.attachedSessionId = null;
						}
						this.sessionLocks.delete(event.sessionId);
						this.broadcastSessionList();
					}
					break;
				}
			}
		});
	}

	/** Start listening on the Unix socket. */
	async start(): Promise<void> {
		// Probe existing socket — if something is listening, refuse to start
		if (existsSync(ORCHESTRATOR_SOCKET_PATH)) {
			const alive = await checkSocketAlive(ORCHESTRATOR_SOCKET_PATH);
			if (alive) {
				this.logger.error('Another daemon is already listening on ' + ORCHESTRATOR_SOCKET_PATH);
				process.exit(1);
			}
			this.logger.log('Removing stale socket');
			unlinkSync(ORCHESTRATOR_SOCKET_PATH);
		}

		this.server = Bun.listen({
			unix: ORCHESTRATOR_SOCKET_PATH,
			socket: {
				open: (socket: unknown) => {
					const clientId = this.nextClientId++;
					const label = `client-${clientId}`;
					const client: ClientState = {
						id: clientId,
						label,
						socket,
						writer: {
							write: (data: Buffer | Uint8Array) => this.clientWrite(clientId, data),
							close: () => (socket as { end(): void }).end(),
						},
						parser: new FrameParser(),
						attachedSessionId: null,
						writeQueue: [],
						writePaused: false,
					};
					this.clients.set(clientId, client);
					this.logger.log(`${label} connected (${this.clients.size} total)`);
					this.sendSessionListTo(client);
				},

				drain: (socket: unknown) => {
					const client = this.findClientBySocket(socket);
					if (client) this.drainWriteQueue(client.id);
				},

				data: (socket: unknown, data: Buffer | Uint8Array) => {
					const client = this.findClientBySocket(socket);
					if (!client) return;

					const frames = client.parser.push(Buffer.from(data));
					for (const frame of frames) {
						this.handleClientFrame(client, frame.type, frame.payload);
					}
				},

				close: (socket: unknown) => {
					const client = this.findClientBySocket(socket);
					if (!client) return;
					this.logger.log(`${client.label} disconnected`);
					this.removeClient(client);
				},

				error: (socket: unknown, error: Error) => {
					const client = this.findClientBySocket(socket);
					if (!client) {
						this.logger.error(`Socket error (unknown client): ${error}`);
						return;
					}
					this.logger.error(`Socket error (${client.label}): ${error}`);
					this.removeClient(client);
				},
			},
		});

		this.logger.log(`Listening on ${ORCHESTRATOR_SOCKET_PATH}`);
	}

	/** Stop the server and clean up. */
	stop(): void {
		for (const client of this.clients.values()) {
			client.writer.close();
		}
		this.clients.clear();
		this.sessionLocks.clear();

		try {
			if (this.server) {
				this.server.stop();
			}
		} catch { /* ignore */ }
		try {
			if (existsSync(ORCHESTRATOR_SOCKET_PATH)) {
				unlinkSync(ORCHESTRATOR_SOCKET_PATH);
			}
		} catch { /* ignore */ }
	}

	// ── Client management ──────────────────────────────────────────────

	private findClientBySocket(socket: unknown): ClientState | undefined {
		for (const client of this.clients.values()) {
			if (client.socket === socket) return client;
		}
		return undefined;
	}

	private removeClient(client: ClientState): void {
		// Release any session lock held by this client
		for (const [sessionId, holderId] of this.sessionLocks) {
			if (holderId === client.id) {
				this.sessionLocks.delete(sessionId);
			}
		}
		this.clients.delete(client.id);

		// Broadcast updated session list (lock state changed) to remaining clients
		if (this.clients.size > 0) {
			this.broadcastSessionList();
		}
	}

	// ── Write queue / backpressure (per-client) ────────────────────────

	private clientWrite(clientId: number, data: Buffer | Uint8Array): void {
		const client = this.clients.get(clientId);
		if (!client) return;

		const buf = Buffer.from(data);
		if (client.writePaused || client.writeQueue.length > 0) {
			client.writeQueue.push(buf);
			return;
		}
		const sock = client.socket as { write(data: Buffer): number };
		const written = sock.write(buf);
		if (written < buf.length) {
			client.writeQueue.unshift(buf.subarray(written));
			client.writePaused = true;
		}
	}

	private drainWriteQueue(clientId: number): void {
		const client = this.clients.get(clientId);
		if (!client) return;

		const sock = client.socket as { write(data: Buffer): number };
		client.writePaused = false;
		while (client.writeQueue.length > 0) {
			const buf = client.writeQueue[0];
			const written = sock.write(buf);
			if (written < buf.length) {
				client.writeQueue[0] = buf.subarray(written);
				client.writePaused = true;
				return;
			}
			client.writeQueue.shift();
		}
	}

	// ── Session list ───────────────────────────────────────────────────

	private buildSessionInfoList(): SessionInfo[] {
		const list = this.sepSys.getSessionInfoList();
		for (const info of list) {
			info.locked = this.sessionLocks.has(info.id);
		}
		return list;
	}

	private broadcastSessionList(): void {
		if (this.clients.size === 0) return;
		const list = this.buildSessionInfoList();
		const frame = encodeFrame(MSG_SESSION_LIST, Buffer.from(JSON.stringify(list), 'utf8'));
		for (const client of this.clients.values()) {
			client.writer.write(frame);
		}
	}

	private sendSessionListTo(client: ClientState): void {
		const list = this.buildSessionInfoList();
		client.writer.write(
			encodeFrame(MSG_SESSION_LIST, Buffer.from(JSON.stringify(list), 'utf8')),
		);
	}

	// ── History ────────────────────────────────────────────────────────

	private sendHistoryTo(client: ClientState, session: ManagedSession): void {
		const all = Buffer.concat(session.outputHistory);
		let offset = 0;

		while (offset < all.length) {
			const end = Math.min(offset + HISTORY_CHUNK_SIZE, all.length);
			const chunk = all.subarray(offset, end);
			client.writer.write(encodeFrame(MSG_HISTORY, chunk));
			offset = end;
		}

		client.writer.write(encodeFrame(MSG_HISTORY_END));
	}

	// ── Frame dispatch ─────────────────────────────────────────────────

	private handleClientFrame(client: ClientState, type: number, payload: Buffer): void {
		switch (type) {
			case MSG_ATTACH: {
				try {
					const { sessionId, cols, rows } = JSON.parse(payload.toString('utf8'));
					const session = this.sepSys.getSession(sessionId);
					if (!session) {
						this.logger.log(`Attach requested for unknown session: ${sessionId}`);
						this.sendAttachResult(client, false, sessionId, 'Session not found');
						return;
					}
					if (session.starting) {
						this.logger.log(`Attach rejected: session ${sessionId} is still starting`);
						this.sendAttachResult(client, false, sessionId, 'Session is still starting');
						return;
					}

					// Check lock table
					const existingLock = this.sessionLocks.get(sessionId);
					if (existingLock !== undefined && existingLock !== client.id) {
						const holder = this.clients.get(existingLock);
						const reason = `Session is attached by ${holder?.label ?? 'another client'}`;
						this.logger.log(`Attach rejected for ${client.label}: ${reason}`);
						this.sendAttachResult(client, false, sessionId, reason);
						return;
					}

					// Acquire lock
					this.sessionLocks.set(sessionId, client.id);
					client.attachedSessionId = sessionId;
					this.logger.log(`${client.label} attached to ${sessionId}`);

					// Send success result
					this.sendAttachResult(client, true, sessionId);

					// Resize PTY and xterm terminal to client dimensions BEFORE sending history
					if (!session.exited && session.terminal && typeof cols === 'number' && typeof rows === 'number') {
						session.terminal.resize(cols, rows);
						session.xtermTerminal.resize(cols, rows);
						this.logger.log(`Resized ${sessionId} to ${cols}x${rows}`);
					}

					this.sendHistoryTo(client, session);

					// Broadcast so all clients see updated lock state
					this.broadcastSessionList();
				} catch {
					this.logger.error('Invalid ATTACH payload');
				}
				break;
			}

			case MSG_STDIN: {
				if (!client.attachedSessionId) return;
				const session = this.sepSys.getSession(client.attachedSessionId);
				if (session && !session.exited && session.terminal) {
					session.terminal.write(payload);
				}
				break;
			}

			case MSG_RESIZE: {
				if (!client.attachedSessionId) return;
				const session = this.sepSys.getSession(client.attachedSessionId);
				if (session && !session.exited && session.terminal) {
					try {
						const { cols, rows } = JSON.parse(payload.toString('utf8'));
						if (typeof cols === 'number' && typeof rows === 'number') {
							session.terminal.resize(cols, rows);
							session.xtermTerminal.resize(cols, rows);
							this.logger.log(`Resized ${client.attachedSessionId} to ${cols}x${rows}`);
						}
					} catch {
						this.logger.error('Invalid RESIZE payload');
					}
				}
				break;
			}

			case MSG_DETACH: {
				this.logger.log(`${client.label} detached from ${client.attachedSessionId}`);
				if (client.attachedSessionId) {
					this.sessionLocks.delete(client.attachedSessionId);
				}
				client.attachedSessionId = null;
				this.broadcastSessionList();
				break;
			}

			case MSG_DEBUG:
				this.logger.log(`[${client.label}] ${payload.toString('utf8')}`);
				break;

			default:
				this.logger.error(`Unknown client message type: 0x${type.toString(16)}`);
		}
	}

	private sendAttachResult(client: ClientState, success: boolean, sessionId: string, reason?: string): void {
		const payload: { success: boolean; sessionId: string; reason?: string } = { success, sessionId };
		if (reason) payload.reason = reason;
		client.writer.write(
			encodeFrame(MSG_ATTACH_RESULT, Buffer.from(JSON.stringify(payload), 'utf8')),
		);
	}
}
