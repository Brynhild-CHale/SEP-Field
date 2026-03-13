/**
 * Real-time Resource Monitor
 *
 * Polls Docker stats and daemon session state every 2s.
 * Combines container resource usage with agent state info.
 * Ctrl+C to quit.
 */

import { isColimaAvailable, getVMInfo, getContainerStats, type ContainerStats } from './core/docker-stats.ts';
import { basename } from 'path';

const POLL_INTERVAL = 2000;
const API_BASE = 'http://localhost:7080';

// ANSI helpers
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

const STATE_COLORS: Record<string, string> = {
	busy: YELLOW,
	waiting: CYAN,
	idle: GREEN,
	complete: DIM,
	starting: DIM,
	unknown: DIM,
};

interface SessionInfo {
	name: string;
	agentState: string;
}

// Check prerequisites
if (!isColimaAvailable()) {
	console.error('Error: colima CLI not found. Install with: brew install colima');
	process.exit(1);
}

// Hide cursor
process.stdout.write('\x1b[?25l');

// Restore cursor on exit
function cleanup() {
	process.stdout.write('\x1b[?25h\n');
	process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function fetchSessions(): Promise<SessionInfo[]> {
	try {
		const res = await fetch(`${API_BASE}/sessions`, { signal: AbortSignal.timeout(2000) });
		if (!res.ok) return [];
		return await res.json() as SessionInfo[];
	} catch {
		return [];
	}
}

function matchSessionToContainer(sessions: SessionInfo[], container: ContainerStats): string {
	if (container.workspaceFolder) {
		const folderName = basename(container.workspaceFolder);
		const match = sessions.find(s => s.name === folderName);
		if (match) return match.agentState;
	}
	// Fallback: match by container name containing session name
	for (const s of sessions) {
		if (container.name.includes(s.name)) return s.agentState;
	}
	return 'unknown';
}

function colorState(state: string): string {
	const color = STATE_COLORS[state] || DIM;
	return `${color}${state.padEnd(12)}${RESET}`;
}

async function render() {
	const vm = getVMInfo();
	const now = new Date().toLocaleTimeString('en-US', { hour12: false });

	// Clear screen and move cursor to top
	process.stdout.write('\x1b[2J\x1b[H');

	console.log(`${BOLD}SEP-Field Monitor${RESET}  ${now}  (Ctrl+C to quit)`);
	console.log('');

	if (!vm) {
		console.log(`${DIM}VM: not found${RESET}`);
		return;
	}

	console.log(`VM: ${vm.status} | ${vm.cpus} CPUs | ${vm.memoryGB} GB RAM | ${vm.diskGB} GB disk`);
	console.log('');

	if (vm.status !== 'Running') {
		console.log(`${DIM}VM is not running${RESET}`);
		return;
	}

	const [stats, sessions] = await Promise.all([
		Promise.resolve(getContainerStats()),
		fetchSessions(),
	]);

	if (stats.length === 0) {
		console.log(`${DIM}No containers running${RESET}`);
		return;
	}

	// Header
	const hAgent = 'Agent'.padEnd(25);
	const hState = 'State'.padEnd(12);
	const hCpu = 'CPU%'.padStart(8);
	const hMem = 'MEM'.padStart(18);
	const hMemPerc = 'MEM%'.padStart(8);
	console.log(`${BOLD}${hAgent}${hState}${hCpu}${hMem}${hMemPerc}${RESET}`);
	console.log('\u2500'.repeat(71));

	for (const c of stats) {
		const state = matchSessionToContainer(sessions, c);
		const name = c.name.padEnd(25);
		const stateStr = colorState(state);
		const cpu = c.cpuPerc.padStart(8);
		const mem = c.memUsage.padStart(18);
		const memPerc = c.memPerc.padStart(8);
		console.log(`${name}${stateStr}${cpu}${mem}${memPerc}`);
	}

	if (sessions.length === 0) {
		console.log('');
		console.log(`${DIM}(daemon not reachable — showing containers only)${RESET}`);
	}
}

// Main loop
async function main() {
	while (true) {
		await render();
		await Bun.sleep(POLL_INTERVAL);
	}
}

main();
