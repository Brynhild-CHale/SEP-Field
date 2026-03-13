/**
 * Management Console — retro bureaucratic interface for executing actions.
 *
 * Two-panel layout with NavTree (left) and DetailPanel (right),
 * wrapped in ConsoleFrame for centralized border rendering.
 */

import React, { useEffect, useMemo, useCallback } from 'react';
import { Text, useInput } from 'ink';
import { useStore } from 'zustand';
import { store } from '../../store.ts';
import { executeAction, fetchActions, fetchSelectOptions } from '../../store-actions.ts';
import { NavTree, buildNavItems } from './NavTree.tsx';
import { DetailPanel } from './DetailPanel.tsx';
import { useQuoteLines } from './QuoteFooter.tsx';
import { ConsoleFrame } from './ConsoleFrame.tsx';
import { useTerminalSize } from '../../hooks/useTerminalSize.ts';
import { useDaemonUptime } from '../../hooks/useDaemonUptime.ts';
import { generateSerial } from '../../data/serial.ts';
import { useDim, useGarble } from '../effects/DimContext.tsx';

export function ManagementConsole() {
	const { cols, rows } = useTerminalSize();
	const dim = useDim();
	const g = useGarble();

	const WIDTH = Math.min(cols - 2, 80);
	const NAV_WIDTH = Math.max(20, Math.floor(WIDTH * 0.33));
	const innerWidth = WIDTH - 2;
	const DETAIL_WIDTH = innerWidth - NAV_WIDTH - 1; // 1 for center divider
	const PANEL_HEIGHT = Math.max(8, rows - 12);

	const actions = useStore(store, s => s.actions);
	const selectedIndex = useStore(store, s => s.mgmtSelectedIndex);
	const focusPanel = useStore(store, s => s.mgmtFocusPanel);
	const quoteIndex = useStore(store, s => s.quoteIndex);
	const actionResult = useStore(store, s => s.mgmtActionResult);
	const paramValues = useStore(store, s => s.mgmtParamValues);
	const focusedFieldIndex = useStore(store, s => s.mgmtFocusedFieldIndex);
	const executing = useStore(store, s => s.mgmtExecuting);
	const selectOptions = useStore(store, s => s.mgmtSelectOptions);
	const daemonStartTime = useStore(store, s => s.daemonStartTime);

	const uptime = useDaemonUptime(daemonStartTime);
	const serial = generateSerial(daemonStartTime);

	const navItems = useMemo(() => buildNavItems(actions), [actions]);

	// Fetch actions on mount
	useEffect(() => {
		fetchActions();
	}, []);

	// Get currently selected action
	const selectedAction = useMemo(() => {
		const item = navItems[selectedIndex];
		return item?.action || null;
	}, [navItems, selectedIndex]);

	// Reset param values when selected action changes
	const resetParamsForAction = useCallback((action: typeof selectedAction) => {
		if (!action) {
			store.setState({ mgmtParamValues: {}, mgmtFocusedFieldIndex: 0, mgmtActionResult: null, mgmtSelectOptions: {} });
			return;
		}
		const defaults: Record<string, string> = {};
		for (const p of action.params) {
			if (p.default !== undefined) {
				defaults[p.name] = String(p.default);
			} else if (p.type === 'boolean') {
				defaults[p.name] = 'false';
			} else {
				defaults[p.name] = '';
			}
		}
		store.setState({ mgmtParamValues: defaults, mgmtFocusedFieldIndex: 0, mgmtActionResult: null, mgmtSelectOptions: {} });
		// Fetch select options (async, fire-and-forget)
		const hasSelectParams = action.params.some(p => p.type === 'select');
		if (hasSelectParams) {
			fetchSelectOptions(action.name, action.params);
		}
	}, []);

	const doExecute = useCallback(async () => {
		if (!selectedAction) return;
		if (executing) return;

		// Validate required params
		for (const p of selectedAction.params) {
			if (p.required && !paramValues[p.name]) {
				store.setState({
					mgmtActionResult: { success: false, message: `Required param "${p.name}" is empty` },
				});
				return;
			}
		}

		// Type-coerce params
		const typedParams: Record<string, unknown> = {};
		for (const p of selectedAction.params) {
			const raw = paramValues[p.name] || '';
			if (p.type === 'number') {
				typedParams[p.name] = Number(raw);
			} else if (p.type === 'boolean') {
				typedParams[p.name] = raw === 'true';
			} else {
				// string and select — pass as-is
				typedParams[p.name] = raw;
			}
		}

		store.setState({ mgmtExecuting: true });
		const result = await executeAction(selectedAction.name, typedParams);
		store.setState({ mgmtExecuting: false, mgmtActionResult: result });
	}, [selectedAction, paramValues, executing]);

	// Determine if current focused field is a text-editable field
	const isEditingTextField = useMemo(() => {
		if (focusPanel !== 'detail' || !selectedAction) return false;
		if (focusedFieldIndex >= selectedAction.params.length) return false;
		const paramType = selectedAction.params[focusedFieldIndex].type;
		return paramType === 'string' || paramType === 'number';
	}, [focusPanel, selectedAction, focusedFieldIndex]);

	// Fields that capture left/right arrows (text fields + select)
	const isFieldCapturingArrows = useMemo(() => {
		if (focusPanel !== 'detail' || !selectedAction) return false;
		if (focusedFieldIndex >= selectedAction.params.length) return false;
		const paramType = selectedAction.params[focusedFieldIndex].type;
		return paramType === 'string' || paramType === 'number' || paramType === 'select';
	}, [focusPanel, selectedAction, focusedFieldIndex]);

	useInput((input, key) => {
		if (key.escape) {
			store.setState({
				mode: 'transition-to-switcher',
				transitionPhase: 'collapse',
				transitionProgress: 0,
			});
			return;
		}

		if (focusPanel === 'nav') {
			if (key.upArrow || input === 'k') {
				const newIndex = Math.max(0, selectedIndex - 1);
				if (newIndex !== selectedIndex) {
					store.setState({ mgmtSelectedIndex: newIndex });
					const newItem = navItems[newIndex];
					resetParamsForAction(newItem?.action || null);
				}
				return;
			}
			if (key.downArrow || input === 'j') {
				const newIndex = Math.min(navItems.length - 1, selectedIndex + 1);
				if (newIndex !== selectedIndex) {
					store.setState({ mgmtSelectedIndex: newIndex });
					const newItem = navItems[newIndex];
					resetParamsForAction(newItem?.action || null);
				}
				return;
			}
			if (key.rightArrow || key.tab) {
				if (selectedAction) {
					store.setState({ mgmtFocusPanel: 'detail' });
				}
				return;
			}
		}

		if (focusPanel === 'detail') {
			if ((key.leftArrow && !isFieldCapturingArrows) || key.tab) {
				store.setState({ mgmtFocusPanel: 'nav', mgmtActionResult: null });
				return;
			}

			if (key.upArrow) {
				store.setState({ mgmtFocusedFieldIndex: Math.max(0, focusedFieldIndex - 1) });
				return;
			}
			if (key.downArrow) {
				const maxIndex = selectedAction ? selectedAction.params.length : 0;
				store.setState({ mgmtFocusedFieldIndex: Math.min(maxIndex, focusedFieldIndex + 1) });
				return;
			}

			if (isEditingTextField) {
				// Text input mode: printable chars append, backspace deletes
				if (key.backspace || key.delete) {
					const paramName = selectedAction!.params[focusedFieldIndex].name;
					const current = paramValues[paramName] || '';
					store.setState({
						mgmtParamValues: { ...paramValues, [paramName]: current.slice(0, -1) },
					});
					return;
				}
				if (input && !key.ctrl && !key.meta && !key.return) {
					const paramName = selectedAction!.params[focusedFieldIndex].name;
					const current = paramValues[paramName] || '';
					store.setState({
						mgmtParamValues: { ...paramValues, [paramName]: current + input },
					});
					return;
				}
			}

			// Boolean toggle
			if (selectedAction && focusedFieldIndex < selectedAction.params.length) {
				const param = selectedAction.params[focusedFieldIndex];
				if (param.type === 'boolean' && input === ' ') {
					const current = paramValues[param.name] === 'true';
					store.setState({
						mgmtParamValues: { ...paramValues, [param.name]: String(!current) },
					});
					return;
				}

				// Select cycling with left/right arrows
				if (param.type === 'select' && (key.leftArrow || key.rightArrow)) {
					const opts = selectOptions[param.name] || [];
					if (opts.length > 0) {
						const currentIdx = opts.findIndex(o => o.value === paramValues[param.name]);
						const delta = key.rightArrow ? 1 : -1;
						const nextIdx = (currentIdx + delta + opts.length) % opts.length;
						store.setState({
							mgmtParamValues: { ...paramValues, [param.name]: opts[nextIdx].value },
						});
					}
					return;
				}
			}

			// Execute on enter (on EXECUTE button), or dismiss result
			if (key.return) {
				if (actionResult) {
					store.setState({ mgmtActionResult: null });
					return;
				}
				const execIndex = selectedAction ? selectedAction.params.length : 0;
				if (focusedFieldIndex === execIndex) {
					doExecute();
				}
				return;
			}
		}
	});

	// Build title content (inlined from former ConsoleHeader)
	const titleLine = 'SEP-Field Management Console (v0.1.0-beta-rc2-UNSTABLE)';
	const titlePad = ' '.repeat(Math.max(0, innerWidth - titleLine.length - 2));
	const infoLine = `Serial: ${serial}    Uptime: ${uptime}`;
	const infoPad = ' '.repeat(Math.max(0, innerWidth - infoLine.length - 2));

	const titleContent = [
		<Text key="title" dimColor={dim}> <Text bold dimColor={dim}>{g(titleLine)}</Text>{titlePad} </Text>,
		<Text key="info" dimColor={dim}> {g(infoLine)}{infoPad} </Text>,
	];

	// Build quote lines
	const quoteLines = useQuoteLines(quoteIndex, innerWidth);

	const helpText = g('↑↓ select   tab switch panel   enter execute   esc exit');

	return (
		<ConsoleFrame
			width={WIDTH}
			navWidth={NAV_WIDTH}
			titleContent={titleContent}
			navPanel={
				<NavTree
					actions={actions}
					selectedIndex={selectedIndex}
					panelWidth={NAV_WIDTH}
					panelHeight={PANEL_HEIGHT}
					focused={focusPanel === 'nav'}
				/>
			}
			detailPanel={
				<DetailPanel
					action={selectedAction}
					paramValues={paramValues}
					selectOptions={selectOptions}
					focusedFieldIndex={focusedFieldIndex}
					focused={focusPanel === 'detail'}
					panelWidth={DETAIL_WIDTH}
					panelHeight={PANEL_HEIGHT}
					actionResult={actionResult}
					executing={executing}
				/>
			}
			panelHeight={PANEL_HEIGHT}
			quoteLines={quoteLines}
			helpText={helpText}
		/>
	);
}
