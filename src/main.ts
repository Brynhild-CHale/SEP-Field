/**
 * SEP-Field — Daemon Entry Point
 *
 * Wires all modules together and starts the daemon.
 * No hardcoded agents — the daemon starts empty.
 * Agents are created dynamically via the create-agent action.
 *
 * On start: eagerly pre-warms the single Colima VM + builds default image
 * so that the first create-agent is fast (~10s instead of ~55s).
 */

import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { AuthManager } from './core/auth-manager.ts';
import { ColimaManager } from './core/colima-manager.ts';
import { ContainerManager } from './core/container-manager.ts';
import { ImageBuilder } from './core/image-builder.ts';
import { ProfileManager } from './core/profile-manager.ts';
import { PtyManager } from './core/pty-manager.ts';
import { SEPSys } from './core/sep-sys.ts';
import { Semaphore } from './core/semaphore.ts';
import { StreamServer } from './transport/stream-server.ts';
import { ApiServer } from './transport/api-server.ts';
import { loadActions, BUILTIN_ACTIONS_DIR } from './actions/index.ts';
import { ActionWatcher } from './actions/action-watcher.ts';
import { generateDocs } from './docs/generate-docs.ts';
import { ORCHESTRATOR_PID_PATH, ORCHESTRATOR_SOCKET_PATH, API_DEFAULT_PORT } from './transport/protocol.ts';
import { LOG_DIR, USER_ACTIONS_DIR, PROFILES_DIR } from './service/paths.ts';
import { readApiPort } from './service/preflight.ts';
import type { Action, Logger } from './types/index.ts';

// Ensure log directory exists (needed when launchd runs main.ts directly)
mkdirSync(LOG_DIR, { recursive: true });

// Ensure user actions directory exists
mkdirSync(USER_ACTIONS_DIR, { recursive: true });

// Ensure profiles directory exists
mkdirSync(PROFILES_DIR, { recursive: true });

// --- Logger ---
const logger: Logger = {
	log(msg: string): void {
		const ts = new Date().toISOString();
		console.log(`[${ts}] ${msg}`);
	},
	error(msg: string): void {
		const ts = new Date().toISOString();
		console.error(`[${ts}] ERROR: ${msg}`);
	},
};

// --- Instantiate core modules ---
const authManager = new AuthManager(logger);
const colimaManager = new ColimaManager(logger);
const containerUpSemaphore = new Semaphore(2); // Limit concurrent devcontainer up
const containerManager = new ContainerManager(logger, colimaManager, containerUpSemaphore);
const profileManager = new ProfileManager(logger);
const imageBuilder = new ImageBuilder(logger, colimaManager, profileManager);
const ptyManager = new PtyManager(logger);
const sepSys = new SEPSys(
	containerManager, ptyManager, colimaManager, profileManager, imageBuilder, logger,
);

// --- Instantiate transport ---
const streamServer = new StreamServer(sepSys, logger);

// --- Load action registry ---
const { actions, builtinNames, userActionNames } = await loadActions(logger);

// --- Action hot-reload watcher (user directory only) ---
const builtinActions = new Map<string, Action>();
for (const name of builtinNames) {
	builtinActions.set(name, actions.get(name)!);
}
const projectRoot = resolve(import.meta.dir, '..');
const actionWatcher = new ActionWatcher(
	USER_ACTIONS_DIR,
	actions,
	logger,
	builtinActions,
	async () => {
		await generateDocs({
			actionsDir: BUILTIN_ACTIONS_DIR,
			projectRoot,
			logger,
			preloadedActions: Array.from(actions.values()),
			builtinNames,
			userActionNames,
		});
	},
);

// --- Instantiate API server ---
const configPort = readApiPort();
const apiPort = process.env.API_PORT
	? parseInt(process.env.API_PORT, 10)
	: configPort ?? API_DEFAULT_PORT;
const apiServer = new ApiServer(sepSys, actions, logger, apiPort);

// --- Cleanup helper ---
function cleanup(): void {
	try {
		if (existsSync(ORCHESTRATOR_PID_PATH)) {
			unlinkSync(ORCHESTRATOR_PID_PATH);
		}
	} catch { /* ignore */ }
}

// --- Shutdown handler ---
async function shutdown(): Promise<void> {
	logger.log('Shutting down...');

	// Stop action watcher
	actionWatcher.stop();

	// Stop auth
	authManager.stop();

	// Stop API server
	apiServer.stop();

	// Shutdown sessions (kills processes, removes containers)
	await sepSys.shutdown();

	// Shutdown Colima VM
	await colimaManager.shutdown();

	// Stop stream server (closes socket, cleans up socket file)
	streamServer.stop();

	cleanup();
	logger.log('Shutdown complete');
	process.exit(0);
}

// --- Signal handlers ---
process.on('SIGTERM', () => { shutdown(); });
process.on('SIGINT', () => { shutdown(); });

// --- Start ---
logger.log('=== SEP-Field daemon starting ===');

// Write PID file (needed when launchd runs main.ts directly, bypassing start.ts)
writeFileSync(ORCHESTRATOR_PID_PATH, String(process.pid));

// Start auth (keychain sync + token refresh scheduling)
await authManager.start();

// Start stream server (Unix socket for PTY data)
await streamServer.start();

// Start API server (HTTP for control actions)
apiServer.start();

// Start action hot-reload watcher
actionWatcher.start();

logger.log(`Daemon ready — ${actions.size} actions registered`);
logger.log(`API: http://localhost:${apiPort}`);
logger.log(`Stream: ${ORCHESTRATOR_SOCKET_PATH}`);

// Eager pre-warm: start VM + build default image (non-blocking)
// Daemon API/socket are already live — agents wait via ensureReady()
colimaManager.start()
	.then(async () => {
		logger.log('VM pre-warm complete, building default image...');
		const result = await imageBuilder.build();
		if (result.success) {
			logger.log(`Pre-warm complete: ${result.tag} built`);
		} else {
			logger.error(`Default image build failed: ${result.error}`);
		}
		// Now adopt orphaned containers (VM is ready)
		await sepSys.adoptOrphanedContainers();
	})
	.catch(err => logger.error(`Pre-warm failed: ${err}`));
