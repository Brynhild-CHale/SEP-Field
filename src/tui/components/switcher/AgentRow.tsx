import React from 'react';
import { Text } from 'ink';
import type { SessionInfo } from '../../../types/index.ts';
import { getStateDisplay } from '../../agent-state.ts';

interface AgentRowProps {
	session: SessionInfo;
	selected: boolean;
	width: number;
}

export function AgentRow({ session, selected, width }: AgentRowProps) {
	const { label, color } = getStateDisplay(session);
	const innerWidth = width - 2;
	const indicator = selected ? '●' : ' ';
	const name = session.name;
	const isLocked = session.locked;
	// Layout: "  ● name          state   "
	const stateCol = isLocked ? `🔒 ${label}` : label;
	const stateColLen = isLocked ? label.length + 3 : label.length;
	const nameCol = `  ${indicator} ${name}`;
	const gap = Math.max(2, innerWidth - nameCol.length - stateColLen - 2);

	const dimColor = isLocked ? 'gray' : undefined;

	return (
		<Text color={dimColor}>
			│
			{selected ? <Text bold>{nameCol}</Text> : <Text>{nameCol}</Text>}
			{' '.repeat(gap)}
			<Text color={isLocked ? 'gray' : color}>{stateCol}</Text>
			{' '.repeat(Math.max(0, innerWidth - nameCol.length - gap - stateColLen))}
			│
		</Text>
	);
}
