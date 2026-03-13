/**
 * DetailPanel — right panel showing action details and parameter form.
 *
 * Every entry in `rows[]` is a single visual line, so the padding
 * calculation at the bottom is always accurate.
 */

import React from 'react';
import { Text, Box } from 'ink';
import type { Action, SelectOption } from '../../../types/index.ts';
import { buildParamFormRows } from './ParamForm.tsx';
import { useDim, useGarble } from '../effects/DimContext.tsx';

interface DetailPanelProps {
	action: Action | null;
	paramValues: Record<string, string>;
	selectOptions: Record<string, SelectOption[]>;
	focusedFieldIndex: number;
	focused: boolean;
	panelWidth: number;
	panelHeight: number;
	actionResult: { success: boolean; message: string } | null;
	executing: boolean;
}

export function DetailPanel({
	action,
	paramValues,
	selectOptions,
	focusedFieldIndex,
	focused,
	panelWidth,
	panelHeight,
	actionResult,
	executing,
}: DetailPanelProps) {
	const dim = useDim();
	const g = useGarble();
	const rows: React.ReactNode[] = [];
	const pad = (s: string) => s + ' '.repeat(Math.max(0, panelWidth - s.length));
	const blank = ' '.repeat(panelWidth);

	if (!action) {
		rows.push(<Text key="empty" dimColor={dim}>{pad(' :: SELECT AN ACTION ::')}</Text>);
		for (let i = 1; i < panelHeight; i++) {
			rows.push(<Text key={`pad-${i}`} dimColor={dim}>{blank}</Text>);
		}
		return <Box flexDirection="column">{rows}</Box>;
	}

	rows.push(<Text key="title" bold dimColor={dim}>{pad(' :: ACTION DETAIL ::')}</Text>);

	if (actionResult) {
		// Result replaces detail body
		rows.push(<Text key="blank1" dimColor={dim}>{blank}</Text>);
		const color = actionResult.success ? 'green' : 'red';
		const icon = actionResult.success ? '✓' : '✗';
		const prefix = ` ${icon} `;
		const words = actionResult.message.split(' ');
		let line = prefix;
		for (const w of words) {
			if (line.length + w.length + 1 > panelWidth - 1) {
				rows.push(<Text key={`res-${rows.length}`} color={color} dimColor={dim}>{pad(line)}</Text>);
				line = '   ' + w;
			} else {
				line += (line.length > prefix.length || line.length > 3 ? ' ' : '') + w;
			}
		}
		if (line.length > 3) {
			rows.push(<Text key={`res-${rows.length}`} color={color} dimColor={dim}>{pad(line)}</Text>);
		}
		rows.push(<Text key="blank-ack" dimColor={dim}>{blank}</Text>);
		rows.push(<Text key="ack-hint" dimColor={dim}>{pad('  Press ENTER to dismiss')}</Text>);
	} else {
		// Normal detail body
		rows.push(<Text key="blank1" dimColor={dim}>{blank}</Text>);
		rows.push(<Text key="name" dimColor={dim}>{pad(g(` NAME: ${action.name}`))}</Text>);
		rows.push(<Text key="status" dimColor={dim}>{pad(g(` STATUS: Available`))}</Text>);
		rows.push(<Text key="blank2" dimColor={dim}>{blank}</Text>);

		if (action.description) {
			const words = action.description.split(' ');
			let line = ' ';
			for (const w of words) {
				if (line.length + w.length + 1 > panelWidth - 1) {
					rows.push(<Text key={`desc-${rows.length}`} dimColor={dim}>{pad(g(line))}</Text>);
					line = ' ' + w;
				} else {
					line += (line.length > 1 ? ' ' : '') + w;
				}
			}
			if (line.length > 1) {
				rows.push(<Text key={`desc-${rows.length}`} dimColor={dim}>{pad(g(line))}</Text>);
			}
		}

		rows.push(<Text key="blank3" dimColor={dim}>{blank}</Text>);

		// Parameter form — each entry is one visual line
		rows.push(...buildParamFormRows({
			params: action.params,
			values: paramValues,
			selectOptions,
			focusedIndex: focusedFieldIndex,
			focused,
			panelWidth,
			executing,
			dim,
			garble: g,
		}));
	}

	// Pad remaining — rows.length is now accurate (1 entry = 1 visual line)
	for (let i = rows.length; i < panelHeight; i++) {
		rows.push(<Text key={`pad-${i}`} dimColor={dim}>{blank}</Text>);
	}

	return <Box flexDirection="column">{rows}</Box>;
}
