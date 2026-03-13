/**
 * Store-actions — boundary layer between React components and connection.
 *
 * Components import from here instead of connection.ts directly,
 * keeping UI and transport concerns decoupled.
 */

import { attach as connAttach, executeAction as connExec, fetchActions as connFetch, fetchParamOptions } from './connection.ts';
import { getTickerHeight } from './ticker.ts';
import { store } from './store.ts';
import type { ActionParamSchema, SelectOption } from '../types/index.ts';

export function attachSession(sessionId: string) {
	connAttach(sessionId, getTickerHeight());
}

export function executeAction(name: string, params: Record<string, unknown>) {
	return connExec(name, params);
}

export function fetchActions() {
	return connFetch();
}

export async function fetchSelectOptions(
	actionName: string,
	params: ActionParamSchema[],
): Promise<void> {
	const result: Record<string, SelectOption[]> = {};
	const paramValues = { ...store.getState().mgmtParamValues };

	for (const p of params) {
		if (p.type === 'select' && p.options) {
			result[p.name] = p.options;
			if (!paramValues[p.name] && p.options.length > 0) {
				paramValues[p.name] = p.options[0].value;
			}
		} else if (p.type === 'select' && p.optionsFrom) {
			const options = await fetchParamOptions(actionName, p.name);
			result[p.name] = options;
			if (!paramValues[p.name] && options.length > 0) {
				paramValues[p.name] = options[0].value;
			}
		}
	}

	store.setState({ mgmtSelectOptions: result, mgmtParamValues: paramValues });
}
