/**
 * Action: create-interactive-agent — Create an agent in interactive mode (no prompt)
 */

import { resolve } from 'path';
import { mkdirSync } from 'fs';
import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
	name: 'create-interactive-agent',
	description: 'Create an agent in interactive mode (no prompt)',
	category: 'lifecycle',
	params: [
		{ name: 'name', type: 'string', required: true,
			description: 'Display name for the agent' },
		{ name: 'dir', type: 'string', required: true,
			description: 'Workspace directory (created if needed)' },
	],
	async execute(sepSys: SEPSysInterface, params: ActionParams): Promise<ActionResult> {
		const name = params.name as string;
		const dir = params.dir as string;

		if (!name || !dir) {
			return { success: false, error: 'Missing required params: name, dir' };
		}

		const id = `agent-${crypto.randomUUID().slice(0, 8)}`;
		const cwd = resolve(dir);
		mkdirSync(cwd, { recursive: true });

		try {
			await sepSys.createSession({ id, name, cwd });
			return { success: true, data: { id, name, cwd, status: 'starting' } };
		} catch (err) {
			return { success: false, error: `Failed to create agent: ${err}` };
		}
	},
};
