/**
 * SEPSys — orchestration hub
 *
 * Owns the sessions Map, coordinates core modules (ContainerManager, PtyManager,
 * StatePoller, ColimaManager, ImageBuilder), and emits events for transport layers.
 */

import { Terminal as XtermTerminal } from '@xterm/headless';
import type {
	AgentConfig,
	ManagedSession,
	SessionInfo,
	SEPSysInterface,
	SessionEvent,
	SessionEventHandler,
	DataCallback,
	Logger,
} from '../types/index.ts';
import { ContainerManager } from './container-manager.ts';
import { PtyManager } from './pty-manager.ts';
import { StatePoller } from './state-detector.ts';
import type { ColimaManager } from './colima-manager.ts';
import type { ProfileManager } from './profile-manager.ts';
import type { ImageBuilder } from './image-builder.ts';

/** Threshold above which state polling slows down to reduce CPU. */
const SLOW_POLL_THRESHOLD = 4;
const SLOW_POLL_INTERVAL_MS = 250;

export class SEPSys implements SEPSysInterface {
	private sessions = new Map<string, ManagedSession>();
	private eventHandlers: SessionEventHandler[] = [];
	private dataCallback: DataCallback | null = null;
	private statePollers = new Map<string, StatePoller>();
	private containerManager: ContainerManager;
	private ptyManager: PtyManager;
	private colimaManager: ColimaManager;
	private profileManager: ProfileManager;
	private imageBuilder: ImageBuilder;
	private logger: Logger;

	constructor(
		containerManager: ContainerManager,
		ptyManager: PtyManager,
		colimaManager: ColimaManager,
		profileManager: ProfileManager,
		imageBuilder: ImageBuilder,
		logger: Logger,
	) {
		this.containerManager = containerManager;
		this.ptyManager = ptyManager;
		this.colimaManager = colimaManager;
		this.profileManager = profileManager;
		this.imageBuilder = imageBuilder;
		this.logger = logger;
	}

	/** Set the callback that receives PTY output data. */
	setDataHandler(callback: DataCallback): void {
		this.dataCallback = callback;
		this.ptyManager.setDataCallback(callback);
	}

	/** Register an event listener. */
	onEvent(handler: SessionEventHandler): void {
		this.eventHandlers.push(handler);
	}

	private emit(event: SessionEvent): void {
		for (const handler of this.eventHandlers) {
			try {
				handler(event);
			} catch (err) {
				this.logger.error(`Event handler error: ${err}`);
			}
		}
	}

	/** Current state poll interval based on session count. */
	private getPollInterval(): number | undefined {
		return this.sessions.size > SLOW_POLL_THRESHOLD ? SLOW_POLL_INTERVAL_MS : undefined;
	}

	/** Create a new agent session: immediately adds a placeholder, then sets up container in background. */
	async createSession(config: AgentConfig): Promise<void> {
		this.logger.log(`Creating session ${config.id} (${config.name})...`);

		const cols = parseInt(process.env.COLUMNS || '80', 10);
		const rows = parseInt(process.env.LINES || '24', 10);

		// Phase 1: Create placeholder session immediately
		const session: ManagedSession = {
			id: config.id,
			name: config.name,
			cwd: config.cwd,
			prompt: config.prompt,
			terminal: null,
			subprocess: null,
			outputHistory: [],
			historySize: 0,
			decoder: new TextDecoder('utf-8'),
			dataBuffer: '',
			syncOutputMode: false,
			flushTimer: null,
			exited: false,
			exitCode: null,
			starting: true,
			startError: null,
			xtermTerminal: new XtermTerminal({ cols, rows, allowProposedApi: true }),
			agentState: 'busy',
			pendingAgentState: null,
			pendingAgentStateStart: 0,
			stateCheckInterval: null,
			sessionType: 'claude',
		};

		this.sessions.set(config.id, session);
		this.emit({ type: 'session-created', sessionId: config.id });
		this.emit({ type: 'session-list-changed', sessionId: config.id });

		// Phase 2: Initialize container in background (fire and forget)
		this.initializeSessionBackground(config, session, cols, rows);
	}

	/** Background initialization: ensure VM ready, container up, spawn claude or shell, start polling. */
	private async initializeSessionBackground(
		config: AgentConfig,
		session: ManagedSession,
		cols: number,
		rows: number,
	): Promise<void> {
		try {
			// 0. Detect shell mode before anything else
			const isShell = this.containerManager.hasExistingDevcontainerJson(config.cwd);
			session.sessionType = isShell ? 'shell' : 'claude';

			// 0b. Resolve profile overrides if specified
			let overrides = config.devcontainerOverrides;
			if (config.profile) {
				const profileOverrides = this.profileManager.profileToOverrides(config.profile);
				if (profileOverrides) {
					overrides = overrides
						? { ...profileOverrides, ...overrides }
						: profileOverrides;
					this.logger.log(`Applied profile '${config.profile}' to session ${config.id}`);
				} else {
					this.logger.log(`Profile '${config.profile}' not found, ignoring`);
				}
			}

			// 1. Wait for VM + do host prep in parallel
			// Host prep (claude settings, symlinks, git) runs concurrently with VM readiness
			const hostPrepPromise = isShell
				? Promise.resolve({ symlinkMounts: [] as { source: string; target: string; type: 'bind' }[] })
				: (async () => {
					const [, symlinkMounts] = await Promise.all([
						this.containerManager.writeClaudeSettings(config.cwd),
						Promise.resolve(this.containerManager.processSymlinks(config.cwd)),
						Promise.resolve(this.containerManager.initGitRepo(config.cwd)),
					]);
					return { symlinkMounts };
				})();

			const vmReadyPromise = this.colimaManager.ensureReady();

			const [hostPrep] = await Promise.all([hostPrepPromise, vmReadyPromise]);
			this.logger.log(`VM ready and host prep complete for ${config.id}`);

			// Guard: session may have been removed while we awaited
			if (!this.sessions.has(config.id)) {
				this.logger.log(`Session ${config.id} was removed during VM/host prep, aborting init`);
				return;
			}

			// 2. Check for existing container (adoption) and cached image
			const existingContainer = this.containerManager.findExistingContainer(config.cwd);
			const adopting = !!existingContainer;

			if (adopting) {
				this.logger.log(`Found existing container ${existingContainer} for ${config.id} — adopting with --continue`);
			}

			// 3. Check for cached image and set up devcontainer.json
			let skipClaudeInstall = false;
			if (!isShell) {
				const profileForImage = config.profile || undefined;
				if (this.imageBuilder.imageExists(profileForImage)) {
					const imageTag = this.imageBuilder.getImageTag(profileForImage);
					this.logger.log(`Using cached image ${imageTag} for ${config.id}`);
					// Set image override so devcontainer uses the pre-built image
					overrides = { ...overrides, image: imageTag };
					skipClaudeInstall = true;
				}

				this.containerManager.writeDevcontainerJson(
					config.cwd, config.id, hostPrep.symlinkMounts, overrides, skipClaudeInstall,
				);
			} else {
				// Shell mode — just init git
				this.containerManager.initGitRepo(config.cwd);
			}

			if (isShell) {
				// SHELL PATH — use user's devcontainer.json, spawn /bin/bash
				this.logger.log(`Session ${config.id} is shell mode (pre-existing devcontainer.json)`);

				const upResult = await this.containerManager.containerUpAsync(config.cwd);

				if (!this.sessions.has(config.id)) {
					this.logger.log(`Session ${config.id} was removed during startup, aborting init`);
					return;
				}

				if (!upResult.success) {
					session.starting = false;
					session.exited = true;
					session.exitCode = upResult.exitCode;
					session.startError = upResult.stderr;
					session.agentState = 'complete';
					session.outputHistory.push(Buffer.from(`Container startup failed:\n${upResult.stderr}`));
					this.emit({ type: 'session-exited', sessionId: config.id, data: { exitCode: upResult.exitCode } });
					this.emit({ type: 'session-list-changed', sessionId: config.id });
					return;
				}

				const terminal = this.ptyManager.createTerminal(session, cols, rows);
				session.terminal = terminal;

				const cmd = this.containerManager.buildShellCommand(config.cwd);
				const subprocess = Bun.spawn(cmd, {
					env: { ...this.colimaManager.getDockerEnv(), TERM: 'xterm-256color' },
					terminal,
				});

				session.subprocess = subprocess;
				session.starting = false;
				session.agentState = 'idle';

				this.logger.log(`Shell session ${config.id} spawned (PID: ${subprocess.pid})`);

				this.emit({ type: 'session-list-changed', sessionId: config.id });

				subprocess.exited.then((exitCode) => {
					this.logger.log(`Shell session ${config.id} exited with code ${exitCode}`);
					session.exited = true;
					session.exitCode = exitCode ?? null;
					session.agentState = 'complete';

					if (session.flushTimer) {
						clearTimeout(session.flushTimer);
						session.flushTimer = null;
					}
					session.syncOutputMode = false;
					this.ptyManager.flushBuffer(session);

					this.emit({ type: 'session-exited', sessionId: config.id, data: { exitCode } });
					this.emit({ type: 'session-list-changed', sessionId: config.id });
				});
			} else {
				// CLAUDE PATH

				// 4. devcontainer up (async — does not block event loop)
				const upResult = await this.containerManager.containerUpAsync(config.cwd);

				// Guard: session may have been removed while we awaited
				if (!this.sessions.has(config.id)) {
					this.logger.log(`Session ${config.id} was removed during startup, aborting init`);
					return;
				}

				if (!upResult.success) {
					session.starting = false;
					session.exited = true;
					session.exitCode = upResult.exitCode;
					session.startError = upResult.stderr;
					session.agentState = 'complete';
					session.outputHistory.push(Buffer.from(`Container startup failed:\n${upResult.stderr}`));
					this.emit({ type: 'session-exited', sessionId: config.id, data: { exitCode: upResult.exitCode } });
					this.emit({ type: 'session-list-changed', sessionId: config.id });
					return;
				}

				// 5. Create terminal
				const terminal = this.ptyManager.createTerminal(session, cols, rows);
				session.terminal = terminal;

				// 6. Spawn PTY via devcontainer exec — use --continue when adopting an existing container
				const cmd = adopting
					? this.containerManager.buildClaudeContinueCommand(config.cwd)
					: this.containerManager.buildClaudeCommand(config.cwd, config.prompt);

				if (adopting) {
					this.logger.log(`Resuming ${config.id} with claude --continue`);
				}

				const subprocess = Bun.spawn(cmd, {
					env: { ...this.colimaManager.getDockerEnv(), TERM: 'xterm-256color' },
					terminal,
				});

				session.subprocess = subprocess;
				session.starting = false;

				this.logger.log(`Agent ${config.id} spawned (PID: ${subprocess.pid})`);

				// 7. Start state detection polling (dynamic interval)
				const poller = new StatePoller(this.logger);
				poller.start(session, (sessionId, _prev, _next) => {
					this.emit({ type: 'state-changed', sessionId });
					this.emit({ type: 'session-list-changed', sessionId });
				}, this.getPollInterval());
				this.statePollers.set(config.id, poller);

				// 8. Emit events
				this.emit({ type: 'session-list-changed', sessionId: config.id });

				// 9. Handle exit
				subprocess.exited.then((exitCode) => {
					this.logger.log(`Agent ${config.id} exited with code ${exitCode}`);
					session.exited = true;
					session.exitCode = exitCode ?? null;

					// Stop state polling
					const p = this.statePollers.get(config.id);
					if (p) {
						p.stop();
						this.statePollers.delete(config.id);
					}
					if (session.stateCheckInterval) {
						clearInterval(session.stateCheckInterval);
						session.stateCheckInterval = null;
					}

					session.agentState = 'complete';

					// Flush remaining buffered data
					if (session.flushTimer) {
						clearTimeout(session.flushTimer);
						session.flushTimer = null;
					}
					session.syncOutputMode = false;
					this.ptyManager.flushBuffer(session);

					this.emit({ type: 'session-exited', sessionId: config.id, data: { exitCode } });
					this.emit({ type: 'session-list-changed', sessionId: config.id });
				});
			}
		} catch (err) {
			this.logger.error(`Unexpected error initializing session ${config.id}: ${err}`);

			// Guard: session may have been removed
			if (!this.sessions.has(config.id)) return;

			session.starting = false;
			session.exited = true;
			session.exitCode = 1;
			session.startError = String(err);
			session.agentState = 'complete';
			this.emit({ type: 'session-exited', sessionId: config.id, data: { exitCode: 1 } });
			this.emit({ type: 'session-list-changed', sessionId: config.id });
		}
	}

	/** Kill a running agent's subprocess. */
	killSession(id: string): void {
		const session = this.sessions.get(id);
		if (!session) {
			this.logger.error(`Kill: session ${id} not found`);
			return;
		}
		if (session.starting) {
			this.logger.log(`Kill: session ${id} is still starting`);
			return;
		}
		if (session.exited) {
			this.logger.log(`Kill: session ${id} already exited`);
			return;
		}
		if (session.subprocess) {
			this.logger.log(`Killing agent ${id}`);
			session.subprocess.kill();
		}

		// Stop state polling
		const poller = this.statePollers.get(id);
		if (poller) {
			poller.stop();
			this.statePollers.delete(id);
		}
	}

	/** Restart a session — kill if running, re-create with same config. */
	async restartSession(id: string): Promise<void> {
		const session = this.sessions.get(id);
		if (!session) {
			this.logger.error(`Restart: session ${id} not found`);
			return;
		}
		if (session.starting) {
			this.logger.log(`Restart: session ${id} is still starting`);
			return;
		}

		const config: AgentConfig = {
			id: session.id,
			name: session.name,
			cwd: session.cwd,
			prompt: session.prompt,
		};

		// Kill if still running
		if (!session.exited && session.subprocess) {
			session.subprocess.kill();
		}

		// Stop state polling
		const poller = this.statePollers.get(id);
		if (poller) {
			poller.stop();
			this.statePollers.delete(id);
		}

		// Remove old session
		this.sessions.delete(id);

		// Re-create
		await this.createSession(config);
	}

	/** Remove a session: kill + remove container + delete from map. */
	async removeSession(id: string): Promise<void> {
		const session = this.sessions.get(id);
		if (!session) {
			this.logger.error(`Remove: session ${id} not found`);
			return;
		}

		// Kill if still running
		if (!session.exited && session.subprocess) {
			session.subprocess.kill();
		}

		// Stop state polling
		const poller = this.statePollers.get(id);
		if (poller) {
			poller.stop();
			this.statePollers.delete(id);
		}

		// Remove container
		this.containerManager.removeContainer(session.cwd);

		// Delete from map
		this.sessions.delete(id);

		this.emit({ type: 'session-removed', sessionId: id });
		this.emit({ type: 'session-list-changed', sessionId: id });
	}

	getSession(id: string): ManagedSession | undefined {
		return this.sessions.get(id);
	}

	getAllSessions(): Map<string, ManagedSession> {
		return this.sessions;
	}

	/** Build session info list for clients. */
	getSessionInfoList(): SessionInfo[] {
		const list: SessionInfo[] = [];
		for (const session of this.sessions.values()) {
			const status = session.starting ? 'starting' : session.exited ? 'exited' : 'running';
			const info: SessionInfo = {
				id: session.id,
				name: session.name,
				status,
				agentState: session.agentState,
				sessionType: session.sessionType,
			};
			if (session.exited && session.exitCode !== null) {
				info.exitCode = session.exitCode;
			}
			list.push(info);
		}
		return list;
	}

	/**
	 * Discover and adopt orphaned containers from a previous daemon run.
	 * Checks if the single VM is running, then scans for containers.
	 */
	async adoptOrphanedContainers(): Promise<void> {
		// VM must be ready before we can scan Docker
		if (!this.colimaManager.isRunning()) {
			this.logger.log('VM not ready yet, skipping orphan adoption (will retry after pre-warm)');
			return;
		}

		const orphans = this.containerManager.discoverOrphanedContainers();
		if (orphans.length === 0) return;

		this.logger.log(`Adopting ${orphans.length} orphaned container(s)...`);
		for (const { containerId, workspaceFolder } of orphans) {
			const shortId = containerId.slice(0, 12);
			const dirName = workspaceFolder.split('/').pop() || shortId;
			const id = `adopted-${shortId}`;

			this.logger.log(`Adopting container ${shortId} as session ${id} (cwd: ${workspaceFolder})`);

			await this.createSession({
				id,
				name: dirName,
				cwd: workspaceFolder,
				prompt: '--continue', // will be overridden by adoption path in initializeSessionBackground
			});
		}
	}

	discoverGitRepos(workspaceDir: string): string[] {
		return this.containerManager.discoverGitRepos(workspaceDir);
	}

	createGitBranch(repoDir: string, branchName: string): { success: boolean; error?: string } {
		return this.containerManager.createGitBranch(repoDir, branchName);
	}

	/** Delegate image build to ImageBuilder. */
	async buildImage(profile?: string): Promise<{ success: boolean; tag: string; error?: string }> {
		return this.imageBuilder.build(profile);
	}

	/** Delegate image list to ImageBuilder. */
	async listImages(): Promise<Array<{ tag: string; size: string; created: string }>> {
		return this.imageBuilder.list();
	}

	/** Delegate image removal to ImageBuilder. */
	async removeImage(profile?: string): Promise<{ success: boolean; error?: string }> {
		return this.imageBuilder.remove(profile);
	}

	/** Graceful shutdown: stop all pollers, kill processes, remove containers. */
	async shutdown(): Promise<void> {
		this.logger.log('SEPSys shutting down...');

		// Stop all state pollers
		for (const [id, poller] of this.statePollers) {
			poller.stop();
			this.statePollers.delete(id);
		}

		// Kill all running processes
		for (const session of this.sessions.values()) {
			if (session.stateCheckInterval) {
				clearInterval(session.stateCheckInterval);
				session.stateCheckInterval = null;
			}
			if (!session.exited && session.subprocess) {
				this.logger.log(`Killing agent ${session.id}`);
				session.subprocess.kill();
			}
		}

		// Remove all containers
		const cwds = Array.from(this.sessions.values()).map(s => s.cwd);
		await this.containerManager.removeAllContainers(cwds);
	}
}
