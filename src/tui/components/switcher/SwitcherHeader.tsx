import React from 'react';
import { Text } from 'ink';
import { useStore } from 'zustand';
import { store } from '../../store.ts';

interface SwitcherHeaderProps {
	width: number;
}

export function SwitcherHeader({ width }: SwitcherHeaderProps) {
	const updateAvailable = useStore(store, s => s.updateAvailable);
	const updateCommitCount = useStore(store, s => s.updateCommitCount);

	const innerWidth = width - 2;
	const hLine = '─'.repeat(innerWidth);
	const title = 'SEP-Field';

	if (updateAvailable) {
		const badge = `update available (${updateCommitCount}) — sep update`;
		const gap = Math.max(1, innerWidth - title.length - badge.length - 2);
		const spacer = ' '.repeat(gap);

		return (
			<>
				<Text>┌{hLine}┐</Text>
				<Text>│ <Text bold>{title}</Text>{spacer}<Text color="yellow">{badge}</Text> │</Text>
				<Text>├{hLine}┤</Text>
			</>
		);
	}

	const padding = ' '.repeat(Math.max(0, innerWidth - title.length - 2));

	return (
		<>
			<Text>┌{hLine}┐</Text>
			<Text>│ <Text bold>{title}</Text>{padding} │</Text>
			<Text>├{hLine}┤</Text>
		</>
	);
}
