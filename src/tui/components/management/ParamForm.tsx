/**
 * ParamForm — dynamic form fields for action parameters.
 *
 * Returns an array of ReactNode rows (one per visual line) for direct
 * inclusion in DetailPanel's row array, so height counting is accurate.
 */

import React from 'react';
import { Text } from 'ink';
import type { ActionParamSchema, SelectOption } from '../../../types/index.ts';

interface ParamFormOptions {
	params: ActionParamSchema[];
	values: Record<string, string>;
	selectOptions: Record<string, SelectOption[]>;
	focusedIndex: number;
	focused: boolean;
	panelWidth: number;
	executing: boolean;
	dim: boolean;
	garble: (text: string) => string;
}

export function buildParamFormRows({
	params,
	values,
	selectOptions,
	focusedIndex,
	focused,
	panelWidth,
	executing,
	dim,
	garble: g,
}: ParamFormOptions): React.ReactNode[] {
	const rows: React.ReactNode[] = [];

	if (params.length === 0) {
		const noParamText = g(' No parameters required.');
		const noParamPad = ' '.repeat(Math.max(0, panelWidth - noParamText.length));
		rows.push(
			<Text key="no-params" dimColor={dim}>{noParamText}{noParamPad}</Text>,
		);
		rows.push(<Text key="np-blank" dimColor={dim}>{' '.repeat(panelWidth)}</Text>);
	} else {
		for (let i = 0; i < params.length; i++) {
			const p = params[i];
			const isFocused = focused && focusedIndex === i;
			const label = ` ${p.name.toUpperCase()}${p.required ? '*' : ''}`;

			if (p.type === 'boolean') {
				const val = values[p.name] === 'true';
				const onText = val ? '< ON >' : '  ON  ';
				const offText = val ? '  OFF  ' : '< OFF >';
				const fieldContent = `${label}: ${onText} / ${offText}`;
				const padded = fieldContent + ' '.repeat(Math.max(0, panelWidth - fieldContent.length));

				rows.push(
					<Text key={`field-${i}`} dimColor={dim}>
						{isFocused ? <Text bold inverse dimColor={dim}>{padded}</Text> : <Text dimColor={dim}>{padded}</Text>}
					</Text>,
				);
			} else if (p.type === 'select') {
				const opts = selectOptions[p.name] || [];
				const currentValue = values[p.name] || '';
				const currentOption = opts.find(o => o.value === currentValue);
				let displayLabel: string;
				if (opts.length === 0) {
					displayLabel = '(no options available)';
				} else if (currentOption) {
					displayLabel = isFocused ? `< ${currentOption.label} >` : currentOption.label;
				} else {
					displayLabel = isFocused ? '< — >' : '—';
				}
				const fieldContent = `${label}: ${g(displayLabel)}`;
				const padded = fieldContent + ' '.repeat(Math.max(0, panelWidth - fieldContent.length));

				rows.push(
					<Text key={`field-${i}`} dimColor={dim}>
						{isFocused ? <Text bold inverse dimColor={dim}>{padded}</Text> : <Text dimColor={dim}>{padded}</Text>}
					</Text>,
				);
			} else {
				// string or number — text input
				const rawValue = values[p.name] || '';
				const inputAreaWidth = Math.max(8, panelWidth - label.length - 5); // 5 = ": [" + "]" + padding
				const displayValue = rawValue.length > inputAreaWidth - 1
					? rawValue.slice(rawValue.length - inputAreaWidth + 1)
					: rawValue;
				const cursor = isFocused ? '█' : '';
				const fieldPad = ' '.repeat(Math.max(0, inputAreaWidth - displayValue.length - cursor.length));
				const fieldContent = `${label}: [${g(displayValue)}${cursor}${fieldPad}]`;
				const padded = fieldContent + ' '.repeat(Math.max(0, panelWidth - fieldContent.length));

				rows.push(
					<Text key={`field-${i}`} dimColor={dim}>
						{isFocused ? <Text bold dimColor={dim}>{padded}</Text> : <Text dimColor={dim}>{padded}</Text>}
					</Text>,
				);
			}

			// Description row for focused field
			if (isFocused && p.description) {
				const descText = `   ${p.description}`.slice(0, panelWidth);
				const descPad = ' '.repeat(Math.max(0, panelWidth - descText.length));
				rows.push(
					<Text key={`desc-${i}`} dimColor>{descText}{descPad}</Text>,
				);
			}
		}
		rows.push(<Text key="field-spacer" dimColor={dim}>{' '.repeat(panelWidth)}</Text>);
	}

	// EXECUTE button
	const execIndex = params.length;
	const isExecFocused = focused && focusedIndex === execIndex;
	const buttonLabel = executing ? ' [ EXECUTING... ] ' : ' [ EXECUTE ] ';
	const buttonPad = ' '.repeat(Math.max(0, panelWidth - buttonLabel.length));

	rows.push(
		<Text key="exec-btn" dimColor={dim}>
			{isExecFocused
				? <Text bold inverse dimColor={dim}>{buttonLabel}{buttonPad}</Text>
				: <Text dimColor={dim}>{buttonLabel}{buttonPad}</Text>
			}
		</Text>,
	);

	return rows;
}
