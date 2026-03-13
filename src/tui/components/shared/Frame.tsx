/**
 * Reusable box-drawing border frame.
 *
 * Renders a box with optional title and divider positions. All
 * box-drawing characters are explicit — no Ink <Box> borderStyle.
 */

import React from 'react';
import { Text, Box } from 'ink';

interface FrameProps {
	width: number;
	title?: string;
	children: React.ReactNode;
	footer?: React.ReactNode;
	color?: string;
}

export function Frame({ width, title, children, footer, color }: FrameProps) {
	const innerWidth = width - 2; // minus left+right borders
	const hLine = '─'.repeat(innerWidth);

	return (
		<Box flexDirection="column">
			{/* Top border */}
			<Text color={color}>┌{hLine}┐</Text>

			{/* Title row */}
			{title && (
				<>
					<Text color={color}>
						│<Text bold> {title}{' '.repeat(Math.max(0, innerWidth - title.length - 1))}</Text>│
					</Text>
					<Text color={color}>├{hLine}┤</Text>
				</>
			)}

			{/* Content */}
			{children}

			{/* Footer */}
			{footer && (
				<>
					<Text color={color}>├{hLine}┤</Text>
					{footer}
				</>
			)}

			{/* Bottom border */}
			<Text color={color}>└{hLine}┘</Text>
		</Box>
	);
}
