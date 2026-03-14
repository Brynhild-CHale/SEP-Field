#!/usr/bin/env bun
/**
 * CLI dispatcher for SEP-Field.
 *
 * Provides a single `sep` command that delegates to the appropriate script.
 * Installed as a shell shim by `src/service/install.ts`.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { PROJECT_ROOT, LOG_PATH, PLIST_LABEL, PLIST_PATH } from './service/paths.ts';
import { checkSocketAlive } from './service/liveness.ts';

const COMMANDS: Record<string, { target: string; args?: string[]; description: string }> = {
	start:     { target: 'src/start.ts',            description: 'Start daemon' },
	stop:      { target: 'src/stop.ts',             description: 'Stop daemon' },
	status:    { target: 'src/status.ts',           description: 'Check daemon status' },
	client:    { target: 'src/tui/client.tsx',       description: 'Connect TUI client' },
	dev:       { target: 'src/main.ts',             description: 'Run daemon in foreground' },
	install:   { target: 'src/service/install.ts',  description: 'Install launchd service' },
	uninstall: { target: 'src/service/uninstall.ts', description: 'Uninstall SEP-Field' },
	monitor:   { target: 'src/monitor.ts',           description: 'Real-time resource monitor' },
	update:    { target: 'src/service/update.ts',    description: 'Check for and apply updates' },
};

const cmd = process.argv[2];

// Help
if (cmd === '-h' || cmd === '--help' || cmd === 'help') {
	console.log('');
	console.log('  SEP-Field CLI');
	console.log('');
	console.log('  Usage: sep [command]');
	console.log('');
	console.log('  Commands:');
	console.log('    (no args)    Connect TUI client');
	console.log('    start        Start daemon');
	console.log('    stop         Stop daemon');
	console.log('    restart      Stop and restart daemon');
	console.log('    status       Check daemon status');
	console.log('    client       Connect TUI client (explicit)');
	console.log('    dev          Run daemon in foreground');
	console.log('    install      Install launchd service');
	console.log('    uninstall    Uninstall SEP-Field');
	console.log('    monitor      Real-time resource monitor');
	console.log('    update       Check for and apply updates');
	console.log('    log          Tail daemon log');
	console.log('    -h, --help   Show this help');
	console.log('');
	process.exit(0);
}

// Restart — special case
if (cmd === 'restart') {
	// Launchd path: atomic kill + restart via kickstart
	if (existsSync(PLIST_PATH)) {
		const uid = process.getuid!();
		const target = `gui/${uid}/${PLIST_LABEL}`;
		const kick = Bun.spawnSync(['launchctl', 'kickstart', '-k', '-p', target], {
			stdout: 'pipe',
			stderr: 'pipe',
		});
		if (kick.exitCode === 0) {
			process.stdout.write('Restarting daemon...');
			for (let i = 0; i < 60; i++) {
				await Bun.sleep(250);
				if (await checkSocketAlive()) {
					console.log(' running.');
					process.exit(0);
				}
			}
			console.log(' started (waiting for socket).');
			process.exit(0);
		}
		console.log('launchctl kickstart failed, falling back to stop+start');
	}

	// Manual path: stop → poll for socket death → start
	const stopPath = resolve(PROJECT_ROOT, 'src/stop.ts');
	const stopProc = Bun.spawn(['bun', 'run', stopPath], {
		stdio: ['inherit', 'inherit', 'inherit'],
		cwd: PROJECT_ROOT,
		env: process.env,
	});
	await stopProc.exited;

	for (let i = 0; i < 60; i++) {
		if (!(await checkSocketAlive())) break;
		await Bun.sleep(250);
	}

	const startPath = resolve(PROJECT_ROOT, 'src/start.ts');
	const startProc = Bun.spawn(['bun', 'run', startPath], {
		stdio: ['inherit', 'inherit', 'inherit'],
		cwd: PROJECT_ROOT,
		env: process.env,
	});
	process.exitCode = await startProc.exited;
	process.exit();
}

// Log — special case, spawns tail
if (cmd === 'log') {
	const proc = Bun.spawn(['tail', '-f', LOG_PATH], {
		stdio: ['inherit', 'inherit', 'inherit'],
	});
	process.exitCode = await proc.exited;
	process.exit();
}

// No args → TUI client
const entry = cmd ? COMMANDS[cmd] : COMMANDS['client'];

if (!entry) {
	console.error(`Unknown command: ${cmd}`);
	console.error('Run "sep --help" for usage');
	process.exit(1);
}

const scriptPath = resolve(PROJECT_ROOT, entry.target);
const extraArgs = entry.args || [];
const passthrough = process.argv.slice(3);

const proc = Bun.spawn(['bun', 'run', scriptPath, ...extraArgs, ...passthrough], {
	stdio: ['inherit', 'inherit', 'inherit'],
	cwd: PROJECT_ROOT,
	env: process.env,
});

process.exitCode = await proc.exited;
process.exit();
