import React from 'react';
import { Text } from 'ink';

interface SwitcherHeaderProps {
	width: number;
}

export function SwitcherHeader({ width }: SwitcherHeaderProps) {
	const innerWidth = width - 2;
	const hLine = '─'.repeat(innerWidth);
	const title = 'SEP-Field';
	const padding = ' '.repeat(Math.max(0, innerWidth - title.length - 2));

	return (
		<>
			<Text>┌{hLine}┐</Text>
			<Text>│ <Text bold>{title}</Text>{padding} │</Text>
			<Text>├{hLine}┤</Text>
		</>
	);
}
