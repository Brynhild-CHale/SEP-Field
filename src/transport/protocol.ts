/**
 * Binary frame protocol for PTY streaming
 *
 * Frame format: [1 byte: type] [4 bytes: payload length (uint32 BE)] [N bytes: payload]
 *
 * Copied from demo with AgentState import updated to use shared types.
 */

import type { AgentState } from '../types/index.ts';

// --- Server -> Client message types ---
export const MSG_HISTORY = 0x01;
export const MSG_HISTORY_END = 0x02;
export const MSG_LIVE_DATA = 0x03;
export const MSG_PTY_EXIT = 0x04;
export const MSG_SESSION_LIST = 0x05;
export const MSG_ATTACH_RESULT = 0x06;

// --- Client -> Server message types ---
export const MSG_STDIN = 0x81;
export const MSG_RESIZE = 0x82;
export const MSG_DETACH = 0x83;
export const MSG_ATTACH = 0x84;
export const MSG_DEBUG = 0x85; // Client → Server: debug log message

export const HEADER_SIZE = 5; // 1 byte type + 4 bytes length
export const MAX_CHUNK_SIZE = 64 * 1024; // 64KB
export const MAX_HISTORY_SIZE = 10 * 1024 * 1024; // 10MB

export { ORCHESTRATOR_SOCKET_PATH, ORCHESTRATOR_PID_PATH, ORCHESTRATOR_LOG_PATH } from '../service/paths.ts';
export const DETACH_CHAR = 0x11; // Ctrl+q
export const NAV_TOGGLE_CHAR = 0x0E; // Ctrl+n
export const SCROLL_LEFT_CHAR = 0x08; // Ctrl+h
export const SCROLL_RIGHT_CHAR = 0x0C; // Ctrl+l
export const SCROLL_MODE_CHAR = 0x02; // Ctrl+b

export const API_DEFAULT_PORT = 7080;

export interface Frame {
	type: number;
	payload: Buffer;
}

// Re-export SessionInfo from types (protocol consumers expect it here)
export type { SessionInfo } from '../types/index.ts';
export type { AgentState };

/**
 * Encode a single frame: [type: 1 byte] [length: 4 bytes BE] [payload: N bytes]
 */
export function encodeFrame(type: number, payload?: Buffer | Uint8Array): Buffer {
	const payloadBuf = payload ? Buffer.from(payload) : Buffer.alloc(0);
	const frame = Buffer.alloc(HEADER_SIZE + payloadBuf.length);
	frame[0] = type;
	frame.writeUInt32BE(payloadBuf.length, 1);
	if (payloadBuf.length > 0) {
		payloadBuf.copy(frame, HEADER_SIZE);
	}
	return frame;
}

/**
 * Stateful frame parser that handles partial reads and coalesced writes.
 */
export class FrameParser {
	private buffer: Buffer = Buffer.alloc(0);

	push(data: Buffer | Uint8Array): Frame[] {
		this.buffer = Buffer.concat([this.buffer, Buffer.from(data)]);
		const frames: Frame[] = [];

		while (this.buffer.length >= HEADER_SIZE) {
			const payloadLength = this.buffer.readUInt32BE(1);

			if (this.buffer.length < HEADER_SIZE + payloadLength) {
				break;
			}

			const type = this.buffer[0];
			const payload = this.buffer.subarray(HEADER_SIZE, HEADER_SIZE + payloadLength);

			frames.push({ type, payload: Buffer.from(payload) });

			this.buffer = this.buffer.subarray(HEADER_SIZE + payloadLength);
		}

		return frames;
	}
}
