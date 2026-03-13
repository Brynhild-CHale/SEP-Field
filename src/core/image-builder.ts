/**
 * ImageBuilder — Pre-built image caching for fast container starts
 *
 * Generates Dockerfiles from profiles, builds tagged images locally.
 * Single VM = single Docker daemon = single image cache. No registry needed.
 *
 * Flow:
 * 1. Build image from profile → tag as sep-field/<profile>:latest
 * 2. Image is immediately available to all containers (same Docker daemon)
 * 3. ContainerManager checks for pre-built images before container up
 */

import type { ColimaManager } from './colima-manager.ts';
import type { ProfileManager } from './profile-manager.ts';
import type { ContainerProfile, Logger } from '../types/index.ts';

const IMAGE_PREFIX = 'sep-field';

export class ImageBuilder {
	private logger: Logger;
	private colimaManager: ColimaManager;
	private profileManager: ProfileManager;

	constructor(logger: Logger, colimaManager: ColimaManager, profileManager: ProfileManager) {
		this.logger = logger;
		this.colimaManager = colimaManager;
		this.profileManager = profileManager;
	}

	/**
	 * Generate a Dockerfile from a profile (or use defaults).
	 */
	generateDockerfile(profile?: ContainerProfile): string {
		const baseImage = profile?.image || 'mcr.microsoft.com/devcontainers/javascript-node:22';
		const lines: string[] = [
			`FROM ${baseImage}`,
			'',
			'# Pre-install claude-code to skip the 15-30s npm install on container start',
			'RUN npm install -g @anthropic-ai/claude-code || true',
		];

		if (profile?.postCreateCommand) {
			lines.push('');
			lines.push(`# Profile postCreateCommand: ${profile.name}`);
			lines.push(`RUN ${profile.postCreateCommand}`);
		}

		return lines.join('\n') + '\n';
	}

	/**
	 * Build a cached image for a profile (or the default profile).
	 * Requires the Colima VM to be running.
	 */
	async build(profileName?: string): Promise<{ success: boolean; tag: string; error?: string }> {
		const profile = profileName ? this.profileManager.get(profileName) : null;
		const tagName = profileName || 'default';
		const localTag = `${IMAGE_PREFIX}/${tagName}:latest`;

		if (!this.colimaManager.isRunning()) {
			return { success: false, tag: localTag, error: 'VM not running. Wait for pre-warm to complete.' };
		}

		const dockerfile = this.generateDockerfile(profile ?? undefined);
		this.logger.log(`Building image ${localTag}...`);

		// Write Dockerfile to a temp location and build
		const tmpDir = `/tmp/sep-field-build-${tagName}`;
		const mkdirProc = Bun.spawnSync(['mkdir', '-p', tmpDir], { stdout: 'pipe', stderr: 'pipe' });
		if (mkdirProc.exitCode !== 0) {
			return { success: false, tag: localTag, error: 'Failed to create temp build directory' };
		}

		const { writeFileSync } = await import('fs');
		writeFileSync(`${tmpDir}/Dockerfile`, dockerfile);

		const env = this.colimaManager.getDockerEnv();
		const buildProc = Bun.spawn(
			['docker', 'build', '-t', localTag, tmpDir],
			{ env, stdout: 'pipe', stderr: 'pipe' },
		);

		const exitCode = await buildProc.exited;
		const stderr = await new Response(buildProc.stderr).text();

		// Clean up temp dir
		Bun.spawnSync(['rm', '-rf', tmpDir], { stdout: 'pipe', stderr: 'pipe' });

		if (exitCode !== 0) {
			this.logger.error(`Image build failed: ${stderr}`);
			return { success: false, tag: localTag, error: stderr };
		}

		this.logger.log(`Image ${localTag} built successfully`);
		return { success: true, tag: localTag };
	}

	/**
	 * List all cached sep-field images.
	 */
	async list(): Promise<Array<{ tag: string; size: string; created: string }>> {
		const images: Array<{ tag: string; size: string; created: string }> = [];

		const env = this.colimaManager.isRunning()
			? this.colimaManager.getDockerEnv()
			: { ...process.env };

		const result = Bun.spawnSync(
			['docker', 'images', '--format', '{{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}', `${IMAGE_PREFIX}/*`],
			{ env, stdout: 'pipe', stderr: 'pipe' },
		);

		const output = result.stdout.toString().trim();
		if (!output) return images;

		for (const line of output.split('\n')) {
			const [tag, size, created] = line.split('\t');
			if (tag) {
				images.push({ tag, size: size || 'unknown', created: created || 'unknown' });
			}
		}

		return images;
	}

	/**
	 * Remove a cached image.
	 */
	async remove(profileName?: string): Promise<{ success: boolean; error?: string }> {
		const tagName = profileName || 'default';
		const localTag = `${IMAGE_PREFIX}/${tagName}:latest`;

		const env = this.colimaManager.isRunning()
			? this.colimaManager.getDockerEnv()
			: { ...process.env };

		const result = Bun.spawnSync(
			['docker', 'rmi', '-f', localTag],
			{ env, stdout: 'pipe', stderr: 'pipe' },
		);

		if (result.exitCode === 0) {
			this.logger.log(`Image ${localTag} removed`);
			return { success: true };
		}

		return { success: false, error: `Image ${localTag} not found` };
	}

	/**
	 * Check if a pre-built image exists for a profile.
	 * No agentId needed — single VM, single Docker daemon.
	 */
	imageExists(profileName?: string): boolean {
		const tagName = profileName || 'default';
		const localTag = `${IMAGE_PREFIX}/${tagName}:latest`;
		const env = this.colimaManager.getDockerEnv();

		const result = Bun.spawnSync(
			['docker', 'image', 'inspect', localTag],
			{ env, stdout: 'pipe', stderr: 'pipe' },
		);

		return result.exitCode === 0;
	}

	/**
	 * Get the image tag for a profile.
	 */
	getImageTag(profileName?: string): string {
		const tagName = profileName || 'default';
		return `${IMAGE_PREFIX}/${tagName}:latest`;
	}
}
