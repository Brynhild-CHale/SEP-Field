/**
 * Action: create-agent — Create a new agent container + session
 */

import { resolve } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
	name: 'create-agent',
	description: 'Create a new agent container and session',
	category: 'lifecycle',
	params: [
		{ name: 'name', type: 'string', required: true, description: 'Display name for the agent' },
		{ name: 'cwd', type: 'string', required: true, description: 'Workspace directory (will be created if needed)' },
		{ name: 'prompt', type: 'string', required: true, description: 'Initial prompt for Claude' },
		{
			name: 'devcontainerOverrides',
			type: 'string',
			required: false,
			description: 'JSON object of devcontainer.json fields to merge with generated config. Protected fields (claude mount, CLAUDE_CONFIG_DIR, claude-code extension, postCreateCommand prefix) are always enforced. Ignored if workspace already has a devcontainer.json.',
		},
		{ name: 'profile', type: 'string', required: false, description: 'Container profile name (from manage-profiles) for environment customization' },
		{ name: 'branch', type: 'boolean', required: false, default: false, description: 'Create and checkout a git branch before starting' },
		{ name: 'branchName', type: 'string', required: false, description: 'Branch name (defaults to agent/<name>)' },
		{ name: 'repoPath', type: 'string', required: false, description: 'Git repo path (required when workspace has multiple repos)' },
	],
	examples: [
		{
			description: 'Create a new agent to work on a feature branch',
			params: { name: 'feature-auth', cwd: './test-space/agent1-sandbox', prompt: 'Implement JWT authentication' },
			response: { success: true, data: { id: 'agent-a1b2c3d4', name: 'feature-auth', cwd: '/abs/test-space/agent1-sandbox', status: 'starting' } },
		},
	],
	async execute(sepSys: SEPSysInterface, params: ActionParams): Promise<ActionResult> {
		const name = params.name as string;
		const cwd = params.cwd as string;
		const prompt = params.prompt as string;

		if (!name || !cwd || !prompt) {
			return { success: false, error: 'Missing required params: name, cwd, prompt' };
		}

		const overridesRaw = params.devcontainerOverrides as string | undefined;
		let devcontainerOverrides: Record<string, unknown> | undefined;
		if (overridesRaw) {
			try {
				const parsed = JSON.parse(overridesRaw);
				if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
					return { success: false, error: 'devcontainerOverrides must be a JSON object' };
				}
				devcontainerOverrides = parsed as Record<string, unknown>;
			} catch (e) {
				return { success: false, error: `devcontainerOverrides is not valid JSON: ${e}` };
			}
		}

		// Generate a unique ID
		const id = `agent-${crypto.randomUUID().slice(0, 8)}`;

		// Ensure workspace directory exists
		const resolvedCwd = resolve(cwd);
		mkdirSync(resolvedCwd, { recursive: true });

		// Optional git branching
		if (params.branch) {
			const branchName = (params.branchName as string) || `agent/${name}`;
			const repoPath = params.repoPath as string | undefined;

			if (repoPath) {
				const resolvedRepo = resolve(repoPath);
				if (!existsSync(resolve(resolvedRepo, '.git'))) {
					return { success: false, error: `Not a git repo: ${resolvedRepo}` };
				}
				const result = sepSys.createGitBranch(resolvedRepo, branchName);
				if (!result.success) {
					return { success: false, error: `Failed to create branch '${branchName}': ${result.error}` };
				}
			} else {
				const repos = sepSys.discoverGitRepos(resolvedCwd);

				if (repos.length === 0) {
					// No repos found — git init + branch
					Bun.spawnSync(['git', 'init', resolvedCwd], { stdout: 'pipe', stderr: 'pipe' });
					const result = sepSys.createGitBranch(resolvedCwd, branchName);
					if (!result.success) {
						return { success: false, error: `Failed to create branch '${branchName}': ${result.error}` };
					}
				} else if (repos.length === 1) {
					const result = sepSys.createGitBranch(repos[0], branchName);
					if (!result.success) {
						return { success: false, error: `Failed to create branch '${branchName}': ${result.error}` };
					}
				} else {
					return {
						success: false,
						error: 'Multiple git repos found in workspace — specify repoPath',
						data: { repos, requiresRepoPath: true },
					};
				}
			}
		}

		const profile = params.profile as string | undefined;

		try {
			await sepSys.createSession({ id, name, cwd: resolvedCwd, prompt, devcontainerOverrides, profile });
			return { success: true, data: { id, name, cwd: resolvedCwd, status: 'starting' } };
		} catch (err) {
			return { success: false, error: `Failed to create agent: ${err}` };
		}
	},
};
