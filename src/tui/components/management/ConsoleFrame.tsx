/**
 * ConsoleFrame — centralized border rendering for the Management Console.
 *
 * Owns ALL box-drawing characters. Child components render pure content text.
 */

import React from 'react';
import { Text, Box } from 'ink';
import { useDim } from '../effects/DimContext.tsx';

interface ConsoleFrameProps {
	width: number;
	navWidth: number;
	titleContent: React.ReactNode[];
	navPanel: React.ReactNode;
	detailPanel: React.ReactNode;
	panelHeight: number;
	quoteLines: string[];
	helpText: string;
}

export function ConsoleFrame({
	width,
	navWidth,
	titleContent,
	navPanel,
	detailPanel,
	panelHeight,
	quoteLines,
	helpText,
}: ConsoleFrameProps) {
	const dim = useDim();

	const innerWidth = width - 2;
	const detailWidth = innerWidth - navWidth - 1; // 1 for center divider
	const hLine = '─'.repeat(innerWidth);
	const navLine = '─'.repeat(navWidth);
	const detailLine = '─'.repeat(detailWidth);

	// Vertical border repeated for every body row
	const vBorder = new Array(panelHeight).fill('│').join('\n');

	return (
		<Box flexDirection="column">
			{/* Top border */}
			<Text dimColor={dim}>┌{hLine}┐</Text>

			{/* Title rows */}
			{titleContent.map((row, i) => (
				<Text key={`title-${i}`} dimColor={dim}>
					│{row}│
				</Text>
			))}

			{/* Column split divider */}
			<Text dimColor={dim}>├{navLine}┬{detailLine}┤</Text>

			{/* Two-column body */}
			<Box flexDirection="row" height={panelHeight}>
				<Text dimColor={dim}>{vBorder}</Text>
				<Box flexDirection="column" width={navWidth}>
					{navPanel}
				</Box>
				<Text dimColor={dim}>{vBorder}</Text>
				<Box flexDirection="column" width={detailWidth}>
					{detailPanel}
				</Box>
				<Text dimColor={dim}>{vBorder}</Text>
			</Box>

			{/* Column merge divider */}
			<Text dimColor={dim}>├{navLine}┴{detailLine}┤</Text>

			{/* Quote rows */}
			{quoteLines.map((line, i) => {
				const padding = ' '.repeat(Math.max(0, innerWidth - line.length));
				return (
					<Text key={`quote-${i}`} dimColor={dim}>
						│{line}{padding}│
					</Text>
				);
			})}

			{/* Footer divider */}
			<Text dimColor={dim}>├{hLine}┤</Text>

			{/* Help row */}
			<Text dimColor={dim}>│ {helpText}{' '.repeat(Math.max(0, innerWidth - helpText.length - 2))} │</Text>

			{/* Bottom border */}
			<Text dimColor={dim}>└{hLine}┘</Text>
		</Box>
	);
}
