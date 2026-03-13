/**
 * Action: manage-cache — Build, list, and remove cached container images
 *
 * Delegates to SEPSysInterface methods which route to the shared
 * ImageBuilder instance (same VM, same Docker daemon).
 */

import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
	name: 'manage-cache',
	description: 'Build, list, and remove cached container images for faster startup',
	category: 'tooling',
	params: [
		{
			name: 'command',
			type: 'select',
			required: true,
			description: 'Operation to perform',
			options: [
				{ value: 'build', label: 'Build a cached image' },
				{ value: 'list', label: 'List cached images' },
				{ value: 'remove', label: 'Remove a cached image' },
			],
		},
		{
			name: 'profile',
			type: 'string',
			required: false,
			description: 'Profile name to build/remove (omit for default image)',
		},
	],
	examples: [
		{
			description: 'Build the default cached image',
			params: { command: 'build' },
		},
		{
			description: 'Build a cached image for a Python profile',
			params: { command: 'build', profile: 'python' },
		},
		{
			description: 'List all cached images',
			params: { command: 'list' },
		},
	],
	async execute(sepSys: SEPSysInterface, params: ActionParams): Promise<ActionResult> {
		const command = params.command as string;

		switch (command) {
			case 'build': {
				const profile = params.profile as string | undefined;
				const result = await sepSys.buildImage(profile);
				if (!result.success) {
					return { success: false, error: result.error };
				}
				return { success: true, data: { tag: result.tag, status: 'built' } };
			}

			case 'list': {
				const images = await sepSys.listImages();
				return { success: true, data: images };
			}

			case 'remove': {
				const profile = params.profile as string | undefined;
				const result = await sepSys.removeImage(profile);
				if (!result.success) {
					return { success: false, error: result.error };
				}
				return { success: true, data: { status: 'removed' } };
			}

			default:
				return { success: false, error: `Unknown command: ${command}` };
		}
	},
};
