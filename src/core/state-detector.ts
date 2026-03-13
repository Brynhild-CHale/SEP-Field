/**
 * State Detector + State Poller
 *
 * Pure detection functions (from stateDetector.ts) plus a StatePoller class
 * that wraps the polling + debounce logic from orchestrator.ts.
 */

import type { Terminal, IBufferLine } from '@xterm/headless';
import type { AgentState, ManagedSession, Logger } from '../types/index.ts';

// --- Constants ---
const STATE_POLL_INTERVAL_MS = 100;
const STATE_PERSISTENCE_MS = 200;

// --- Screen capture ---

function lineToString(line: IBufferLine | undefined, cols: number): string {
	if (!line) return '';
	return line.translateToString(true, 0, cols);
}

/**
 * Gets the terminal content as a string, reading visible viewport lines.
 * Handles both normal and alternate screen buffers correctly.
 */
export function getTerminalScreenContent(
	terminal: Terminal,
	maxLines?: number,
): string {
	const buffer = terminal.buffer.active;
	const lines: string[] = [];

	const baseY = buffer.baseY;

	for (let y = 0; y < terminal.rows; y++) {
		const line = buffer.getLine(baseY + y);
		lines.push(lineToString(line, terminal.cols));
	}

	// Trim empty lines from the bottom
	while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
		lines.pop();
	}

	if (maxLines !== undefined && lines.length > maxLines) {
		return lines.slice(-maxLines).join('\n');
	}

	return lines.join('\n');
}

// --- Claude state detection ---

/**
 * Detects Claude Code's semantic state by analyzing terminal output.
 *
 * Detection priority:
 * 1. Search prompt -> idle
 * 2. ctrl+r toggle -> maintain current state
 * 3. "do you want"/"would you like" + yes/cursor -> waiting
 * 4. "esc to cancel" -> waiting
 * 5. "esc to interrupt" / "ctrl+c to interrupt" -> busy
 * 6. Default -> idle
 */
export function detectClaudeState(
	terminal: Terminal,
	currentState: AgentState,
): AgentState {
	const extendedContent = getTerminalScreenContent(terminal, 200);
	if (extendedContent.includes('\u2315 Search\u2026')) {
		return 'idle';
	}

	const content = getTerminalScreenContent(terminal, 30);
	const lowerContent = content.toLowerCase();

	if (lowerContent.includes('ctrl+r to toggle')) {
		return currentState;
	}

	if (
		/(?:do you want|would you like).+\n+[\s\S]*?(?:yes|\u276F)/.test(lowerContent)
	) {
		return 'waiting';
	}

	if (lowerContent.includes('esc to cancel')) {
		return 'waiting';
	}

	if (
		lowerContent.includes('esc to interrupt') ||
		lowerContent.includes('ctrl+c to interrupt')
	) {
		return 'busy';
	}

	return 'idle';
}

// --- State Poller ---

export type StateChangeCallback = (sessionId: string, prev: AgentState, next: AgentState) => void;

export class StatePoller {
	private interval: ReturnType<typeof setInterval> | null = null;
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	/** Start polling a session's terminal for state changes. */
	start(session: ManagedSession, onStateChange: StateChangeCallback, intervalMs?: number): void {
		this.stop();

		this.interval = setInterval(() => {
			if (session.exited) return;

			const detected = detectClaudeState(session.xtermTerminal, session.agentState);

			if (detected !== session.agentState) {
				// Debounce: require persistence before confirming state change
				if (session.pendingAgentState === detected) {
					const elapsed = Date.now() - session.pendingAgentStateStart;
					if (elapsed >= STATE_PERSISTENCE_MS) {
						const prev = session.agentState;
						session.agentState = detected;
						session.pendingAgentState = null;
						this.logger.log(`Agent ${session.id} state: ${prev} -> ${detected}`);
						onStateChange(session.id, prev, detected);
					}
				} else {
					session.pendingAgentState = detected;
					session.pendingAgentStateStart = Date.now();
				}
			} else {
				session.pendingAgentState = null;
			}
		}, intervalMs ?? STATE_POLL_INTERVAL_MS);

		// Store interval on session for cleanup
		session.stateCheckInterval = this.interval;
	}

	/** Stop polling. */
	stop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}
}
