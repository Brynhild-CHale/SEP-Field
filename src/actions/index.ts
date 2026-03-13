/**
 * Action Registry — auto-discovers action modules from built-in and user directories
 */

import { existsSync } from 'fs';
import type { Action, Logger } from '../types/index.ts';
import { loadActionsFromDirectory } from './action-loader.ts';
import { USER_ACTIONS_DIR } from '../service/paths.ts';

export const BUILTIN_ACTIONS_DIR = import.meta.dir;

export interface LoadActionsResult {
	actions: Map<string, Action>;
	builtinNames: Set<string>;
	userActionNames: Set<string>;
}

/** Discover and load all actions from built-in and user directories. */
export async function loadActions(logger: Logger): Promise<LoadActionsResult> {
	const actions = new Map<string, Action>();
	const builtinNames = new Set<string>();
	const userActionNames = new Set<string>();

	// 1. Load built-in actions
	const builtin = await loadActionsFromDirectory(BUILTIN_ACTIONS_DIR, logger);
	for (const action of builtin.actions) {
		if (actions.has(action.name)) {
			logger.error(`Duplicate built-in action name '${action.name}' — skipping`);
			continue;
		}
		actions.set(action.name, action);
		builtinNames.add(action.name);
	}
	for (const err of builtin.errors) {
		logger.error(`Built-in action load error: ${err}`);
	}

	// 2. Load user actions (override built-in on name conflict)
	if (existsSync(USER_ACTIONS_DIR)) {
		const user = await loadActionsFromDirectory(USER_ACTIONS_DIR, logger, new Set());
		for (const action of user.actions) {
			if (actions.has(action.name)) {
				logger.log(`User action '${action.name}' overrides built-in`);
			}
			actions.set(action.name, action);
			userActionNames.add(action.name);
		}
		for (const err of user.errors) {
			logger.error(`User action load error: ${err}`);
		}
	}

	logger.log(`Loaded ${actions.size} actions`);
	return { actions, builtinNames, userActionNames };
}
