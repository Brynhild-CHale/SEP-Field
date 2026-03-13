/**
 * Terminal sanitization utilities.
 *
 * Extracted from the original raw-ANSI client for reuse
 * in the Ink-based TUI and raw PTY passthrough.
 */

const { stdout, stdin } = process;

export function stripOscColorSequences(input: string): string {
	return input.replace(/\x1B\](?:10|11);[^\x07\x1B]*(?:\x07|\x1B\\)/g, '');
}

export function sanitizeReplayBuffer(input: string): string {
	return stripOscColorSequences(input)
		.replace(/\x1B\[>4;?\d*m/g, '')       // modifyOtherKeys
		.replace(/\x1B\[>[0-9;]*u/g, '')      // kitty keyboard protocol
		.replace(/\x1B\[\?1004[hl]/g, '')     // focus tracking
		.replace(/\x1B\[\?2004[hl]/g, '');    // bracketed paste
}

export function normalizeLineEndings(input: string): string {
	let normalized = '';
	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		if (char === '\n') {
			const prev = i > 0 ? input[i - 1] : '';
			if (prev !== '\r') {
				normalized += '\r';
			}
		}
		normalized += char;
	}
	return normalized;
}

export function restoreTerminal(): void {
	stdout.write('\x1B[<u');       // Disable kitty keyboard
	stdout.write('\x1B[>4m');      // Disable modifyOtherKeys
	stdout.write('\x1B[?1004l');   // Disable focus reporting
	stdout.write('\x1B[?2004l');   // Disable bracketed paste
	stdout.write('\x1B[?7h');      // Re-enable auto-wrap
	stdout.write('\x1B[?25h');     // Show cursor

	if (stdin.isTTY) {
		stdin.setRawMode(false);
	}
}
