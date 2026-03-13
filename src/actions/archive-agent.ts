/**
 * Action: archive-agent — Teardown container, retain workspace artifacts
 */

import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
	name: 'archive-agent',
	description: 'Teardown container and remove session, workspace stays on disk',
	category: 'lifecycle',
	params: [
		{ name: 'all', type: 'boolean', required: false, default: false,
			description: 'Archive all active sessions' },
		{ name: 'id', type: 'select', required: false,
			description: 'Session to archive', optionsFrom: 'sessions' },
	],
	examples: [
		{
			description: 'Archive an agent, keeping its workspace',
			params: { id: 'agent-a1b2c3d4' },
			response: { success: true, data: { id: 'agent-a1b2c3d4', archivedWorkspace: '/abs/test-space/agent1-sandbox' } },
		},
	],
	async resolveOptions(paramName: string, sepSys: SEPSysInterface) {
		if (paramName !== 'id') return [];
		return sepSys.getSessionInfoList().map(s => ({
			value: s.id,
			label: `${s.name} (${s.agentState})`,
		}));
	},
	async execute(sepSys: SEPSysInterface, params: ActionParams): Promise<ActionResult> {
		if (params.all) {
			const sessions = sepSys.getSessionInfoList();
			if (sessions.length === 0) {
				return { success: false, error: 'No sessions to archive' };
			}
			const archived = [];
			for (const s of sessions) {
				const session = sepSys.getSession(s.id);
				const cwd = session?.cwd;
				await sepSys.removeSession(s.id);
				archived.push({ id: s.id, workspace: cwd });
			}
			return { success: true, data: { archived } };
		}

		const id = params.id as string;
		if (!id) {
			return { success: false, error: 'Specify a session ID or use all=true' };
		}

		const session = sepSys.getSession(id);
		if (!session) {
			return { success: false, error: `Session ${id} not found` };
		}

		const cwd = session.cwd;

		try {
			await sepSys.removeSession(id);
			return { success: true, data: { id, archivedWorkspace: cwd } };
		} catch (err) {
			return { success: false, error: `Failed to archive agent: ${err}` };
		}
	},
};
