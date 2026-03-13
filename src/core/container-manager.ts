/**
 * ContainerManager — devcontainer lifecycle management
 *
 * Handles sandbox setup, devcontainer up/down/exec, and docker cleanup.
 * Now routes all Docker/devcontainer commands through the correct Colima
 * instance via DOCKER_HOST, and uses semaphores for concurrency control.
 */

import { resolve, basename, relative } from 'path';
import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, readdirSync, lstatSync, realpathSync, unlinkSync } from 'fs';
import type { ColimaManager } from './colima-manager.ts';
import { Semaphore } from './semaphore.ts';
import { CONFIG_PATH } from '../service/paths.ts';
import type { Logger } from '../types/index.ts';

const DEFAULT_CLAUDE_COPY_EXCLUDES = [
	'projects',
	'debug',
	'telemetry',
	'shell-snapshots',
	'file-history',
	'todos',
	'history.jsonl',
	'plans',
	'tasks',
	'paste-cache',
	'backups',
	'cache',
	'session-env',
	'sessions',
	'statsig',
	'chrome',
	'ide',
	'stats-cache.json',
	'statusline-command.sh',
	'.DS_Store',
	'plugins',
];

function applyDevcontainerOverrides(
	base: Record<string, unknown>,
	overrides: Record<string, unknown>,
	skipClaudeInstall = false,
): Record<string, unknown> {
	// Scalar fields: overrides win (image, postStartCommand, etc.)
	const merged: Record<string, unknown> = { ...base, ...overrides };

	// PROTECTED: name is always the session ID
	merged.name = base.name;

	// PROTECTED: mounts — claude bind mount always first; user mounts appended
	const claudeMount = (base.mounts as unknown[])[0];
	const symlinkMounts = (base.mounts as unknown[]).slice(1);
	const userMounts = Array.isArray(overrides.mounts) ? overrides.mounts : [];
	merged.mounts = [claudeMount, ...symlinkMounts, ...userMounts];

	// PROTECTED: remoteEnv — always re-assert CLAUDE_CONFIG_DIR
	const userEnv = (typeof overrides.remoteEnv === 'object' && overrides.remoteEnv !== null)
		? overrides.remoteEnv as Record<string, unknown> : {};
	merged.remoteEnv = { ...(base.remoteEnv as object), ...userEnv, CLAUDE_CONFIG_DIR: '/home/node/.claude-host' };

	// PROTECTED: vscode extensions — always include anthropic.claude-code
	const userCustom = (typeof overrides.customizations === 'object' && overrides.customizations !== null)
		? overrides.customizations as Record<string, unknown> : {};
	const userVscode = (typeof userCustom.vscode === 'object' && userCustom.vscode !== null)
		? userCustom.vscode as Record<string, unknown> : {};
	const userExts = Array.isArray(userVscode.extensions) ? userVscode.extensions as string[] : [];
	merged.customizations = {
		...userCustom,
		vscode: { ...userVscode, extensions: [...new Set(['anthropic.claude-code', ...userExts])] },
	};

	// PROTECTED: postCreateCommand — skip claude install if using pre-built image
	if (skipClaudeInstall) {
		const userPost = typeof overrides.postCreateCommand === 'string' ? overrides.postCreateCommand.trim() : '';
		merged.postCreateCommand = userPost.length > 0 ? userPost : 'true';
	} else {
		const CLAUDE_INSTALL = 'npm install -g @anthropic-ai/claude-code || true';
		const userPost = typeof overrides.postCreateCommand === 'string' ? overrides.postCreateCommand.trim() : '';
		merged.postCreateCommand = userPost.length > 0 ? `${CLAUDE_INSTALL} && ${userPost}` : CLAUDE_INSTALL;
	}

	// PROTECTED: features — skip entirely when using pre-built image,
	// otherwise additive merge (user features added on top of node:22)
	if (skipClaudeInstall) {
		// Pre-built image already has everything — only include user-specified features
		const userFeatures = (typeof overrides.features === 'object' && overrides.features !== null)
			? overrides.features as Record<string, unknown> : {};
		if (Object.keys(userFeatures).length > 0) {
			merged.features = userFeatures;
		} else {
			delete merged.features;
		}
	} else {
		const userFeatures = (typeof overrides.features === 'object' && overrides.features !== null)
			? overrides.features as Record<string, unknown> : {};
		merged.features = { ...(base.features as object), ...userFeatures };
	}

	return merged;
}

export class ContainerManager {
	private logger: Logger;
	private colimaManager: ColimaManager;
	private containerUpSemaphore: Semaphore;
	private claudeJsonMutex: Semaphore;

	constructor(logger: Logger, colimaManager: ColimaManager, containerUpSemaphore: Semaphore) {
		this.logger = logger;
		this.colimaManager = colimaManager;
		this.containerUpSemaphore = containerUpSemaphore;
		this.claudeJsonMutex = new Semaphore(1);
	}

	/**
	 * Get env with DOCKER_HOST for the single VM.
	 */
	private getEnv(): Record<string, string | undefined> {
		return this.colimaManager.getDockerEnv();
	}

	/**
	 * Patch host ~/.claude/.claude.json with onboarding bypass and copy settings to sandbox.
	 * Uses mutex to prevent concurrent read-modify-write corruption.
	 */
	async writeClaudeSettings(sandboxDir: string): Promise<void> {
		const hostClaudeDir = resolve(process.env.HOME || '', '.claude');
		const claudeDir = resolve(sandboxDir, '.claude');

		if (!existsSync(hostClaudeDir)) {
			this.logger.error(`Host ~/.claude/ not found at ${hostClaudeDir}`);
			return;
		}

		// Patch the HOST's .claude.json with onboarding bypass + workspace trust
		// Protected by mutex to prevent lost-update race condition
		const hostClaudeJsonPath = resolve(hostClaudeDir, '.claude.json');
		await this.claudeJsonMutex.run(async () => {
			try {
				const hostData = existsSync(hostClaudeJsonPath)
					? JSON.parse(readFileSync(hostClaudeJsonPath, 'utf8'))
					: {};
				let dirty = false;

				if (!hostData.hasCompletedOnboarding) {
					hostData.hasCompletedOnboarding = true;
					hostData.lastOnboardingVersion = '2.1.50';
					dirty = true;
					this.logger.log('Patched host ~/.claude/.claude.json with onboarding bypass');
				}

				// Pre-accept workspace trust dialog for the container workspace path
				const containerWorkspacePath = `/workspaces/${basename(sandboxDir)}`;
				if (!hostData.projects) hostData.projects = {};
				const proj = hostData.projects[containerWorkspacePath] || {};
				if (!proj.hasTrustDialogAccepted) {
					proj.hasTrustDialogAccepted = true;
					proj.hasClaudeMdExternalIncludesApproved = true;
					hostData.projects[containerWorkspacePath] = proj;
					dirty = true;
					this.logger.log(`Pre-accepted workspace trust for ${containerWorkspacePath}`);
				}

				if (dirty) {
					writeFileSync(hostClaudeJsonPath, JSON.stringify(hostData, null, '  ') + '\n');
				}
			} catch (err) {
				this.logger.error(`Failed to patch host .claude.json: ${err}`);
			}
		});

		// Copy ~/.claude/ into the sandbox workspace (outside mutex — file-per-sandbox, no conflict)
		// Use exclude list to skip large directories agents don't need (~625 MB → ~57 KB)
		let excludes: Set<string>;
		try {
			if (existsSync(CONFIG_PATH)) {
				const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
				if (Array.isArray(raw?.claudeCopyExcludes)) {
					excludes = new Set(raw.claudeCopyExcludes);
				} else {
					excludes = new Set(DEFAULT_CLAUDE_COPY_EXCLUDES);
				}
			} else {
				excludes = new Set(DEFAULT_CLAUDE_COPY_EXCLUDES);
			}
		} catch {
			excludes = new Set(DEFAULT_CLAUDE_COPY_EXCLUDES);
		}

		try {
			cpSync(hostClaudeDir, claudeDir, {
				recursive: true,
				filter: (src) => {
					const rel = relative(hostClaudeDir, src);
					if (rel === '') return true;
					const topLevel = rel.split('/')[0];
					return !excludes.has(topLevel);
				},
			});
		} catch (err) {
			this.logger.log(`Warning: partial copy of ~/.claude/ (some files unreadable): ${err}`);
		}

		this.logger.log(`Copied ~/.claude/ to ${claudeDir} (excluded ${excludes.size} entries)`);
	}

	/**
	 * Scan top-level entries in sandbox dir for symlinks.
	 * Each symlink is resolved to a bind mount, then removed.
	 * Returns mount entries for use in devcontainer.json.
	 */
	processSymlinks(sandboxDir: string): { source: string; target: string; type: 'bind' }[] {
		const mounts: { source: string; target: string; type: 'bind' }[] = [];
		const containerBase = `/workspaces/${basename(sandboxDir)}`;

		let entries: string[];
		try {
			entries = readdirSync(sandboxDir);
		} catch {
			return mounts;
		}

		for (const entry of entries) {
			const fullPath = resolve(sandboxDir, entry);
			try {
				if (!lstatSync(fullPath).isSymbolicLink()) continue;
			} catch {
				continue;
			}

			let realPath: string;
			try {
				realPath = realpathSync(fullPath);
			} catch {
				this.logger.log(`Warning: dangling symlink ${entry}, removing`);
				unlinkSync(fullPath);
				continue;
			}

			const target = `${containerBase}/${entry}`;
			mounts.push({ source: realPath, target, type: 'bind' });
			unlinkSync(fullPath);
			this.logger.log(`Symlink mount: ${entry} -> ${realPath}`);
		}

		return mounts;
	}

	/**
	 * Generate .devcontainer/devcontainer.json for a sandbox.
	 * Includes container resource limits (runArgs).
	 * When skipClaudeInstall is true, postCreateCommand skips npm install
	 * (used when a pre-built image already has claude-code installed).
	 */
	writeDevcontainerJson(
		sandboxDir: string,
		name: string,
		extraMounts?: { source: string; target: string; type: string }[],
		overrides?: Record<string, unknown>,
		skipClaudeInstall = false,
	): void {
		const devcontainerDir = resolve(sandboxDir, '.devcontainer');
		mkdirSync(devcontainerDir, { recursive: true });

		// When using a pre-built image (skipClaudeInstall), skip features too —
		// they're already baked into the image. This avoids the ~40s devcontainer
		// "derived image" rebuild on first container creation.
		let config: Record<string, unknown> = {
			name,
			image: 'mcr.microsoft.com/devcontainers/javascript-node:22',
			runArgs: ['--memory=1g', '--cpus=1'],
			mounts: [
				{
					source: '${localEnv:HOME}/.claude',
					target: '/home/node/.claude-host',
					type: 'bind',
					consistency: 'cached',
				},
				...(extraMounts || []),
			],
			customizations: {
				vscode: {
					extensions: ['anthropic.claude-code'],
				},
			},
			remoteEnv: {
				CLAUDE_CONFIG_DIR: '/home/node/.claude-host',
			},
			...(!skipClaudeInstall ? {
				features: {
					'ghcr.io/devcontainers/features/node:1': {
						version: '22',
					},
				},
			} : {}),
			postCreateCommand: skipClaudeInstall ? 'true' : 'npm install -g @anthropic-ai/claude-code || true',
			postStartCommand: 'true',
		};

		if (overrides) {
			config = applyDevcontainerOverrides(config, overrides, skipClaudeInstall);
		}

		writeFileSync(
			resolve(devcontainerDir, 'devcontainer.json'),
			JSON.stringify(config, null, '\t') + '\n',
		);
		this.logger.log(`Wrote devcontainer.json for ${name} at ${devcontainerDir}`);
	}

	/**
	 * Check whether a devcontainer.json already exists in the sandbox.
	 */
	hasExistingDevcontainerJson(sandboxDir: string): boolean {
		return existsSync(resolve(sandboxDir, '.devcontainer', 'devcontainer.json'));
	}

	/**
	 * Build the command array for spawning /bin/bash inside a container.
	 */
	buildShellCommand(workspaceFolder: string): string[] {
		return ['devcontainer', 'exec', '--workspace-folder', workspaceFolder, '--', '/bin/bash'];
	}

	/**
	 * Initialize a git repo in the sandbox if not already present.
	 */
	initGitRepo(sandboxDir: string): void {
		const gitDir = resolve(sandboxDir, '.git');
		if (!existsSync(gitDir)) {
			Bun.spawnSync(['git', 'init', sandboxDir], { stdout: 'pipe', stderr: 'pipe' });
			this.logger.log(`Initialized git repo in ${sandboxDir}`);
		}
	}

	/**
	 * Discover git repos in a workspace directory.
	 * Checks root for .git, then scans one level deep (skipping known non-repo dirs).
	 * Returns absolute paths of directories containing .git.
	 */
	discoverGitRepos(workspaceDir: string): string[] {
		const repos: string[] = [];
		const SKIP = new Set(['.devcontainer', '.claude', 'node_modules', '.git']);

		// Check root
		if (existsSync(resolve(workspaceDir, '.git'))) {
			repos.push(workspaceDir);
		}

		// Scan one level deep
		let entries: string[];
		try {
			entries = readdirSync(workspaceDir);
		} catch {
			return repos;
		}

		for (const entry of entries) {
			if (SKIP.has(entry)) continue;
			const fullPath = resolve(workspaceDir, entry);
			try {
				if (!lstatSync(fullPath).isDirectory()) continue;
			} catch {
				continue;
			}
			if (existsSync(resolve(fullPath, '.git'))) {
				repos.push(fullPath);
			}
		}

		return repos;
	}

	/**
	 * Create and checkout a new git branch in the given repo directory.
	 * Handles empty repos by creating an initial commit first.
	 */
	createGitBranch(repoDir: string, branchName: string): { success: boolean; error?: string } {
		// Handle empty repo: if git log fails, there are no commits yet
		const logResult = Bun.spawnSync(['git', 'log', '--oneline', '-1'], {
			cwd: repoDir, stdout: 'pipe', stderr: 'pipe',
		});
		if (logResult.exitCode !== 0) {
			const initCommit = Bun.spawnSync(
				['git', 'commit', '--allow-empty', '-m', 'Initial commit'],
				{ cwd: repoDir, stdout: 'pipe', stderr: 'pipe' },
			);
			if (initCommit.exitCode !== 0) {
				return { success: false, error: `Failed to create initial commit: ${initCommit.stderr.toString()}` };
			}
			this.logger.log(`Created initial commit in empty repo ${repoDir}`);
		}

		const checkout = Bun.spawnSync(['git', 'checkout', '-b', branchName], {
			cwd: repoDir, stdout: 'pipe', stderr: 'pipe',
		});
		if (checkout.exitCode !== 0) {
			return { success: false, error: checkout.stderr.toString().trim() };
		}

		this.logger.log(`Created branch '${branchName}' in ${repoDir}`);
		return { success: true };
	}

	/**
	 * Run `devcontainer up` for a workspace folder (sync).
	 */
	containerUp(workspaceFolder: string): { success: boolean; stderr: string; stdout: string; exitCode: number } {
		this.logger.log(`Starting container for ${workspaceFolder}...`);
		const up = Bun.spawnSync(['devcontainer', 'up', '--workspace-folder', workspaceFolder], {
			env: this.getEnv(),
			stdout: 'pipe',
			stderr: 'pipe',
		});

		const stderr = up.stderr.toString();
		const stdout = up.stdout.toString();
		const exitCode = up.exitCode ?? 1;

		if (exitCode !== 0) {
			this.logger.error(`Container failed for ${workspaceFolder}: ${stderr}${stdout}`);
		} else {
			this.logger.log(`Container ready for ${workspaceFolder}`);
		}

		return { success: exitCode === 0, stderr, stdout, exitCode };
	}

	/**
	 * Run `devcontainer up` asynchronously (non-blocking).
	 * Wrapped in concurrency semaphore to prevent thundering herd.
	 */
	async containerUpAsync(workspaceFolder: string): Promise<{ success: boolean; stderr: string; stdout: string; exitCode: number }> {
		return this.containerUpSemaphore.run(async () => {
			this.logger.log(`Starting container for ${workspaceFolder} (async)...`);
			const proc = Bun.spawn(['devcontainer', 'up', '--workspace-folder', workspaceFolder], {
				env: this.getEnv(),
				stdout: 'pipe',
				stderr: 'pipe',
			});

			const exitCode = await proc.exited;
			const stderr = await new Response(proc.stderr).text();
			const stdout = await new Response(proc.stdout).text();

			if (exitCode !== 0) {
				this.logger.error(`Container failed for ${workspaceFolder}: ${stderr}${stdout}`);
			} else {
				this.logger.log(`Container ready for ${workspaceFolder}`);
			}

			return { success: exitCode === 0, stderr, stdout, exitCode };
		});
	}

	/**
	 * Check if a running container already exists for a workspace folder.
	 * Returns the container ID if found, null otherwise.
	 */
	findExistingContainer(workspaceFolder: string): string | null {
		this.logger.log(`Looking for existing container with label devcontainer.local_folder=${workspaceFolder}`);
		const result = Bun.spawnSync(
			['docker', 'ps', '-q', '--filter', `label=devcontainer.local_folder=${workspaceFolder}`],
			{ env: this.getEnv(), stdout: 'pipe', stderr: 'pipe' },
		);
		const containerId = result.stdout.toString().trim();
		const stderr = result.stderr.toString().trim();
		if (stderr) {
			this.logger.error(`docker ps stderr: ${stderr}`);
		}
		if (containerId) {
			this.logger.log(`Found existing container: ${containerId}`);
		} else {
			this.logger.log(`No existing container found for ${workspaceFolder}`);
		}
		return containerId || null;
	}

	/**
	 * Build the command array for spawning claude inside a container.
	 */
	buildClaudeCommand(workspaceFolder: string, prompt?: string): string[] {
		const cmd = [
			'devcontainer', 'exec',
			'--workspace-folder', workspaceFolder,
			'--',
			'claude', '--dangerously-skip-permissions',
		];
		if (prompt) cmd.push(prompt);
		return cmd;
	}

	/**
	 * Build the command array for resuming claude with --continue inside an existing container.
	 */
	buildClaudeContinueCommand(workspaceFolder: string): string[] {
		return [
			'devcontainer', 'exec',
			'--workspace-folder', workspaceFolder,
			'--',
			'claude', '--dangerously-skip-permissions', '--continue',
		];
	}

	/**
	 * Discover all running devcontainers on the single VM.
	 * Returns a list of { containerId, workspaceFolder } for each running container.
	 */
	discoverOrphanedContainers(): { containerId: string; workspaceFolder: string }[] {
		this.logger.log('Scanning for orphaned devcontainers...');
		const allContainers: { containerId: string; workspaceFolder: string }[] = [];

		const env = this.colimaManager.isRunning()
			? this.colimaManager.getDockerEnv()
			: { ...process.env };

		const result = Bun.spawnSync(
			['docker', 'ps', '-q', '--filter', 'label=devcontainer.local_folder'],
			{ env, stdout: 'pipe', stderr: 'pipe' },
		);
		const ids = result.stdout.toString().trim().split('\n').filter(Boolean);

		for (const id of ids) {
			const inspect = Bun.spawnSync(
				['docker', 'inspect', '--format', '{{index .Config.Labels "devcontainer.local_folder"}}', id],
				{ env, stdout: 'pipe', stderr: 'pipe' },
			);
			const folder = inspect.stdout.toString().trim();
			if (folder) {
				this.logger.log(`Found orphaned container ${id.slice(0, 12)} → ${folder}`);
				allContainers.push({ containerId: id, workspaceFolder: folder });
			}
		}

		this.logger.log(`Discovered ${allContainers.length} orphaned container(s)`);
		return allContainers;
	}

	/**
	 * Remove container(s) associated with a workspace folder.
	 */
	removeContainer(workspaceFolder: string): void {
		const find = Bun.spawnSync(
			['docker', 'ps', '-q', '-a', '--filter', `label=devcontainer.local_folder=${workspaceFolder}`],
			{ env: this.getEnv(), stdout: 'pipe', stderr: 'pipe' },
		);
		const containerId = find.stdout.toString().trim();
		if (!containerId) {
			this.logger.log(`No container found for ${workspaceFolder}`);
			return;
		}
		const rm = Bun.spawnSync(
			['docker', 'rm', '-f', containerId],
			{ env: this.getEnv(), stdout: 'pipe', stderr: 'pipe' },
		);
		if (rm.exitCode !== 0) {
			this.logger.error(`docker rm failed for ${workspaceFolder}: ${rm.stderr.toString()}`);
		} else {
			this.logger.log(`Container removed for ${workspaceFolder}`);
		}
	}

	/**
	 * Remove containers for multiple workspace folders.
	 */
	async removeAllContainers(workspaceFolders: string[]): Promise<void> {
		this.logger.log('Tearing down containers...');
		await Promise.all(
			workspaceFolders.map((cwd) => {
				this.removeContainer(cwd);
				return Promise.resolve();
			}),
		);
	}
}
