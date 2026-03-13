#!/usr/bin/env bun
/**
 * CLI dispatcher for SEP-Field.
 *
 * Provides a single `sep` command that delegates to the appropriate script.
 * Installed as a shell shim by `src/service/install.ts`.
 */

import { resolve } from 'path';
import { PROJECT_ROOT, LOG_PATH } from './service/paths.ts';

const COMMANDS: Record<string, { target: string; args?: string[]; description: string }> = {
	start:     { target: 'src/start.ts',            description: 'Start daemon' },
	stop:      { target: 'src/stop.ts',             description: 'Stop daemon' },
	status:    { target: 'src/status.ts',           description: 'Check daemon status' },
	client:    { target: 'src/tui/client.tsx',       description: 'Connect TUI client' },
	dev:       { target: 'src/main.ts',             description: 'Run daemon in foreground' },
	install:   { target: 'src/service/install.ts',  description: 'Install launchd service' },
	uninstall: { target: 'src/service/install.ts',  args: ['--uninstall'], description: 'Uninstall launchd service' },
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
	console.log('    status       Check daemon status');
	console.log('    client       Connect TUI client (explicit)');
	console.log('    dev          Run daemon in foreground');
	console.log('    install      Install launchd service');
	console.log('    uninstall    Uninstall launchd service');
	console.log('    monitor      Real-time resource monitor');
	console.log('    update       Check for and apply updates');
	console.log('    log          Tail daemon log');
	console.log('    -h, --help   Show this help');
	console.log('');
	process.exit(0);
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
