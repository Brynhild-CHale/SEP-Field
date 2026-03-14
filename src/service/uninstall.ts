/**
 * Full SEP-Field uninstaller.
 *
 * Phases:
 *   1. Stop daemon
 *   2. Unload launchd service
 *   3. Docker & Colima cleanup (prompted)
 *   4. Preserve user data (actions/profiles backup)
 *   5. Remove config & runtime files
 *   6. Remove CLI shim
 *   7. Remove installation directory (only with --remove-repo)
 *   8. Summary
 *
 * Flags:
 *   --force       Skip interactive prompts (assume yes)
 *   --remove-repo Also delete the installation directory
 */

import { existsSync, readFileSync, readdirSync, unlinkSync, rmSync, cpSync, mkdirSync, statSync } from 'fs';
import { resolve, basename } from 'path';
import {
	PLIST_LABEL,
	PLIST_PATH,
	PROJECT_ROOT,
	SOCKET_PATH,
	PID_PATH,
	LOG_DIR,
	CONFIG_DIR,
	USER_ACTIONS_DIR,
	PROFILES_DIR,
} from './paths.ts';
import { checkSocketAlive } from './liveness.ts';

const HOME = process.env.HOME || '/tmp';
const uid = process.getuid!();
const domain = `gui/${uid}`;
const force = process.argv.includes('--force');
const removeRepo = process.argv.includes('--remove-repo');

// Non-TTY safety
if (!process.stdin.isTTY && !force) {
	console.error('Not a TTY. Use --force to run non-interactively.');
	process.exit(1);
}

interface RunResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
}

function runCmd(cmd: string[]): RunResult {
	const result = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
	return {
		ok: result.exitCode === 0,
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
		exitCode: result.exitCode,
	};
}

async function promptYesNo(prompt: string, defaultYes: boolean): Promise<boolean> {
	if (force) return true;
	process.stdout.write(prompt);
	for await (const line of console) {
		const answer = line.trim().toLowerCase();
		if (answer === '') return defaultYes;
		if (answer === 'y' || answer === 'yes') return true;
		if (answer === 'n' || answer === 'no') return false;
		process.stdout.write(prompt);
	}
	return defaultYes;
}

async function promptExact(prompt: string, expected: string): Promise<boolean> {
	if (force) return true;
	process.stdout.write(prompt);
	for await (const line of console) {
		const answer = line.trim();
		if (answer === expected) return true;
		if (answer === '' || answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') return false;
		process.stdout.write(`  Type "${expected}" to confirm, or press Enter to skip: `);
	}
	return false;
}

const done: string[] = [];
const skipped: string[] = [];
const failed: string[] = [];
let backupLocation: string | null = null;

console.log('');
console.log('  SEP-Field Uninstaller');
console.log('');

// ---------------------------------------------------------------------------
// Phase 1: Stop daemon
// ---------------------------------------------------------------------------

console.log('  Phase 1: Stopping daemon...');

const alive = await checkSocketAlive();

if (alive) {
	let stopped = false;

	// Try launchctl kill first
	if (existsSync(PLIST_PATH)) {
		const kill = runCmd(['launchctl', 'kill', 'SIGTERM', `${domain}/${PLIST_LABEL}`]);
		if (kill.ok) {
			process.stdout.write('    Waiting for daemon to stop...');
			for (let i = 0; i < 40; i++) {
				await Bun.sleep(250);
				if (!(await checkSocketAlive())) {
					console.log(' stopped.');
					stopped = true;
					break;
				}
			}
			if (!stopped) {
				console.log(' timed out.');
			}
		}
	}

	// Fallback: PID-based SIGTERM
	if (!stopped && existsSync(PID_PATH)) {
		try {
			const pid = parseInt(readFileSync(PID_PATH, 'utf8').trim(), 10);
			if (!isNaN(pid)) {
				try {
					process.kill(pid, 'SIGTERM');
					console.log(`    Sent SIGTERM to PID ${pid}`);
					await Bun.sleep(2000);
					stopped = true;
				} catch {
					// Process already gone
					stopped = true;
				}
			}
		} catch {
			// PID file read failed
		}
	}

	if (stopped) {
		done.push('Daemon stopped');
	} else {
		failed.push('Could not stop daemon (may need manual cleanup)');
	}
} else {
	console.log('    Daemon not running.');
	skipped.push('Daemon stop (not running)');
}

// ---------------------------------------------------------------------------
// Phase 2: Unload launchd service
// ---------------------------------------------------------------------------

console.log('  Phase 2: Unloading launchd service...');

const bootout = runCmd(['launchctl', 'bootout', `${domain}/${PLIST_LABEL}`]);
if (bootout.ok) {
	console.log(`    Unloaded ${PLIST_LABEL}`);
} else {
	if (bootout.exitCode === 3 || bootout.stderr.includes('Could not find service')) {
		console.log('    Service was not loaded.');
	} else {
		console.log(`    launchctl bootout failed: ${bootout.stderr}`);
		failed.push(`launchctl bootout: ${bootout.stderr}`);
	}
}

if (existsSync(PLIST_PATH)) {
	unlinkSync(PLIST_PATH);
	console.log(`    Removed ${PLIST_PATH}`);
	done.push('Removed launchd plist');
} else {
	skipped.push('Plist removal (not found)');
}

// ---------------------------------------------------------------------------
// Phase 3: Docker & Colima cleanup
// ---------------------------------------------------------------------------

console.log('  Phase 3: Docker & Colima cleanup...');

const whichColima = runCmd(['which', 'colima']);

if (!whichColima.ok) {
	console.log('    Colima not installed, skipping.');
	skipped.push('Colima cleanup (not installed)');
} else {
	// Check if sep-field VM exists
	const colimaList = runCmd(['colima', 'list', '--json']);
	let vmExists = false;
	let vmRunning = false;

	if (colimaList.ok && colimaList.stdout) {
		try {
			// colima list --json outputs one JSON object per line
			const lines = colimaList.stdout.split('\n');
			for (const line of lines) {
				if (!line.trim()) continue;
				const entry = JSON.parse(line);
				if (entry.name === 'sep-field') {
					vmExists = true;
					vmRunning = entry.status === 'Running';
					break;
				}
			}
		} catch {
			// JSON parse failed — try to detect from raw output
			vmExists = colimaList.stdout.includes('sep-field');
		}
	}

	if (!vmExists) {
		console.log('    No sep-field VM found.');
		skipped.push('Colima VM cleanup (not found)');
	} else {
		const dockerSocket = resolve(HOME, '.colima', 'sep-field', 'docker.sock');

		if (vmRunning) {
			// List containers
			const containerList = runCmd([
				'docker', '-H', `unix://${dockerSocket}`,
				'ps', '-a', '-q', '--filter', 'label=devcontainer.local_folder',
			]);

			const containers = containerList.ok && containerList.stdout
				? containerList.stdout.split('\n').filter(Boolean)
				: [];

			if (containers.length > 0) {
				console.log(`    Found ${containers.length} devcontainer(s).`);
			}

			const proceed = await promptYesNo(
				`    Remove ${containers.length} container(s) and Colima VM "sep-field"? [y/N] `,
				false,
			);

			if (proceed) {
				// Remove containers first
				if (containers.length > 0) {
					const rmResult = runCmd([
						'docker', '-H', `unix://${dockerSocket}`,
						'rm', '-f', ...containers,
					]);
					if (rmResult.ok) {
						console.log(`    Removed ${containers.length} container(s).`);
					} else {
						console.log(`    Container removal failed: ${rmResult.stderr}`);
						failed.push('Container removal');
					}
				}

				// Delete the VM (takes all images/volumes with it)
				const deleteResult = runCmd(['colima', 'delete', '--profile', 'sep-field', '--force']);
				if (deleteResult.ok) {
					console.log('    Deleted Colima VM "sep-field".');
					done.push('Removed Colima VM and all containers/images');
				} else {
					console.log(`    Colima delete failed: ${deleteResult.stderr}`);
					failed.push(`Colima delete: ${deleteResult.stderr}`);
				}
			} else {
				console.log('    Skipped.');
				skipped.push('Colima VM cleanup (user declined)');
			}
		} else {
			// VM exists but is stopped — just delete it
			const proceed = await promptYesNo(
				'    Remove stopped Colima VM "sep-field"? [y/N] ',
				false,
			);

			if (proceed) {
				const deleteResult = runCmd(['colima', 'delete', '--profile', 'sep-field', '--force']);
				if (deleteResult.ok) {
					console.log('    Deleted Colima VM "sep-field".');
					done.push('Removed Colima VM');
				} else {
					console.log(`    Colima delete failed: ${deleteResult.stderr}`);
					failed.push(`Colima delete: ${deleteResult.stderr}`);
				}
			} else {
				console.log('    Skipped.');
				skipped.push('Colima VM cleanup (user declined)');
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Phase 4: Preserve user data
// ---------------------------------------------------------------------------

console.log('  Phase 4: Preserving user data...');

let hasUserData = false;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let backupDir = resolve(HOME, 'Desktop', 'sep-field-actions-backup');

// If backup dir exists, append timestamp
if (existsSync(backupDir)) {
	backupDir = resolve(HOME, 'Desktop', `sep-field-actions-backup-${timestamp}`);
}

// Backup user actions
if (existsSync(USER_ACTIONS_DIR)) {
	try {
		const actionFiles = readdirSync(USER_ACTIONS_DIR).filter(f => f.endsWith('.ts'));
		if (actionFiles.length > 0) {
			mkdirSync(resolve(backupDir, 'actions'), { recursive: true });
			for (const file of actionFiles) {
				cpSync(
					resolve(USER_ACTIONS_DIR, file),
					resolve(backupDir, 'actions', file),
				);
			}
			console.log(`    Backed up ${actionFiles.length} user action(s).`);
			hasUserData = true;
		}
	} catch (err) {
		console.log(`    Warning: could not backup actions: ${err}`);
	}
}

// Backup profiles
if (existsSync(PROFILES_DIR)) {
	try {
		const profileFiles = readdirSync(PROFILES_DIR);
		if (profileFiles.length > 0) {
			mkdirSync(resolve(backupDir, 'profiles'), { recursive: true });
			for (const file of profileFiles) {
				const srcPath = resolve(PROFILES_DIR, file);
				const stat = statSync(srcPath);
				if (stat.isFile()) {
					cpSync(srcPath, resolve(backupDir, 'profiles', file));
				}
			}
			console.log(`    Backed up ${profileFiles.length} profile(s).`);
			hasUserData = true;
		}
	} catch (err) {
		console.log(`    Warning: could not backup profiles: ${err}`);
	}
}

if (hasUserData) {
	backupLocation = backupDir;
	console.log(`    Backup location: ${backupDir}`);
	done.push(`User data backed up to ${backupDir}`);
} else {
	console.log('    No user data to preserve.');
}

// ---------------------------------------------------------------------------
// Phase 5: Remove config & runtime files
// ---------------------------------------------------------------------------

console.log('  Phase 5: Removing config & runtime files...');

const cleanupTargets = [
	{ path: CONFIG_DIR, label: '~/.config/sep-field/' },
	{ path: LOG_DIR, label: '~/Library/Logs/sep-field/' },
	{ path: SOCKET_PATH, label: '/tmp/sep-field.sock' },
	{ path: PID_PATH, label: '/tmp/sep-field.pid' },
];

for (const { path, label } of cleanupTargets) {
	if (existsSync(path)) {
		try {
			rmSync(path, { recursive: true, force: true });
			console.log(`    Removed ${label}`);
		} catch (err) {
			console.log(`    Failed to remove ${label}: ${err}`);
			failed.push(`Remove ${label}`);
		}
	}
}

done.push('Removed config and runtime files');

// ---------------------------------------------------------------------------
// Phase 6: Remove CLI shim
// ---------------------------------------------------------------------------

console.log('  Phase 6: Removing CLI shim...');

const shimPath = resolve(HOME, '.bun', 'bin', 'sep');
if (existsSync(shimPath)) {
	try {
		unlinkSync(shimPath);
		console.log(`    Removed ${shimPath}`);
		done.push('Removed CLI shim');
	} catch (err) {
		console.log(`    Failed to remove shim: ${err}`);
		failed.push('Remove CLI shim');
	}
} else {
	skipped.push('CLI shim removal (not found)');
}

// ---------------------------------------------------------------------------
// Phase 7: Remove installation directory
// ---------------------------------------------------------------------------

if (removeRepo) {
	console.log('  Phase 7: Removing installation directory...');

	// Check for agent sandboxes with uncommitted changes
	const testSpaceDir = resolve(PROJECT_ROOT, 'test-space');
	if (existsSync(testSpaceDir)) {
		try {
			const entries = readdirSync(testSpaceDir).filter(e => e.match(/^agent\d+-sandbox$/));
			if (entries.length > 0) {
				console.log(`    Warning: Found ${entries.length} agent sandbox(es):`);
				for (const entry of entries) {
					const sandboxPath = resolve(testSpaceDir, entry);
					const gitDir = resolve(sandboxPath, '.git');
					let status = '';
					if (existsSync(gitDir)) {
						const diff = runCmd(['git', '-C', sandboxPath, 'status', '--porcelain']);
						if (diff.ok && diff.stdout) {
							status = ' (has uncommitted changes)';
						}
					}
					console.log(`      - ${entry}${status}`);
				}
			}
		} catch {
			// test-space scan failed, not critical
		}
	}

	const confirmed = await promptExact(
		`    Remove installation at ${PROJECT_ROOT}? Type "DELETE" to confirm: `,
		'DELETE',
	);

	if (confirmed) {
		// Self-deletion: spawn detached bash process since we're inside the dir
		const child = Bun.spawn(
			['bash', '-c', `sleep 1 && rm -rf "${PROJECT_ROOT}"`],
			{
				stdio: ['ignore', 'ignore', 'ignore'],
			},
		);
		child.unref();
		console.log('    Installation directory will be removed.');
		done.push('Installation directory scheduled for removal');
	} else {
		console.log('    Skipped.');
		skipped.push('Installation directory removal (user declined)');
	}
} else {
	console.log('  Phase 7: Skipping installation directory (use --remove-repo to include).');
	skipped.push('Installation directory removal (use --remove-repo)');
}

// ---------------------------------------------------------------------------
// Phase 8: Summary
// ---------------------------------------------------------------------------

console.log('');
console.log('  ─── Uninstall Summary ───');
console.log('');

if (done.length > 0) {
	for (const item of done) {
		console.log(`  ✓ ${item}`);
	}
}

if (skipped.length > 0) {
	for (const item of skipped) {
		console.log(`  - ${item}`);
	}
}

if (failed.length > 0) {
	console.log('');
	for (const item of failed) {
		console.log(`  ✗ ${item}`);
	}
}

if (backupLocation) {
	console.log('');
	console.log(`  User data backed up to: ${backupLocation}`);
}

if (!removeRepo) {
	console.log('');
	console.log(`  To also remove the installation: sep uninstall --remove-repo`);
}

console.log('');
