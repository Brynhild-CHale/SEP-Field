/**
 * Action Loader — runtime discovery and validation of action modules
 *
 * Scans a directory for .ts files, dynamically imports each, and validates
 * the exported `action` object against the Action interface shape.
 */

import { resolve } from 'path';
import type { Action, Logger } from '../types/index.ts';

const BUILTIN_SKIP_FILES = new Set(['index.ts', 'action-loader.ts', 'action-watcher.ts']);

/**
 * Validate that an object conforms to the Action interface at runtime.
 * Returns an error string if invalid, or null if valid.
 */
export function validateAction(obj: unknown, filePath: string): string | null {
	if (!obj || typeof obj !== 'object') {
		return `${filePath}: export is not an object`;
	}

	const a = obj as Record<string, unknown>;

	if (typeof a.name !== 'string' || a.name.length === 0) {
		return `${filePath}: missing or invalid 'name' (expected non-empty string)`;
	}
	if (typeof a.description !== 'string') {
		return `${filePath}: missing or invalid 'description' (expected string)`;
	}
	if (!Array.isArray(a.params)) {
		return `${filePath}: missing or invalid 'params' (expected array)`;
	}
	if (typeof a.execute !== 'function') {
		return `${filePath}: missing or invalid 'execute' (expected function)`;
	}

	return null;
}

export interface LoadResult {
	actions: Action[];
	errors: string[];
}

/**
 * Scan a directory for .ts action files, dynamically import each,
 * and return validated Action objects.
 */
export async function loadActionsFromDirectory(
	dir: string,
	logger: Logger,
	skipFiles: Set<string> = BUILTIN_SKIP_FILES,
): Promise<LoadResult> {
	const actions: Action[] = [];
	const errors: string[] = [];

	const glob = new Bun.Glob('*.ts');
	const entries = glob.scanSync({ cwd: dir, absolute: false });

	for (const entry of entries) {
		if (skipFiles.has(entry)) continue;

		const filePath = resolve(dir, entry);
		try {
			const mod = await import(filePath);
			if (!mod.action) {
				// Silently skip files without an action export
				continue;
			}

			const err = validateAction(mod.action, entry);
			if (err) {
				errors.push(err);
				continue;
			}

			actions.push(mod.action as Action);
		} catch (e) {
			errors.push(`${entry}: failed to import — ${e}`);
		}
	}

	return { actions, errors };
}
