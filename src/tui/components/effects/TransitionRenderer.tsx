/**
 * TransitionRenderer — renders the visual output for each transition phase.
 *
 * This component reads from the store and draws the appropriate effect
 * for the current transition phase.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from 'zustand';
import { store, type TransitionPhase } from '../../store.ts';
import { useTerminalSize } from '../../hooks/useTerminalSize.ts';

export function TransitionRenderer() {
	const phase = useStore(store, s => s.transitionPhase);
	const progress = useStore(store, s => s.transitionProgress);
	const { cols, rows } = useTerminalSize();

	const panelWidth = Math.min(cols - 2, 80);

	switch (phase) {
		case 'pinch':
			return <PinchPhase rows={rows} panelWidth={panelWidth} progress={progress} />;
		case 'line-hold':
			return <LineHoldPhase rows={rows} cols={cols} panelWidth={panelWidth} />;
		case 'line-collapse':
			return <LineCollapsePhase rows={rows} cols={cols} panelWidth={panelWidth} progress={progress} />;
		case 'darkness':
		case 'black':
			return <DarknessPhase rows={rows} />;
		case 'cursor-blink':
			return <CursorBlinkPhase rows={rows} progress={progress} />;
		case 'frame-draw':
			return <FrameDrawPhase rows={rows} panelWidth={panelWidth} progress={progress} />;
		case 'false-start':
			return <FalseStartPhase rows={rows} panelWidth={panelWidth} progress={progress} />;
		case 'scan':
			return <ScanPhase rows={rows} panelWidth={panelWidth} progress={progress} />;
		case 'content-fill':
		case 'stabilize':
			// These phases are handled by ManagementConsole rendering
			return <Text dimColor={phase === 'stabilize' && progress < 0.5}>Loading...</Text>;
		case 'collapse':
			return <CollapsePhase rows={rows} panelWidth={panelWidth} progress={progress} />;
		default:
			return null;
	}
}

function PinchPhase({ rows, panelWidth, progress }: { rows: number; panelWidth: number; progress: number }) {
	const visibleRows = Math.max(1, Math.floor(rows * (1 - progress)));
	const topPad = Math.floor((rows - visibleRows) / 2);
	const lines: React.ReactNode[] = [];

	for (let i = 0; i < topPad; i++) {
		lines.push(<Text key={`top-${i}`}>{' '.repeat(panelWidth)}</Text>);
	}
	for (let i = 0; i < visibleRows; i++) {
		lines.push(<Text key={`vis-${i}`} dimColor>{' '.repeat(panelWidth)}</Text>);
	}

	return <Box flexDirection="column">{lines}</Box>;
}

function LineHoldPhase({ rows, cols, panelWidth }: { rows: number; cols: number; panelWidth: number }) {
	const midRow = Math.floor(rows / 2);
	const lines: React.ReactNode[] = [];

	for (let i = 0; i < rows; i++) {
		if (i === midRow) {
			lines.push(<Text key={i} bold>{'━'.repeat(panelWidth)}</Text>);
		} else {
			lines.push(<Text key={i}>{' '.repeat(cols)}</Text>);
		}
	}
	return <Box flexDirection="column">{lines}</Box>;
}

function LineCollapsePhase({ rows, cols, panelWidth, progress }: { rows: number; cols: number; panelWidth: number; progress: number }) {
	const midRow = Math.floor(rows / 2);
	const lineWidth = Math.max(0, Math.floor(panelWidth * (1 - progress)));
	const lines: React.ReactNode[] = [];

	for (let i = 0; i < rows; i++) {
		if (i === midRow && lineWidth > 0) {
			lines.push(<Text key={i} bold>{'━'.repeat(lineWidth)}</Text>);
		} else {
			lines.push(<Text key={i}>{' '.repeat(cols)}</Text>);
		}
	}
	return <Box flexDirection="column">{lines}</Box>;
}

function DarknessPhase({ rows }: { rows: number }) {
	const lines: React.ReactNode[] = [];
	for (let i = 0; i < rows; i++) {
		lines.push(<Text key={i}> </Text>);
	}
	return <Box flexDirection="column">{lines}</Box>;
}

function CursorBlinkPhase({ rows, progress }: { rows: number; progress: number }) {
	// 3 blinks over the 600ms phase
	const blinkCycle = Math.floor(progress * 6); // 0-5
	const cursorVisible = blinkCycle % 2 === 0;

	const lines: React.ReactNode[] = [];
	lines.push(<Text key={0}>{cursorVisible ? '█' : ' '}</Text>);
	for (let i = 1; i < rows; i++) {
		lines.push(<Text key={i}> </Text>);
	}
	return <Box flexDirection="column">{lines}</Box>;
}

function FrameDrawPhase({ rows, panelWidth, progress }: { rows: number; panelWidth: number; progress: number }) {
	const frameWidth = panelWidth;
	const frameHeight = Math.min(20, rows - 2);
	const drawProgress = progress;

	// Corners appear first, then edges race inward
	const hDrawn = Math.floor(frameWidth * drawProgress);
	const vDrawn = Math.floor(frameHeight * drawProgress);

	const lines: React.ReactNode[] = [];

	// Top edge
	if (drawProgress > 0) {
		const topLine = '┌' + '─'.repeat(Math.min(hDrawn, frameWidth - 2)) +
			(hDrawn >= frameWidth - 1 ? '┐' : ' '.repeat(Math.max(0, frameWidth - 1 - hDrawn)));
		lines.push(<Text key="top">{topLine}</Text>);
	}

	// Side edges
	for (let i = 0; i < vDrawn && i < frameHeight - 2; i++) {
		lines.push(<Text key={`mid-${i}`}>│{' '.repeat(frameWidth - 2)}│</Text>);
	}

	// Bottom edge
	if (drawProgress > 0.5) {
		const botLine = '└' + '─'.repeat(Math.min(hDrawn, frameWidth - 2)) +
			(hDrawn >= frameWidth - 1 ? '┘' : ' '.repeat(Math.max(0, frameWidth - 1 - hDrawn)));
		lines.push(<Text key="bot">{botLine}</Text>);
	}

	return <Box flexDirection="column">{lines}</Box>;
}

function FalseStartPhase({ rows, panelWidth, progress }: { rows: number; panelWidth: number; progress: number }) {
	// Flash content at 25% progress, then go black
	const showContent = progress > 0.1 && progress < 0.35;

	if (showContent) {
		const innerWidth = panelWidth - 2;
		const title = ' SEP-Field Management Console (v0.1.0-beta-rc2-UNSTABLE)';
		const paddedTitle = title + ' '.repeat(Math.max(0, innerWidth - title.length));
		return (
			<Box flexDirection="column">
				<Text bold>┌{'─'.repeat(innerWidth)}┐</Text>
				<Text>│{paddedTitle}│</Text>
				<Text bold>└{'─'.repeat(innerWidth)}┘</Text>
			</Box>
		);
	}

	const lines: React.ReactNode[] = [];
	for (let i = 0; i < Math.min(rows, 3); i++) {
		lines.push(<Text key={i}> </Text>);
	}
	return <Box flexDirection="column">{lines}</Box>;
}

function ScanPhase({ rows, panelWidth, progress }: { rows: number; panelWidth: number; progress: number }) {
	const scanRow = Math.floor(rows * progress);
	const lines: React.ReactNode[] = [];

	for (let i = 0; i < rows; i++) {
		if (i === scanRow) {
			lines.push(<Text key={i} bold>{'▓'.repeat(panelWidth)}</Text>);
		} else {
			lines.push(<Text key={i}> </Text>);
		}
	}
	return <Box flexDirection="column">{lines}</Box>;
}

function CollapsePhase({ rows, panelWidth, progress }: { rows: number; panelWidth: number; progress: number }) {
	const visibleRows = Math.max(0, Math.floor(rows * (1 - progress)));
	const topPad = Math.floor((rows - visibleRows) / 2);
	const lines: React.ReactNode[] = [];

	for (let i = 0; i < topPad; i++) {
		lines.push(<Text key={`top-${i}`}> </Text>);
	}
	if (visibleRows > 0) {
		lines.push(<Text key="center" dimColor>{'━'.repeat(panelWidth)}</Text>);
	}

	return <Box flexDirection="column">{lines}</Box>;
}
