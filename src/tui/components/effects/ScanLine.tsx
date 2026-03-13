/**
 * ScanLine overlay — dims one row at a time, scrolling top→bottom.
 *
 * Works by wrapping children in a column and applying dimColor to
 * the row at `position`. Since Ink re-renders the full screen, we
 * clone each child element and inject dimColor when it matches.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useScanLine } from '../../hooks/useScanLine.ts';

interface ScanLineProps {
	rows: number;
	period?: number;
	children: React.ReactNode;
}

export function ScanLine({ rows, period, children }: ScanLineProps) {
	const position = useScanLine(rows, period);

	// Convert children to array and wrap each in a dim check
	const childArray = React.Children.toArray(children);

	return (
		<Box flexDirection="column">
			{childArray.map((child, i) => {
				if (i === position) {
					return (
						<Text key={i} dimColor>
							{child}
						</Text>
					);
				}
				return <React.Fragment key={i}>{child}</React.Fragment>;
			})}
		</Box>
	);
}
