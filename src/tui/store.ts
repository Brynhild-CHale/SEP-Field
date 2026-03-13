/**
 * Zustand store — lives outside React so state persists across Ink mount/unmount cycles.
 */

import { createStore } from 'zustand/vanilla';
import type { SessionInfo, Action, SelectOption } from '../types/index.ts';

export type AppMode =
	| 'switcher'
	| 'management'
	| 'transition-to-mgmt'
	| 'transition-to-switcher'
	| 'attached';

export type TransitionPhase =
	| 'idle'
	| 'pinch'
	| 'line-hold'
	| 'line-collapse'
	| 'darkness'
	| 'cursor-blink'
	| 'frame-draw'
	| 'false-start'
	| 'scan'
	| 'content-fill'
	| 'stabilize'
	// Management → Switcher (fast)
	| 'collapse'
	| 'black';

export interface AppState {
	mode: AppMode;
	sessions: SessionInfo[];
	actions: Action[];
	switcherIndex: number;
	attachedSessionId: string | null;

	// Management Console
	mgmtSelectedIndex: number;
	mgmtFocusPanel: 'nav' | 'detail';
	mgmtActionResult: { success: boolean; message: string } | null;
	mgmtParamValues: Record<string, string>;
	mgmtFocusedFieldIndex: number;
	mgmtExecuting: boolean;
	mgmtSelectOptions: Record<string, SelectOption[]>;

	// Transitions
	transitionPhase: TransitionPhase;
	transitionProgress: number;

	// CRT effects
	effectsEnabled: boolean;
	quoteIndex: number;

	daemonStartTime: number;

	// Attach flow
	pendingAttachSessionId: string | null;
	attachRejectedReason: string | null;

	// Attached-mode signals (written by connection.ts, consumed by attached-mode.ts)
	liveDataPayload: Buffer | null;
	historyEndSignal: number;
}

export const store = createStore<AppState>()(() => ({
	mode: 'switcher',
	sessions: [],
	actions: [],
	switcherIndex: 0,
	attachedSessionId: null,

	mgmtSelectedIndex: 0,
	mgmtFocusPanel: 'nav',
	mgmtActionResult: null,
	mgmtParamValues: {},
	mgmtFocusedFieldIndex: 0,
	mgmtExecuting: false,
	mgmtSelectOptions: {},

	transitionPhase: 'idle',
	transitionProgress: 0,

	effectsEnabled: true,
	quoteIndex: Math.floor(Math.random() * 8),

	daemonStartTime: Date.now(),

	pendingAttachSessionId: null,
	attachRejectedReason: null,

	liveDataPayload: null,
	historyEndSignal: 0,
}));

// Convenience typed selectors for use inside React components via `useStore`
export type Store = typeof store;
