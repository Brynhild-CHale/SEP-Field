/**
 * Action: open-vscode — Launch VS Code attached to a devcontainer
 */

import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
	name: 'open-vscode',
	description: 'Launch VS Code attached to an agent devcontainer',
	category: 'tooling',
	params: [
		{ name: 'id', type: 'select', required: true, description: 'Session to open in VS Code', optionsFrom: 'sessions' },
	],
	examples: [
		{
			description: 'Open VS Code for a running agent',
			params: { id: 'agent-a1b2c3d4' },
			response: { success: true, data: { id: 'agent-a1b2c3d4', cwd: '/abs/test-space/agent1-sandbox' } },
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

		const result = Bun.spawnSync(
			['devcontainer', 'open', '--workspace-folder', session.cwd],
			{ env: process.env, stdout: 'pipe', stderr: 'pipe' },
		);

		if (result.exitCode !== 0) {
			return { success: false, error: `devcontainer open failed: ${result.stderr.toString()}` };
		}

		return { success: true, data: { id, cwd: session.cwd } };
	},
};
