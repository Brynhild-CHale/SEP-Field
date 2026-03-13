/**
 * Keybinding detection for attached mode.
 *
 * Handles both raw control characters and CSI u / modifyOtherKeys sequences
 * emitted by modern terminal apps with kitty keyboard protocol enabled.
 */

import {
	DETACH_CHAR,
	NAV_TOGGLE_CHAR,
	SCROLL_LEFT_CHAR,
	SCROLL_RIGHT_CHAR,
	SCROLL_MODE_CHAR,
} from '../transport/protocol.ts';

export type TickerAction = 'detach' | 'nav-toggle' | 'scroll-left' | 'scroll-right' | 'scroll-mode';

export interface KeyMatch {
	action: TickerAction;
	offset: number;  // start position in buffer
	length: number;  // bytes consumed
}

// Map: Ctrl+key keycode → action
// Keycodes are the Unicode codepoints of the base character
const CSI_U_BINDINGS: Record<number, TickerAction> = {
	113: 'detach',       // q → Ctrl+q
	110: 'nav-toggle',   // n → Ctrl+n
	104: 'scroll-left',  // h → Ctrl+h
	108: 'scroll-right', // l → Ctrl+l
	98: 'scroll-mode',   // b → Ctrl+b
};

// Map: raw byte → action
const RAW_BINDINGS: Record<number, TickerAction> = {
	[DETACH_CHAR]: 'detach',
	[NAV_TOGGLE_CHAR]: 'nav-toggle',
	[SCROLL_LEFT_CHAR]: 'scroll-left',
	[SCROLL_RIGHT_CHAR]: 'scroll-right',
	[SCROLL_MODE_CHAR]: 'scroll-mode',
};

/**
 * Try to match a CSI u sequence at position `i` in the buffer.
 * CSI u format: \x1B [ <keycode> ; <modifiers> u
 * We match Ctrl modifier (modifier 5) for our bound keys.
 *
 * Also handles modifyOtherKeys format: \x1B [ 27 ; <mod> ; <keycode> ~
 */
export function matchCsiU(data: Buffer, i: number): KeyMatch | null {
	// Need at least \x1B [ ... ; 5 u — minimum 6 bytes (e.g. \x1B[113;5u = 8)
	if (data[i] !== 0x1B || i + 3 >= data.length || data[i + 1] !== 0x5B) return null;

	// Parse from position i+2 to find the sequence
	let j = i + 2;
	const end = Math.min(data.length, i + 20); // CSI sequences are short

	// Collect the full CSI parameter string until we hit a final byte
	let paramStr = '';
	while (j < end) {
		const b = data[j];
		// Parameter bytes are 0x30-0x3F (digits, semicolons, etc.)
		if (b >= 0x30 && b <= 0x3F) {
			paramStr += String.fromCharCode(b);
			j++;
		} else {
			break;
		}
	}

	if (j >= end) return null;
	const finalByte = data[j];

	// CSI u format: params end with 'u' (0x75)
	if (finalByte === 0x75) {
		const parts = paramStr.split(';');
		const keycode = parseInt(parts[0], 10);
		// Modifier field: 5 = Ctrl (1 + 4)
		const modifiers = parts.length > 1 ? parseInt(parts[1], 10) : 1;
		if (modifiers === 5 && CSI_U_BINDINGS[keycode]) {
			return { action: CSI_U_BINDINGS[keycode], offset: i, length: j - i + 1 };
		}
		return null;
	}

	// modifyOtherKeys format: \x1B[27;5;113~ — final byte '~' (0x7E)
	if (finalByte === 0x7E) {
		const parts = paramStr.split(';');
		if (parts[0] === '27' && parts.length >= 3) {
			const modifiers = parseInt(parts[1], 10);
			const keycode = parseInt(parts[2], 10);
			if (modifiers === 5 && CSI_U_BINDINGS[keycode]) {
				return { action: CSI_U_BINDINGS[keycode], offset: i, length: j - i + 1 };
			}
		}
		return null;
	}

	return null;
}

/**
 * Find the next keybinding match in the buffer, checking both raw control
 * chars and CSI u / modifyOtherKeys sequences.
 */
export function findNextKeybinding(data: Buffer, start: number): KeyMatch | null {
	for (let i = start; i < data.length; i++) {
		const byte = data[i];

		// Check raw control chars
		if (RAW_BINDINGS[byte]) {
			return { action: RAW_BINDINGS[byte], offset: i, length: 1 };
		}

		// Check CSI u / modifyOtherKeys sequences
		if (byte === 0x1B) {
			const match = matchCsiU(data, i);
			if (match) return match;
		}
	}
	return null;
}
