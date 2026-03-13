/**
 * Daemon Status Check
 *
 * Checks socket liveness, launchctl state, and PID file as fallback.
 * Reports whether managed by launchd or manual.
 */

import { existsSync, readFileSync } from 'fs';
import {
	ORCHESTRATOR_PID_PATH,
	ORCHESTRATOR_LOG_PATH,
	ORCHESTRATOR_SOCKET_PATH,
} from './transport/protocol.ts';
import { PLIST_LABEL, PLIST_PATH } from './service/paths.ts';
import { checkSocketAlive } from './service/liveness.ts';
import { isColimaAvailable, getVMInfo, getContainerStats } from './core/docker-stats.ts';

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const socketAlive = await checkSocketAlive();
const serviceInstalled = existsSync(PLIST_PATH);
let launchdPid: number | null = null;
let launchdState: string | null = null;

// Query launchd if service is installed
if (serviceInstalled) {
	const uid = process.getuid!();
	const target = `gui/${uid}/${PLIST_LABEL}`;
	const print = Bun.spawnSync(['launchctl', 'print', target], {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	if (print.exitCode === 0) {
		const output = print.stdout.toString();
		const pidMatch = output.match(/pid\s*=\s*(\d+)/);
		if (pidMatch) launchdPid = parseInt(pidMatch[1], 10);

		const stateMatch = output.match(/state\s*=\s*(\S+)/);
		if (stateMatch) launchdState = stateMatch[1];
	}
}

// PID file check
let pidFilePid: number | null = null;
if (existsSync(ORCHESTRATOR_PID_PATH)) {
	const raw = parseInt(readFileSync(ORCHESTRATOR_PID_PATH, 'utf8').trim(), 10);
	if (!isNaN(raw) && isProcessRunning(raw)) {
		pidFilePid = raw;
	}
}

// Report status
const pid = launchdPid || pidFilePid;

if (socketAlive) {
	const managedBy = serviceInstalled ? 'launchd' : 'manual';
	console.log(`Daemon: running${pid ? ` (PID: ${pid})` : ''}, managed by ${managedBy}`);
	console.log(`Socket: ${existsSync(ORCHESTRATOR_SOCKET_PATH) ? 'live' : 'exists'}`);
	console.log(`Log: ${ORCHESTRATOR_LOG_PATH}`);
	if (serviceInstalled) {
		console.log(`Service: installed${launchdState ? ` (${launchdState})` : ''}`);
	}
	console.log('Connect with: bun run client');
} else if (pid) {
	console.log(`Daemon: process exists (PID: ${pid}) but socket not responding`);
	console.log(`Log: ${ORCHESTRATOR_LOG_PATH}`);
} else if (serviceInstalled) {
	console.log(`Daemon: not running (service installed but stopped)`);
	console.log(`Service state: ${launchdState || 'unknown'}`);
	console.log('Start with: bun run start');
} else {
	console.log('Daemon: not running');
	console.log('Start with: bun run start');
}

// --- Resource section ---
if (isColimaAvailable()) {
	const vm = getVMInfo();
	if (vm) {
		console.log('');
		console.log(`VM: ${vm.status} | ${vm.cpus} CPUs | ${vm.memoryGB} GB RAM | ${vm.diskGB} GB disk`);

		if (vm.status === 'Running') {
			const stats = getContainerStats();
			if (stats.length > 0) {
				console.log(`Containers: ${stats.length}`);
				for (const c of stats) {
					const name = c.name.padEnd(30);
					console.log(`  ${name}CPU: ${c.cpuPerc.padStart(7)}  MEM: ${c.memUsage}`);
				}
			} else {
				console.log('Containers: 0');
			}
		}
	}
}
