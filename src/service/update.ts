#!/usr/bin/env bun
/**
 * Self-updater for SEP-Field.
 *
 * Pulls latest changes from the remote git repo, reinstalls deps if needed,
 * and advises on daemon restart. Designed to run outside the daemon process.
 */

import { PROJECT_ROOT } from './paths.ts';
import { checkSocketAlive } from './liveness.ts';

function run(cmd: string[]): { stdout: string; stderr: string; exitCode: number } {
	const result = Bun.spawnSync(cmd, { cwd: PROJECT_ROOT });
	return {
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
		exitCode: result.exitCode,
	};
}

async function main() {
	// 1. Verify PROJECT_ROOT is a git repo
	const gitCheck = run(['git', 'rev-parse', '--is-inside-work-tree']);
	if (gitCheck.exitCode !== 0) {
		console.error('Error: SEP-Field directory is not a git repository.');
		console.error(`  Path: ${PROJECT_ROOT}`);
		process.exit(1);
	}

	// 2. Check for uncommitted changes
	const status = run(['git', 'status', '--porcelain']);
	if (status.stdout.length > 0) {
		console.error('Error: Working directory has uncommitted changes.');
		console.error('Commit or stash your changes before updating.');
		console.error('');
		console.error(status.stdout);
		process.exit(1);
	}

	console.log('Checking for updates...');

	// 3. git fetch origin
	const fetch = run(['git', 'fetch', 'origin']);
	if (fetch.exitCode !== 0) {
		console.error('Error: Failed to fetch from remote.');
		console.error(fetch.stderr);
		process.exit(1);
	}

	// 4. Compare local HEAD vs remote HEAD
	const branch = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).stdout;
	const localHead = run(['git', 'rev-parse', 'HEAD']).stdout;
	const remoteHead = run(['git', 'rev-parse', `origin/${branch}`]);

	if (remoteHead.exitCode !== 0) {
		console.error(`Error: No remote tracking branch origin/${branch} found.`);
		process.exit(1);
	}

	const localShort = localHead.slice(0, 7);
	const remoteShort = remoteHead.stdout.slice(0, 7);

	if (localHead === remoteHead.stdout) {
		console.log(`Already up to date. (${localShort} on ${branch})`);
		process.exit(0);
	}

	// Show what's incoming
	console.log(`Current: ${localShort} (${branch})`);
	console.log(`Remote:  ${remoteShort}`);
	console.log('');

	const log = run(['git', 'log', '--oneline', `HEAD..origin/${branch}`]);
	const commits = log.stdout.split('\n').filter(Boolean);
	console.log(`${commits.length} new commit${commits.length === 1 ? '' : 's'}:`);
	for (const line of commits) {
		console.log(`  ${line}`);
	}
	console.log('');

	// 5. Prompt user
	process.stdout.write('Update now? [y/N] ');
	const reader = Bun.stdin.stream().getReader();
	const { value } = await reader.read();
	reader.releaseLock();
	const answer = value ? new TextDecoder().decode(value).trim().toLowerCase() : '';

	if (answer !== 'y' && answer !== 'yes') {
		console.log('Aborted.');
		process.exit(0);
	}

	console.log('');
	console.log('Pulling updates...');

	// 6. git pull --ff-only
	const pull = run(['git', 'pull', '--ff-only']);
	if (pull.exitCode !== 0) {
		console.error('Error: Fast-forward pull failed — your branch has diverged from remote.');
		console.error('Resolve manually with: git pull --rebase origin/' + branch);
		process.exit(1);
	}

	// 7. Check if bun.lock changed
	const diffFiles = run(['git', 'diff', '--name-only', `${localHead}..HEAD`]);
	const changedFiles = diffFiles.stdout.split('\n');
	if (changedFiles.includes('bun.lock') || changedFiles.includes('package.json')) {
		console.log('Dependencies changed — running bun install...');
		const install = run(['bun', 'install']);
		if (install.exitCode !== 0) {
			console.error('Warning: bun install failed.');
			console.error(install.stderr);
		}
	}

	console.log(`Done. ${commits.length} commit${commits.length === 1 ? '' : 's'} applied.`);

	// 8. Check if daemon is running
	const alive = await checkSocketAlive();
	if (alive) {
		console.log('');
		console.log('Note: daemon is running — restart with `sep stop && sep start` to apply.');
	}
}

main().catch((err) => {
	console.error('Update failed:', err.message);
	process.exit(1);
});
