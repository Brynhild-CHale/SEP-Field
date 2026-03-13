/**
 * Daemon Shutdown
 *
 * Priority order:
 * 1. launchd kill → if plist exists, send SIGTERM via launchctl
 * 2. Fallback → PID-based SIGTERM (original behavior)
 */

import { existsSync, readFileSync, unlinkSync } from 'fs';
import {
	ORCHESTRATOR_PID_PATH,
	ORCHESTRATOR_SOCKET_PATH,
} from './transport/protocol.ts';
import { PLIST_LABEL, PLIST_PATH } from './service/paths.ts';
import { checkSocketAlive } from './service/liveness.ts';

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// 1. launchd kill — if the service is installed, send SIGTERM via launchctl
if (existsSync(PLIST_PATH)) {
	const uid = process.getuid!();
	const target = `gui/${uid}/${PLIST_LABEL}`;

	const kill = Bun.spawnSync(['launchctl', 'kill', 'SIGTERM', target], {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	if (kill.exitCode === 0) {
		// Wait for the daemon to actually shut down (up to 10s)
		process.stdout.write('Stopping daemon...');
		for (let i = 0; i < 40; i++) {
			await Bun.sleep(250);
			if (!(await checkSocketAlive())) {
				console.log(' stopped.');
				process.exit(0);
			}
		}
		console.log(' stopped (socket lingered).');
		process.exit(0);
	}

	// Kill failed — fall through to PID-based stop
	const stderr = kill.stderr.toString().trim();
	console.log(`launchctl kill failed (${stderr}), falling back to PID-based stop`);
}

// 2. Fallback — PID-based SIGTERM (original behavior)

if (!existsSync(ORCHESTRATOR_PID_PATH)) {
	console.log('Daemon not running (no PID file)');
	process.exit(0);
}

const pid = parseInt(readFileSync(ORCHESTRATOR_PID_PATH, 'utf8').trim(), 10);

if (isNaN(pid)) {
	console.log('Invalid PID file, cleaning up');
	unlinkSync(ORCHESTRATOR_PID_PATH);
	process.exit(0);
}

if (!isProcessRunning(pid)) {
	console.log(`Daemon not running (stale PID: ${pid}), cleaning up`);
	unlinkSync(ORCHESTRATOR_PID_PATH);
	if (existsSync(ORCHESTRATOR_SOCKET_PATH)) {
		unlinkSync(ORCHESTRATOR_SOCKET_PATH);
	}
	process.exit(0);
}

process.kill(pid, 'SIGTERM');
console.log(`Daemon stopped (PID: ${pid})`);

setTimeout(() => {
	if (existsSync(ORCHESTRATOR_PID_PATH)) {
		unlinkSync(ORCHESTRATOR_PID_PATH);
	}
}, 1000);
