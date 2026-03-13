import React from 'react';
import { Text } from 'ink';

interface SwitcherFooterProps {
	width: number;
}

export function SwitcherFooter({ width }: SwitcherFooterProps) {
	const innerWidth = width - 2;
	const hLine = '─'.repeat(innerWidth);
	const helpText = '↑↓ navigate   enter attach   ? more   q quit';
	const padding = ' '.repeat(Math.max(0, innerWidth - helpText.length - 2));

	return (
		<>
			<Text>├{hLine}┤</Text>
			<Text>│ <Text dimColor>{helpText}</Text>{padding} │</Text>
			<Text>└{hLine}┘</Text>
		</>
	);
}
