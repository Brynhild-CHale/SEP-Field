/**
 * ColimaManager — Single VM lifecycle management
 *
 * One large Colima VM with Apple Virtualization (vz) balloon memory.
 * Auto-detects system specs (CPUs - 1, RAM - 2 GB), configurable via
 * ~/.config/sep-field/config.json. Eager pre-warm on daemon start:
 * start VM + build default image so first agent creation is fast.
 *
 * Single Docker socket at ~/.colima/sep-field/docker.sock.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import {
	detectSystemSpecs,
	computeDefaults,
	readExistingVMConfig,
	type VMConfig,
} from '../service/preflight.ts';
import type { Logger } from '../types/index.ts';

const HOME = process.env.HOME || '/tmp';
const PROFILE = 'sep-field';

export class ColimaManager {
	private status: 'stopped' | 'starting' | 'ready' = 'stopped';
	private readyPromise: Promise<void> | null = null;
	private profile = PROFILE;
	private socketPath: string;
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
		this.socketPath = resolve(HOME, '.colima', PROFILE, 'docker.sock');
	}

	/**
	 * Detect system specs and apply config overrides.
	 * Uses shared preflight functions to avoid duplicated sysctl logic.
	 */
	private resolveVMConfig(): VMConfig {
		const specs = detectSystemSpecs();
		const defaults = computeDefaults(specs);
		const overrides = readExistingVMConfig();

		if (overrides) {
			if (overrides.cpus) defaults.cpus = overrides.cpus;
			if (overrides.memoryGB) defaults.memoryGB = overrides.memoryGB;
			if (overrides.vmType) defaults.vmType = overrides.vmType;
		}

		return defaults;
	}

	/**
	 * Start the single VM eagerly on daemon boot.
	 * If already running, just verify connectivity.
	 */
	async start(): Promise<void> {
		if (this.readyPromise) return this.readyPromise;

		this.readyPromise = this._start();
		return this.readyPromise;
	}

	private async _start(): Promise<void> {
		// Verify colima CLI exists
		const colimaCheck = Bun.spawnSync(['which', 'colima'], {
			stdout: 'pipe', stderr: 'pipe',
		});
		if (colimaCheck.exitCode !== 0) {
			throw new Error('colima CLI not found. Install with: brew install colima');
		}

		this.status = 'starting';
		const specs = this.resolveVMConfig();
		this.logger.log(`Starting VM with ${specs.cpus} CPU, ${specs.memoryGB} GB RAM`);

		// Check if the profile is already running
		if (this.isProfileRunning()) {
			// Verify Docker is responsive
			if (existsSync(this.socketPath)) {
				const check = Bun.spawnSync(
					['docker', '--host', `unix://${this.socketPath}`, 'info'],
					{ stdout: 'pipe', stderr: 'pipe' },
				);
				if (check.exitCode === 0) {
					this.status = 'ready';
					this.logger.log(`Colima profile ${this.profile} already running and responsive`);
					return;
				}
			}
			// Not responsive — stop and restart
			this.logger.log(`Colima profile ${this.profile} running but not responsive, restarting...`);
			const stopProc = Bun.spawn(['colima', 'stop', '--profile', this.profile], {
				stdout: 'pipe', stderr: 'pipe',
			});
			await stopProc.exited;
		}

		// Start the VM
		const args = [
			'colima', 'start',
			'--profile', this.profile,
			'--cpu', String(specs.cpus),
			'--memory', String(specs.memoryGB),
			'--vm-type', specs.vmType,
			'--activate=false',
		];

		this.logger.log(`Starting Colima: ${args.join(' ')}`);

		const proc = Bun.spawn(args, {
			stdout: 'pipe', stderr: 'pipe',
		});

		const exitCode = await proc.exited;
		const stderr = await new Response(proc.stderr).text();

		if (exitCode !== 0) {
			this.status = 'stopped';
			throw new Error(`Failed to start Colima VM: ${stderr}`);
		}

		// Wait for Docker socket
		await this.waitForSocket();

		this.status = 'ready';
		this.logger.log(`Colima VM ready (profile: ${this.profile}, socket: ${this.socketPath})`);
	}

	/**
	 * Wait for VM to be ready. Called before container ops.
	 */
	async ensureReady(): Promise<void> {
		if (this.status === 'ready') return;
		if (this.readyPromise) return this.readyPromise;
		throw new Error('ColimaManager not started — call start() first');
	}

	/**
	 * Single Docker host — no agentId needed.
	 */
	getDockerHost(): string {
		return `unix://${this.socketPath}`;
	}

	/**
	 * Build env object with DOCKER_HOST set.
	 */
	getDockerEnv(): Record<string, string | undefined> {
		return { ...process.env, DOCKER_HOST: `unix://${this.socketPath}` };
	}

	/**
	 * Check if the VM profile is running.
	 */
	isRunning(): boolean {
		return this.status === 'ready';
	}

	/**
	 * Shutdown: stop and delete the VM.
	 */
	async shutdown(): Promise<void> {
		this.logger.log('ColimaManager shutting down...');

		const stopProc = Bun.spawn(['colima', 'stop', '--profile', this.profile], {
			stdout: 'pipe', stderr: 'pipe',
		});
		await stopProc.exited;

		const deleteProc = Bun.spawn(['colima', 'delete', '--profile', this.profile, '--force'], {
			stdout: 'pipe', stderr: 'pipe',
		});
		await deleteProc.exited;

		this.status = 'stopped';
		this.readyPromise = null;
		this.logger.log('Colima VM stopped and deleted');
	}

	// --- Private ---

	private isProfileRunning(): boolean {
		const result = Bun.spawnSync(['colima', 'list', '--json'], {
			stdout: 'pipe', stderr: 'pipe',
		});
		if (result.exitCode !== 0) return false;

		const output = result.stdout.toString().trim();
		if (!output) return false;

		for (const line of output.split('\n')) {
			try {
				const entry = JSON.parse(line);
				if (entry.name === this.profile && entry.status === 'Running') {
					return true;
				}
			} catch { /* skip */ }
		}
		return false;
	}

	private async waitForSocket(timeoutMs = 60000): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			if (existsSync(this.socketPath)) {
				const check = Bun.spawnSync(
					['docker', '--host', `unix://${this.socketPath}`, 'info'],
					{ stdout: 'pipe', stderr: 'pipe' },
				);
				if (check.exitCode === 0) return;
			}
			await Bun.sleep(500);
		}
		throw new Error(`Timed out waiting for Docker socket at ${this.socketPath}`);
	}
}
