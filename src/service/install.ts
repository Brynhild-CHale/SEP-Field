/**
 * launchd service installer / uninstaller.
 *
 * Three-phase install:
 *   Phase 1: Splash art + prerequisite check
 *   Phase 2: VM resource configuration (interactive if TTY)
 *   Phase 3: launchd plist generation + bootstrap
 *
 * Usage:
 *   bun run src/service/install.ts              # install
 *   bun run src/service/install.ts --uninstall  # uninstall
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, chmodSync } from 'fs';
import { dirname, resolve } from 'path';
import {
	PLIST_LABEL,
	PLIST_PATH,
	PROJECT_ROOT,
	WRAPPER_PATH,
	SOCKET_PATH,
	PID_PATH,
	LOG_DIR,
	LOG_PATH,
} from './paths.ts';
import {
	runPreflight,
	printPreflightReport,
	detectSystemSpecs,
	computeDefaults,
	readExistingVMConfig,
	writeVMConfig,
	type VMConfig,
} from './preflight.ts';
import { playSplash } from './splash.ts';

const uid = process.getuid!();
const domain = `gui/${uid}`;

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

if (process.argv.includes('--uninstall')) {
	console.log('Use `sep uninstall` or `bun run src/service/uninstall.ts` instead.');
	process.exit(0);
}

// ---------------------------------------------------------------------------
// Phase 1: Splash + Prerequisite Check
// ---------------------------------------------------------------------------

await playSplash();
console.log('');

const report = runPreflight();
printPreflightReport(report);

if (!report.passed) {
	process.exit(1);
}

console.log('');

// ---------------------------------------------------------------------------
// Phase 2: Resource Configuration
// ---------------------------------------------------------------------------

const specs = detectSystemSpecs();
const defaults = computeDefaults(specs);
const existing = readExistingVMConfig();
let vmConfig: VMConfig = existing || defaults;

const isTTY = process.stdin.isTTY;

if (isTTY) {
	console.log('  VM Resource Allocation');
	console.log('');
	console.log('  SEP-Field runs all agent containers inside a single Colima VM');
	console.log('  using Apple Virtualization with balloon memory. The VM claims');
	console.log('  its full RAM allocation at boot, but balloon memory means the');
	console.log('  host can reclaim unused pages — with no sessions running, the');
	console.log('  idle VM typically holds ~1-2 GB resident despite the larger');
	console.log('  reservation. CPU cores are dedicated while the VM is up.');
	console.log('');
	console.log('  On startup, the VM pre-builds a cached Docker image so the');
	console.log('  first agent launches in ~10s instead of ~55s. Each agent gets');
	console.log('  roughly 1 CPU and 1 GB RAM within the VM.');
	console.log('');
	console.log(`  Your system:  ${specs.totalCpus} CPUs, ${specs.totalMemGB} GB RAM`);

	if (existing) {
		console.log(`  Current VM:   ${existing.cpus} CPUs, ${existing.memoryGB} GB RAM`);
	}

	console.log(`  Default VM:   ${defaults.cpus} CPUs, ${defaults.memoryGB} GB RAM (recommended)`);
	console.log('');

	const useDefaults = await promptYesNo('  Use defaults? [Y/n] ', true);

	if (!useDefaults) {
		const cpus = await promptNumber(
			`  CPUs (${2}-${specs.totalCpus}): `,
			defaults.cpus,
			2,
			specs.totalCpus,
		);
		const memoryGB = await promptNumber(
			`  RAM in GB (${4}-${specs.totalMemGB}): `,
			defaults.memoryGB,
			4,
			specs.totalMemGB,
		);
		vmConfig = { cpus, memoryGB, vmType: defaults.vmType };
	} else {
		vmConfig = defaults;
	}

	writeVMConfig(vmConfig);
	console.log(`  VM config saved: ${vmConfig.cpus} CPUs, ${vmConfig.memoryGB} GB RAM`);
	console.log('');
} else {
	// Non-interactive: use existing config or write defaults
	if (!existing) {
		writeVMConfig(defaults);
	}
}

// ---------------------------------------------------------------------------
// Phase 3: launchd setup
// ---------------------------------------------------------------------------

// Resolve bun path
const whichBun = Bun.spawnSync(['which', 'bun'], { stdout: 'pipe', stderr: 'pipe' });
const bunPath = whichBun.stdout.toString().trim();
if (!bunPath || whichBun.exitCode !== 0) {
	console.error('Could not find bun in PATH. Is it installed?');
	process.exit(1);
}

const home = process.env.HOME || '/tmp';
const path = [
	'/opt/homebrew/bin',
	'/usr/local/bin',
	dirname(bunPath),
	'/usr/bin',
	'/bin',
	'/usr/sbin',
	'/sbin',
].join(':');

// Build plist XML
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${PLIST_LABEL}</string>

	<key>ProgramArguments</key>
	<array>
		<string>${WRAPPER_PATH}</string>
	</array>

	<key>RunAtLoad</key>
	<true/>

	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>

	<key>ThrottleInterval</key>
	<integer>10</integer>

	<key>ProcessType</key>
	<string>Background</string>

	<key>WorkingDirectory</key>
	<string>${PROJECT_ROOT}</string>

	<key>EnvironmentVariables</key>
	<dict>
		<key>BUN_PATH</key>
		<string>${bunPath}</string>
		<key>SEP_FIELD_ROOT</key>
		<string>${PROJECT_ROOT}</string>
		<key>HOME</key>
		<string>${home}</string>
		<key>PATH</key>
		<string>${path}</string>
		<key>SEP_FIELD_SOCKET</key>
		<string>${SOCKET_PATH}</string>
		<key>SEP_FIELD_PID</key>
		<string>${PID_PATH}</string>
		<key>SEP_FIELD_LOG</key>
		<string>${LOG_PATH}</string>
	</dict>

	<key>StandardOutPath</key>
	<string>${LOG_PATH}</string>

	<key>StandardErrorPath</key>
	<string>${LOG_PATH}</string>
</dict>
</plist>
`;

// Ensure directories exist
mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(dirname(PLIST_PATH), { recursive: true });

// Make wrapper executable
chmodSync(WRAPPER_PATH, 0o755);

// Write plist
writeFileSync(PLIST_PATH, plist);
console.log(`Wrote ${PLIST_PATH}`);

// Bootout any existing instance first (ignore errors)
Bun.spawnSync(['launchctl', 'bootout', `${domain}/${PLIST_LABEL}`], {
	stdout: 'pipe',
	stderr: 'pipe',
});

// Bootstrap (load) the service
const bootstrap = Bun.spawnSync(['launchctl', 'bootstrap', domain, PLIST_PATH], {
	stdout: 'pipe',
	stderr: 'pipe',
});

if (bootstrap.exitCode !== 0) {
	const stderr = bootstrap.stderr.toString().trim();
	console.error(`launchctl bootstrap failed (exit ${bootstrap.exitCode}): ${stderr}`);
	process.exit(1);
}

console.log(`Loaded ${PLIST_LABEL} into ${domain}`);

// ---------------------------------------------------------------------------
// Install `sep` CLI shim
// ---------------------------------------------------------------------------

const shimDir = resolve(home, '.bun', 'bin');
const shimPath = resolve(shimDir, 'sep');
const shimContent = `#!/bin/bash
exec "${bunPath}" run "${resolve(PROJECT_ROOT, 'src/cli.ts')}" "$@"
`;

mkdirSync(shimDir, { recursive: true });
writeFileSync(shimPath, shimContent);
chmodSync(shimPath, 0o755);
console.log(`Installed CLI shim → ${shimPath}`);

// Check if shim dir is in PATH
const currentPath = process.env.PATH || '';
const shimInPath = currentPath.split(':').some(p => resolve(p) === resolve(shimDir));

console.log('');
console.log('Service installed. The daemon will:');
console.log('  - Start automatically at login');
console.log('  - Restart automatically on crash');
console.log('  - NOT restart after graceful stop (sep stop)');
console.log('');
console.log(`VM config: ${vmConfig.cpus} CPUs, ${vmConfig.memoryGB} GB RAM`);
// Show available commands by running sep --help
const helpProc = Bun.spawnSync(['bun', 'run', resolve(PROJECT_ROOT, 'src/cli.ts'), '--help'], {
	stdout: 'pipe',
	stderr: 'pipe',
	cwd: PROJECT_ROOT,
});
if (helpProc.exitCode === 0) {
	process.stdout.write(helpProc.stdout.toString());
}

if (!shimInPath) {
	console.log('');
	console.log(`Note: ${shimDir} may not be in your PATH.`);
	console.log(`Add it with:  export PATH="${shimDir}:$PATH"`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function promptYesNo(prompt: string, defaultYes: boolean): Promise<boolean> {
	process.stdout.write(prompt);
	for await (const line of console) {
		const answer = line.trim().toLowerCase();
		if (answer === '' || answer === 'y' || answer === 'yes') return defaultYes ? true : false;
		if (answer === 'n' || answer === 'no') return false;
		process.stdout.write(prompt);
	}
	return defaultYes;
}

async function promptNumber(prompt: string, defaultVal: number, min: number, max: number): Promise<number> {
	process.stdout.write(prompt);
	for await (const line of console) {
		const answer = line.trim();
		if (answer === '') return defaultVal;
		const num = parseInt(answer, 10);
		if (!isNaN(num) && num >= min && num <= max) return num;
		process.stdout.write(`  Must be ${min}-${max}. ${prompt}`);
	}
	return defaultVal;
}
