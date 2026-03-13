/**
 * Navigation tree for Management Console left panel.
 *
 * Flat alphabetical list of actions — no categories, no hierarchy.
 */

import React, { useMemo } from 'react';
import { Text, Box } from 'ink';
import type { Action } from '../../../types/index.ts';
import { useDim, useGarble } from '../effects/DimContext.tsx';

export interface NavItem {
	label: string;
	action: Action;
}

export function buildNavItems(actions: Action[]): NavItem[] {
	return [...actions]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(a => ({ label: a.name, action: a }));
}

interface NavTreeProps {
	actions: Action[];
	selectedIndex: number;
	panelWidth: number;
	panelHeight: number;
	focused: boolean;
}

export function NavTree({ actions, selectedIndex, panelWidth, panelHeight, focused }: NavTreeProps) {
	const dim = useDim();
	const g = useGarble();
	const navItems = useMemo(() => buildNavItems(actions), [actions]);

	// Scroll window: keep selected item roughly centered
	const visibleCount = panelHeight;
	const scrollOffset = Math.max(
		0,
		Math.min(
			selectedIndex - Math.floor(visibleCount / 2),
			navItems.length - visibleCount,
		),
	);

	const rows: React.ReactNode[] = [];
	for (let vi = 0; vi < visibleCount; vi++) {
		const i = scrollOffset + vi;
		if (i >= navItems.length) {
			rows.push(<Text key={`pad-${vi}`} dimColor={dim}>{' '.repeat(panelWidth)}</Text>);
			continue;
		}
		const item = navItems[i];
		const isSelected = focused && i === selectedIndex;
		const text = ` ${g(item.label)}`;
		const padded = text + ' '.repeat(Math.max(0, panelWidth - text.length));

		rows.push(
			<Text key={i} dimColor={dim}>
				{isSelected ? <Text bold inverse dimColor={dim}>{padded}</Text> : <Text dimColor={dim}>{padded}</Text>}
			</Text>,
		);
	}

	return <Box flexDirection="column">{rows}</Box>;
}
