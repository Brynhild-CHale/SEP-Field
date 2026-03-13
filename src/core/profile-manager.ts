/**
 * ProfileManager — CRUD for container profiles
 *
 * Profiles are stored as JSON files in ~/.config/sep-field/profiles/.
 * Each profile defines devcontainer overrides that can be applied when
 * creating an agent session.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { PROFILES_DIR } from '../service/paths.ts';
import type { ContainerProfile, Logger } from '../types/index.ts';

export class ProfileManager {
	private logger: Logger;
	private profilesDir: string;

	constructor(logger: Logger) {
		this.logger = logger;
		this.profilesDir = PROFILES_DIR;
		mkdirSync(this.profilesDir, { recursive: true });
	}

	/** List all available profiles. */
	list(): ContainerProfile[] {
		const profiles: ContainerProfile[] = [];
		let files: string[];
		try {
			files = readdirSync(this.profilesDir).filter(f => f.endsWith('.json'));
		} catch {
			return profiles;
		}

		for (const file of files) {
			try {
				const raw = readFileSync(resolve(this.profilesDir, file), 'utf8');
				profiles.push(JSON.parse(raw) as ContainerProfile);
			} catch (err) {
				this.logger.error(`Failed to read profile ${file}: ${err}`);
			}
		}

		return profiles;
	}

	/** Get a specific profile by name. */
	get(name: string): ContainerProfile | null {
		const filePath = resolve(this.profilesDir, `${name}.json`);
		if (!existsSync(filePath)) return null;
		try {
			return JSON.parse(readFileSync(filePath, 'utf8')) as ContainerProfile;
		} catch (err) {
			this.logger.error(`Failed to read profile ${name}: ${err}`);
			return null;
		}
	}

	/** Create or update a profile. */
	save(profile: ContainerProfile): void {
		const filePath = resolve(this.profilesDir, `${profile.name}.json`);
		writeFileSync(filePath, JSON.stringify(profile, null, '\t') + '\n');
		this.logger.log(`Profile saved: ${profile.name}`);
	}

	/** Delete a profile. Returns true if deleted, false if not found. */
	delete(name: string): boolean {
		const filePath = resolve(this.profilesDir, `${name}.json`);
		if (!existsSync(filePath)) return false;
		unlinkSync(filePath);
		this.logger.log(`Profile deleted: ${name}`);
		return true;
	}

	/**
	 * Convert a profile name to devcontainer overrides.
	 * Returns null if the profile doesn't exist.
	 */
	profileToOverrides(profileName: string): Record<string, unknown> | null {
		const profile = this.get(profileName);
		if (!profile) return null;

		const overrides: Record<string, unknown> = {};

		if (profile.image) overrides.image = profile.image;
		if (profile.features) overrides.features = profile.features;
		if (profile.postCreateCommand) overrides.postCreateCommand = profile.postCreateCommand;
		if (profile.runArgs) overrides.runArgs = profile.runArgs;
		if (profile.mounts) overrides.mounts = profile.mounts;
		if (profile.remoteEnv) overrides.remoteEnv = profile.remoteEnv;

		return overrides;
	}
}
