/**
 * Shared agent state display utilities.
 *
 * Used by both Ink components (AgentRow) and raw ANSI rendering (ticker).
 */

import type { SessionInfo } from '../types/index.ts';

export interface StateDisplay {
	dot: string;
	label: string;
	color: string;
}

export function getStateDisplay(s: SessionInfo): StateDisplay {
	if (s.status === 'starting') {
		return { dot: '⋯', label: 'starting', color: 'yellow' };
	}
	if (s.status === 'running' && s.sessionType === 'shell') {
		return { dot: '▸', label: 'shell', color: 'cyan' };
	}
	if (s.status === 'running') {
		switch (s.agentState) {
			case 'busy':
				return { dot: '●', label: 'running', color: 'yellow' };
			case 'waiting':
				return { dot: '◐', label: 'waiting', color: 'cyan' };
			case 'idle':
				return { dot: '○', label: 'idle', color: 'green' };
			case 'complete':
				return { dot: '✓', label: 'done', color: 'green' };
		}
	}
	if (s.exitCode === 0) {
		return { dot: '✓', label: 'done', color: 'green' };
	}
	return { dot: '✗', label: `failed(${s.exitCode ?? '?'})`, color: 'red' };
}

const ANSI_COLORS: Record<string, string> = {
	yellow: '\x1B[33m',
	cyan: '\x1B[36m',
	green: '\x1B[32m',
	red: '\x1B[31m',
	white: '\x1B[37m',
};

export function colorToAnsi(color: string): string {
	return ANSI_COLORS[color] ?? '\x1B[37m';
}
