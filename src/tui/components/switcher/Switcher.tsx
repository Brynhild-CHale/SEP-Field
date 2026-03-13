import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from 'zustand';
import { store } from '../../store.ts';
import { attachSession } from '../../store-actions.ts';
import { SwitcherHeader } from './SwitcherHeader.tsx';
import { SwitcherFooter } from './SwitcherFooter.tsx';
import { AgentList } from './AgentList.tsx';
import { useTerminalSize } from '../../hooks/useTerminalSize.ts';

export function Switcher() {
	const { cols } = useTerminalSize();
	const WIDTH = Math.min(cols - 2, 64);

	const sessions = useStore(store, s => s.sessions);
	const selectedIndex = useStore(store, s => s.switcherIndex);
	const rejectedReason = useStore(store, s => s.attachRejectedReason);

	// Auto-clear rejection message after 3 seconds
	useEffect(() => {
		if (!rejectedReason) return;
		const timer = setTimeout(() => {
			store.setState({ attachRejectedReason: null });
		}, 3000);
		return () => clearTimeout(timer);
	}, [rejectedReason]);

	useInput((input, key) => {
		if (input === 'q') {
			process.exit(0);
		}

		if (input === '?') {
			store.setState({ mode: 'transition-to-mgmt', transitionPhase: 'pinch', transitionProgress: 0 });
			return;
		}

		if (key.upArrow || input === 'k') {
			const next = Math.max(0, selectedIndex - 1);
			store.setState({ switcherIndex: next });
			return;
		}

		if (key.downArrow || input === 'j') {
			const next = Math.min(sessions.length - 1, selectedIndex + 1);
			store.setState({ switcherIndex: next });
			return;
		}

		if (key.return) {
			const session = sessions[selectedIndex];
			if (session && session.status !== 'starting' && !session.locked) {
				attachSession(session.id);
			}
			return;
		}
	});

	return (
		<Box flexDirection="column">
			<SwitcherHeader width={WIDTH} />
			<AgentList sessions={sessions} selectedIndex={selectedIndex} width={WIDTH} />
			<SwitcherFooter width={WIDTH} />
			{rejectedReason && (
				<Text color="red"> {rejectedReason}</Text>
			)}
		</Box>
	);
}
