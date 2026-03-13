/**
 * Action: manage-profiles — CRUD for container profiles
 */

import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';
import { ProfileManager } from '../core/profile-manager.ts';

// ProfileManager is instantiated once and shared — the action needs its own
// since actions don't have direct access to core managers.
let profileManager: ProfileManager | null = null;

function getProfileManager(): ProfileManager {
	if (!profileManager) {
		const logger = { log: () => {}, error: () => {} };
		profileManager = new ProfileManager(logger);
	}
	return profileManager;
}

export const action: Action = {
	name: 'manage-profiles',
	description: 'Manage container profiles (list, get, create, delete)',
	category: 'tooling',
	params: [
		{
			name: 'command',
			type: 'select',
			required: true,
			description: 'Operation to perform',
			options: [
				{ value: 'list', label: 'List all profiles' },
				{ value: 'get', label: 'Get a profile' },
				{ value: 'create', label: 'Create/update a profile' },
				{ value: 'delete', label: 'Delete a profile' },
			],
		},
		{ name: 'name', type: 'string', required: false, description: 'Profile name (required for get/create/delete)' },
		{ name: 'description', type: 'string', required: false, description: 'Profile description (for create)' },
		{ name: 'image', type: 'string', required: false, description: 'Docker image override (for create)' },
		{ name: 'postCreateCommand', type: 'string', required: false, description: 'Command to run after claude-code install (for create)' },
		{ name: 'runArgs', type: 'string', required: false, description: 'JSON array of Docker run args (for create)' },
		{ name: 'features', type: 'string', required: false, description: 'JSON object of devcontainer features (for create)' },
		{ name: 'mounts', type: 'string', required: false, description: 'JSON array of mount objects (for create)' },
		{ name: 'remoteEnv', type: 'string', required: false, description: 'JSON object of remote environment variables (for create)' },
	],
	examples: [
		{
			description: 'List all profiles',
			params: { command: 'list' },
		},
		{
			description: 'Create a Python profile',
			params: {
				command: 'create',
				name: 'python',
				description: 'Python development environment',
				image: 'mcr.microsoft.com/devcontainers/python:3.12',
				postCreateCommand: 'pip install pytest',
			},
		},
	],
	async execute(_sepSys: SEPSysInterface, params: ActionParams): Promise<ActionResult> {
		const command = params.command as string;
		const pm = getProfileManager();

		switch (command) {
			case 'list': {
				const profiles = pm.list();
				return {
					success: true,
					data: profiles.map(p => ({ name: p.name, description: p.description })),
				};
			}

			case 'get': {
				const name = params.name as string;
				if (!name) return { success: false, error: 'name is required for get' };
				const profile = pm.get(name);
				if (!profile) return { success: false, error: `Profile '${name}' not found` };
				return { success: true, data: profile };
			}

			case 'create': {
				const name = params.name as string;
				if (!name) return { success: false, error: 'name is required for create' };
				const description = (params.description as string) || '';

				const profile: Record<string, unknown> = { name, description };

				if (params.image) profile.image = params.image;
				if (params.postCreateCommand) profile.postCreateCommand = params.postCreateCommand;

				// Parse JSON fields
				for (const field of ['runArgs', 'features', 'mounts', 'remoteEnv'] as const) {
					if (params[field]) {
						try {
							profile[field] = JSON.parse(params[field] as string);
						} catch (e) {
							return { success: false, error: `Invalid JSON for ${field}: ${e}` };
						}
					}
				}

				pm.save(profile as any);
				return { success: true, data: { name, status: 'saved' } };
			}

			case 'delete': {
				const name = params.name as string;
				if (!name) return { success: false, error: 'name is required for delete' };
				const deleted = pm.delete(name);
				if (!deleted) return { success: false, error: `Profile '${name}' not found` };
				return { success: true, data: { name, status: 'deleted' } };
			}

			default:
				return { success: false, error: `Unknown command: ${command}` };
		}
	},
};
