/**
 * Action: kill-agent — Kill a running agent process
 */

import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
	name: 'kill-agent',
	description: 'Kill a running agent process',
	category: 'lifecycle',
	params: [
		{ name: 'all', type: 'boolean', required: false, default: false,
			description: 'Kill all running agents' },
		{ name: 'id', type: 'select', required: false,
			description: 'Session to kill', optionsFrom: 'sessions' },
	],
	examples: [
		{
			description: 'Kill a running agent by session ID',
			params: { id: 'agent-a1b2c3d4' },
			response: { success: true, data: { id: 'agent-a1b2c3d4' } },
		},
	],
	async resolveOptions(paramName: string, sepSys: SEPSysInterface) {
		if (paramName !== 'id') return [];
		return sepSys.getSessionInfoList()
			.filter(s => s.status === 'running')
			.map(s => ({
				value: s.id,
				label: `${s.name} (${s.agentState})`,
			}));
	},
	async execute(sepSys: SEPSysInterface, params: ActionParams): Promise<ActionResult> {
		if (params.all) {
			const sessions = sepSys.getSessionInfoList().filter(s => s.status === 'running');
			if (sessions.length === 0) {
				return { success: false, error: 'No running sessions to kill' };
			}
			const killed = [];
			for (const s of sessions) {
				sepSys.killSession(s.id);
				killed.push({ id: s.id });
			}
			return { success: true, data: { killed } };
		}

		const id = params.id as string;
		if (!id) {
			return { success: false, error: 'Specify a session ID or use all=true' };
		}

		const session = sepSys.getSession(id);
		if (!session) {
			return { success: false, error: `Session ${id} not found` };
		}

		sepSys.killSession(id);
		return { success: true, data: { id } };
	},
};
