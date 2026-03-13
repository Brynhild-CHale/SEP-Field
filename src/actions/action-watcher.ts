/**
 * Action Watcher — hot-reload actions on file changes
 *
 * Watches the user actions directory with fs.watch(), debounces changes,
 * and reloads actions in-place in the shared Map.
 *
 * Built-in action names are protected from deletion — the watcher
 * only manages user-provided actions.
 */

import { watch, type FSWatcher } from 'fs';
import { resolve } from 'path';
import { validateAction } from './action-loader.ts';
import type { Action, Logger } from '../types/index.ts';

const DEBOUNCE_MS = 300;

export class ActionWatcher {
	private dir: string;
	private actions: Map<string, Action>;
	private logger: Logger;
	private builtinActions: Map<string, Action>;
	private watcher: FSWatcher | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private onReload?: () => void | Promise<void>;

	constructor(
		dir: string,
		actions: Map<string, Action>,
		logger: Logger,
		builtinActions: Map<string, Action>,
		onReload?: () => void | Promise<void>,
	) {
		this.dir = dir;
		this.actions = actions;
		this.logger = logger;
		this.builtinActions = builtinActions;
		this.onReload = onReload;
	}

	start(): void {
		this.watcher = watch(this.dir, (_event, filename) => {
			if (!filename || !filename.endsWith('.ts')) return;
			this.scheduleReload();
		});
		this.logger.log('Action watcher started');
	}

	stop(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
		this.logger.log('Action watcher stopped');
	}

	private scheduleReload(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.reload();
		}, DEBOUNCE_MS);
	}

	private async reload(): Promise<void> {
		this.logger.log('Hot-reloading user actions...');

		const glob = new Bun.Glob('*.ts');
		const entries = Array.from(glob.scanSync({ cwd: this.dir, absolute: false }));
		const validEntries = entries.filter((e) => e.endsWith('.ts'));

		// Track which action names came from which files in this scan
		const scannedActions = new Map<string, Action>();
		const fileForName = new Map<string, string>();

		for (const entry of validEntries) {
			const filePath = resolve(this.dir, entry);
			try {
				// Cache-bust the import
				const mod = await import(`${filePath}?t=${Date.now()}`);
				if (!mod.action) continue;

				const err = validateAction(mod.action, entry);
				if (err) {
					this.logger.error(`Hot-reload validation error: ${err}`);
					continue;
				}

				const action = mod.action as Action;

				// Check for name conflicts within this scan
				if (scannedActions.has(action.name)) {
					const existingFile = fileForName.get(action.name);
					this.logger.error(
						`Hot-reload: name conflict for '${action.name}' — ` +
						`${entry} rejected, keeping ${existingFile}`,
					);
					continue;
				}

				scannedActions.set(action.name, action);
				fileForName.set(action.name, entry);
			} catch (e) {
				this.logger.error(`Hot-reload: failed to import ${entry} — ${e}`);
			}
		}

		// Update the shared Map in-place: restore/remove stale, add/update current
		for (const name of this.actions.keys()) {
			if (!scannedActions.has(name) && this.builtinActions.has(name)) {
				this.actions.set(name, this.builtinActions.get(name)!);
				this.logger.log(`Built-in action restored: ${name}`);
			} else if (!scannedActions.has(name)) {
				this.actions.delete(name);
				this.logger.log(`User action removed: ${name}`);
			}
		}
		for (const [name, action] of scannedActions) {
			if (!this.actions.has(name)) {
				this.logger.log(`User action added: ${name}`);
			} else if (this.builtinActions.has(name)) {
				this.logger.log(`User action '${name}' overrides built-in`);
			}
			this.actions.set(name, action);
		}

		this.logger.log(`Hot-reload complete — ${this.actions.size} actions loaded`);

		if (this.onReload) {
			try {
				await this.onReload();
			} catch (e) {
				this.logger.error(`Post-reload hook failed: ${e}`);
			}
		}
	}
}
