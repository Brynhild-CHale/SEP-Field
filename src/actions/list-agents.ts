/**
 * Action: list-agents — Return current session list
 */

import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
	name: 'list-agents',
	description: 'List all current agent sessions',
	category: 'monitoring',
	params: [],
	examples: [
		{
			description: 'List all agents',
			params: {},
			response: { success: true, data: [] },
		},
	],
	async execute(sepSys: SEPSysInterface, _params: ActionParams): Promise<ActionResult> {
		const list = sepSys.getSessionInfoList();
		return { success: true, data: list };
	},
};
