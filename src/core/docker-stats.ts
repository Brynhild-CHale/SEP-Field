/**
 * Docker Stats Utility
 *
 * Stateless functions for querying Colima VM info and container resource usage.
 * Designed for use outside the daemon (status, monitor scripts).
 * No internal imports — only uses node builtins and Bun APIs.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const HOME = process.env.HOME || '/tmp';
const COLIMA_PROFILE = 'sep-field';
const DOCKER_SOCKET = resolve(HOME, '.colima', COLIMA_PROFILE, 'docker.sock');
const DOCKER_HOST = `unix://${DOCKER_SOCKET}`;

const SPAWN_TIMEOUT = 5000;

export interface VMInfo {
	status: string;
	cpus: number;
	memoryGB: number;
	diskGB: number;
}

export interface ContainerStats {
	id: string;
	name: string;
	cpuPerc: string;
	memUsage: string;
	memPerc: string;
	netIO: string;
	pids: string;
	workspaceFolder: string | null;
}

/**
 * Check if colima CLI is available on PATH.
 */
export function isColimaAvailable(): boolean {
	const result = Bun.spawnSync(['which', 'colima'], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	return result.exitCode === 0;
}

/**
 * Get VM info from `colima list --json` (NDJSON output).
 * Returns null if colima unavailable or profile not found.
 */
export function getVMInfo(): VMInfo | null {
	const result = Bun.spawnSync(['colima', 'list', '--json'], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	if (result.exitCode !== 0) return null;

	const output = result.stdout.toString().trim();
	if (!output) return null;

	for (const line of output.split('\n')) {
		try {
			const entry = JSON.parse(line);
			if (entry.name === COLIMA_PROFILE) {
				return {
					status: entry.status || 'Unknown',
					cpus: entry.cpus ?? 0,
					memoryGB: Math.round(((entry.memory ?? 0) / (1024 ** 3)) * 10) / 10,
					diskGB: Math.round((entry.disk ?? 0) / (1024 ** 3)),
				};
			}
		} catch { /* skip malformed lines */ }
	}
	return null;
}

/**
 * Get resource stats for all running containers.
 * Uses `docker stats --no-stream` + `docker inspect` for labels.
 */
export function getContainerStats(): ContainerStats[] {
	if (!existsSync(DOCKER_SOCKET)) return [];

	// Get stats
	const statsProc = Bun.spawnSync(
		['docker', '--host', DOCKER_HOST, 'stats', '--no-stream', '--format', '{{json .}}'],
		{ stdout: 'pipe', stderr: 'pipe', timeout: SPAWN_TIMEOUT },
	);
	if (statsProc.exitCode !== 0) return [];

	const statsOutput = statsProc.stdout.toString().trim();
	if (!statsOutput) return [];

	const containers: ContainerStats[] = [];
	const ids: string[] = [];

	for (const line of statsOutput.split('\n')) {
		try {
			const s = JSON.parse(line);
			ids.push(s.ID || s.Container);
			containers.push({
				id: s.ID || s.Container,
				name: s.Name,
				cpuPerc: s.CPUPerc || '0.00%',
				memUsage: s.MemUsage || '0B / 0B',
				memPerc: s.MemPerc || '0.00%',
				netIO: s.NetIO || '0B / 0B',
				pids: s.PIDs || '0',
				workspaceFolder: null,
			});
		} catch { /* skip */ }
	}

	if (ids.length === 0) return containers;

	// Batch inspect for devcontainer labels
	const inspectProc = Bun.spawnSync(
		['docker', '--host', DOCKER_HOST, 'inspect', '--format', '{{.ID}}\t{{index .Config.Labels "devcontainer.local_folder"}}', ...ids],
		{ stdout: 'pipe', stderr: 'pipe', timeout: SPAWN_TIMEOUT },
	);

	if (inspectProc.exitCode === 0) {
		const inspectOutput = inspectProc.stdout.toString().trim();
		const labelMap = new Map<string, string>();

		for (const line of inspectOutput.split('\n')) {
			const [fullId, folder] = line.split('\t');
			if (fullId && folder && folder !== '<no value>') {
				labelMap.set(fullId, folder);
			}
		}

		for (const c of containers) {
			// Match by prefix — docker stats returns short IDs, inspect returns full
			for (const [fullId, folder] of labelMap) {
				if (fullId.startsWith(c.id) || c.id.startsWith(fullId.slice(0, 12))) {
					c.workspaceFolder = folder;
					break;
				}
			}
		}
	}

	return containers;
}
