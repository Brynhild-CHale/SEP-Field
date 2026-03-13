/**
 * Action: restart-agent — Restart an exited session
 */

import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
	name: 'restart-agent',
	description: 'Restart an exited or running session',
	category: 'lifecycle',
	params: [
		{ name: 'id', type: 'select', required: true, description: 'Session to restart', optionsFrom: 'sessions' },
	],
	examples: [
		{
			description: 'Restart an exited agent',
			params: { id: 'agent-a1b2c3d4' },
			response: { success: true, data: { id: 'agent-a1b2c3d4' } },
		},
	],
	async resolveOptions(paramName, sepSys) {
		if (paramName !== 'id') return [];
		return sepSys.getSessionInfoList().map(s => ({
			value: s.id,
			label: `${s.name} (${s.agentState})`,
		}));
	},
	async execute(sepSys: SEPSysInterface, params: ActionParams): Promise<ActionResult> {
		const id = params.id as string;
		if (!id) {
			return { success: false, error: 'Missing required param: id' };
		}

		const session = sepSys.getSession(id);
		if (!session) {
			return { success: false, error: `Session ${id} not found` };
		}

		try {
			await sepSys.restartSession(id);
			return { success: true, data: { id } };
		} catch (err) {
			return { success: false, error: `Failed to restart agent: ${err}` };
		}
	},
};
