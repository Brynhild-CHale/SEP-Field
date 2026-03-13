/**
 * Daemon Launcher
 *
 * Priority order:
 * 1. Socket liveness → if alive, report "already running" and exit
 * 2. launchd kickstart → if plist exists, kick via launchctl
 * 3. Fallback → detached spawn (VM managed by ColimaManager on daemon start)
 */

import { existsSync, readFileSync, unlinkSync, openSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import {
	ORCHESTRATOR_PID_PATH,
	ORCHESTRATOR_LOG_PATH,
} from './transport/protocol.ts';
import { PLIST_LABEL, PLIST_PATH, LOG_DIR } from './service/paths.ts';
import { checkSocketAlive } from './service/liveness.ts';
import { runPreflight, printPreflightReport } from './service/preflight.ts';

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// 0. Preflight check
const preflightReport = runPreflight();
if (!preflightReport.passed) {
	printPreflightReport(preflightReport);
	process.exit(1);
}

// 1. Socket liveness check
if (await checkSocketAlive()) {
	console.log('Daemon already running (socket is live)');
	console.log('Connect with: bun run client');
	process.exit(0);
}

// 2. launchd kickstart — if the service is installed, kick it via launchctl
if (existsSync(PLIST_PATH)) {
	const uid = process.getuid!();
	const target = `gui/${uid}/${PLIST_LABEL}`;

	const kick = Bun.spawnSync(['launchctl', 'kickstart', '-k', target], {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	if (kick.exitCode === 0) {
		console.log('Daemon started via launchd');
		console.log('Connect with: bun run client');
		process.exit(0);
	}

	// Kickstart failed — fall through to manual launch
	const stderr = kick.stderr.toString().trim();
	console.log(`launchctl kickstart failed (${stderr}), falling back to manual launch`);
}

// 3. Fallback — detached spawn (colima CLI check is done by ColimaManager.start())

// Clean up stale PID file
if (existsSync(ORCHESTRATOR_PID_PATH)) {
	const pid = parseInt(readFileSync(ORCHESTRATOR_PID_PATH, 'utf8').trim(), 10);
	if (!isNaN(pid) && isProcessRunning(pid)) {
		console.log(`Daemon already running (PID: ${pid})`);
		console.log('Connect with: bun run client');
		process.exit(0);
	}
	unlinkSync(ORCHESTRATOR_PID_PATH);
}

// Open log file
mkdirSync(LOG_DIR, { recursive: true });
const logFd = openSync(ORCHESTRATOR_LOG_PATH, 'a');

// Spawn daemon detached
const mainPath = resolve(import.meta.dir, 'main.ts');
const child = Bun.spawn(['bun', 'run', mainPath], {
	stdio: ['ignore', logFd, logFd],
	detached: true,
	cwd: resolve(import.meta.dir, '..'),
	env: process.env,
});

child.unref();

// Write PID file
writeFileSync(ORCHESTRATOR_PID_PATH, String(child.pid));

console.log(`Daemon started (PID: ${child.pid})`);
console.log(`Log: ${ORCHESTRATOR_LOG_PATH}`);
console.log('Connect with: bun run client');
