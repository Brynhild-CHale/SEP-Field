/**
 * Preflight — shared prerequisite checker
 *
 * Pure functions for checking system requirements and detecting specs.
 * Used by both install.ts and start.ts.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { CONFIG_PATH, CONFIG_DIR } from './paths.ts';

// --- Types ---

export interface PrerequisiteResult {
	name: string;
	found: boolean;
	path?: string;
	installHint: string;
}

export interface PreflightReport {
	all: PrerequisiteResult[];
	passed: boolean;
	warnings: PrerequisiteResult[];
}

export interface SystemSpecs {
	totalCpus: number;
	totalMemGB: number;
}

export interface VMConfig {
	cpus: number;
	memoryGB: number;
	vmType: string;
}

// --- Prerequisite checking ---

function checkPrerequisite(name: string, installHint: string): PrerequisiteResult {
	const result = Bun.spawnSync(['which', name], {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	if (result.exitCode === 0) {
		return {
			name,
			found: true,
			path: result.stdout.toString().trim(),
			installHint,
		};
	}

	return { name, found: false, installHint };
}

/**
 * Run all prerequisite checks.
 * colima and docker are hard requirements (passed = false if missing).
 * devcontainer is a soft warning.
 */
export function runPreflight(): PreflightReport {
	const colima = checkPrerequisite('colima', 'brew install colima');
	const docker = checkPrerequisite('docker', 'brew install docker');
	const devcontainer = checkPrerequisite('devcontainer', 'npm install -g @devcontainers/cli');

	const all = [colima, docker, devcontainer];
	const passed = colima.found && docker.found;
	const warnings = all.filter(r => !r.found && r.name === 'devcontainer');

	return { all, passed, warnings };
}

/**
 * Print the preflight report to stdout.
 */
export function printPreflightReport(report: PreflightReport): void {
	console.log('  Checking prerequisites...');
	for (const r of report.all) {
		if (r.found) {
			console.log(`    \x1B[32m✓\x1B[0m ${r.name.padEnd(14)} ${r.path}`);
		} else if (report.warnings.includes(r)) {
			console.log(`    \x1B[33m⚠\x1B[0m ${r.name.padEnd(14)} not found — agent creation will fail until installed`);
			console.log(`${''.padEnd(20)}Install: ${r.installHint}`);
		} else {
			console.log(`    \x1B[31m✗\x1B[0m ${r.name.padEnd(14)} not found`);
			console.log(`${''.padEnd(20)}Install: ${r.installHint}`);
		}
	}

	if (!report.passed) {
		console.log('');
		console.log('  \x1B[31mRequired prerequisites missing. Cannot continue.\x1B[0m');
	}
}

// --- System spec detection ---

/**
 * Detect raw system specs (total CPUs and RAM).
 */
export function detectSystemSpecs(): SystemSpecs {
	const cpuResult = Bun.spawnSync(['sysctl', '-n', 'hw.ncpu'], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const totalCpus = parseInt(cpuResult.stdout.toString().trim(), 10) || 4;

	const memResult = Bun.spawnSync(['sysctl', '-n', 'hw.memsize'], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const totalMemGB = Math.floor(
		(parseInt(memResult.stdout.toString().trim(), 10) || 8589934592) / 1073741824,
	);

	return { totalCpus, totalMemGB };
}

/**
 * Compute default VM config from system specs.
 * CPUs = total - 1 (min 2), RAM = total - 2 (min 4).
 */
export function computeDefaults(specs: SystemSpecs): VMConfig {
	return {
		cpus: Math.max(specs.totalCpus - 1, 2),
		memoryGB: Math.max(specs.totalMemGB - 2, 4),
		vmType: 'vz',
	};
}

/**
 * Read existing VM config from config.json, or null if not present.
 */
export function readExistingVMConfig(): VMConfig | null {
	try {
		if (existsSync(CONFIG_PATH)) {
			const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
			const vm = raw?.vm;
			if (vm) {
				return {
					cpus: vm.cpus ?? 0,
					memoryGB: vm.memoryGB ?? 0,
					vmType: vm.vmType ?? 'vz',
				};
			}
		}
	} catch { /* ignore */ }
	return null;
}

/**
 * Write VM config to config.json, preserving other keys.
 */
export function writeVMConfig(config: VMConfig): void {
	mkdirSync(CONFIG_DIR, { recursive: true });

	let existing: Record<string, unknown> = {};
	try {
		if (existsSync(CONFIG_PATH)) {
			existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
		}
	} catch { /* start fresh */ }

	existing.vm = {
		cpus: config.cpus,
		memoryGB: config.memoryGB,
		vmType: config.vmType,
	};

	writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, '\t') + '\n');
}
