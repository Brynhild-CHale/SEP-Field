/**
 * App — root Ink component that routes based on current mode.
 *
 * Renders Switcher, Management Console, or transition effects.
 * The "attached" mode is handled externally by the orchestrator
 * (Ink is unmounted during raw PTY passthrough).
 */

import React from 'react';
import { Box } from 'ink';
import { useStore } from 'zustand';
import { store } from '../store.ts';
import { Switcher } from './switcher/Switcher.tsx';
import { ManagementConsole } from './management/ManagementConsole.tsx';
import { CRTWrapper } from './effects/CRTWrapper.tsx';
import { TransitionRenderer } from './effects/TransitionRenderer.tsx';
import { useTransitionSequence } from '../hooks/useTransitionSequence.ts';

export function App() {
	const mode = useStore(store, s => s.mode);

	// Drive the transition state machine
	useTransitionSequence();

	switch (mode) {
		case 'switcher':
			return <Switcher />;

		case 'management':
			return (
				<CRTWrapper>
					<ManagementConsole />
				</CRTWrapper>
			);

		case 'transition-to-mgmt':
		case 'transition-to-switcher':
			return <TransitionRenderer />;

		default:
			// 'attached' — should never render in Ink (unmounted)
			return null;
	}
}
