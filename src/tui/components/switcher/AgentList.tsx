import React from 'react';
import { Text, Box } from 'ink';
import type { SessionInfo } from '../../../types/index.ts';
import { AgentRow } from './AgentRow.tsx';

interface AgentListProps {
	sessions: SessionInfo[];
	selectedIndex: number;
	width: number;
}

export function AgentList({ sessions, selectedIndex, width }: AgentListProps) {
	const innerWidth = width - 2;

	if (sessions.length === 0) {
		const msg = 'No agents running';
		const padding = ' '.repeat(Math.max(0, innerWidth - msg.length - 2));
		return (
			<Box flexDirection="column">
				<Text>│{' '.repeat(innerWidth)}│</Text>
				<Text>│ <Text dimColor>{msg}</Text>{padding} │</Text>
				<Text>│{' '.repeat(innerWidth)}│</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text>│{' '.repeat(innerWidth)}│</Text>
			{sessions.map((s, i) => (
				<AgentRow key={s.id} session={s} selected={i === selectedIndex} width={width} />
			))}
			<Text>│{' '.repeat(innerWidth)}│</Text>
		</Box>
	);
}
