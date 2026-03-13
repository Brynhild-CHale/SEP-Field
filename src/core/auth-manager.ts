/**
 * AuthManager — Keychain credential sync + OAuth refresh
 *
 * Reads OAuth credentials from macOS Keychain, refreshes tokens before expiry,
 * and writes to ~/.claude/.credentials.json for containers to read via bind mount.
 *
 * Extracted from orchestrator.ts (lines 44-324). Zero coupling to sessions,
 * containers, or sockets.
 */

import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Logger } from '../types/index.ts';

// --- Constants ---
const MIN_REFRESH_INTERVAL_MS = 60_000; // 1 min floor to avoid tight loops
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000; // refresh 10 min before expiry
const OAUTH_TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// --- Private interfaces ---

interface OAuthCredentials {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	scopes: string[];
	subscriptionType?: string;
	rateLimitTier?: string;
}

interface CredentialsFile {
	claudeAiOauth: OAuthCredentials;
	organizationUuid?: string;
}

export class AuthManager {
	private syncTimeout: ReturnType<typeof setTimeout> | null = null;
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	/** Start credential sync — reads Keychain, refreshes if needed, schedules next refresh. */
	async start(): Promise<void> {
		const expiresAt = await this.syncKeychainCredentials();
		if (expiresAt) {
			this.scheduleNextRefresh(expiresAt);
		}
	}

	/** Stop credential sync — clears any pending refresh timer. */
	stop(): void {
		if (this.syncTimeout) {
			clearTimeout(this.syncTimeout);
			this.syncTimeout = null;
		}
	}

	private readKeychainCredentials(): CredentialsFile | null {
		const result = Bun.spawnSync(
			['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
			{ stdout: 'pipe', stderr: 'pipe' },
		);

		if (result.exitCode !== 0) {
			this.logger.error(`Keychain read failed (exit ${result.exitCode}): ${result.stderr.toString()}`);
			return null;
		}

		try {
			return JSON.parse(result.stdout.toString().trim()) as CredentialsFile;
		} catch (err) {
			this.logger.error(`Failed to parse Keychain credentials: ${err}`);
			return null;
		}
	}

	private writeKeychainCredentials(creds: CredentialsFile): boolean {
		const account = process.env.USER || 'unknown';
		const json = JSON.stringify(creds);

		const result = Bun.spawnSync(
			['security', 'add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', account, '-w', json],
			{ stdout: 'pipe', stderr: 'pipe' },
		);

		if (result.exitCode !== 0) {
			this.logger.error(`Keychain write failed: ${result.stderr.toString()}`);
			return false;
		}
		return true;
	}

	private writeCredentialsFile(creds: CredentialsFile): void {
		const credPath = resolve(process.env.HOME || '', '.claude', '.credentials.json');
		writeFileSync(credPath, JSON.stringify(creds, null, '  ') + '\n');
	}

	private async refreshOAuthToken(creds: CredentialsFile): Promise<CredentialsFile | null> {
		const oauth = creds.claudeAiOauth;
		this.logger.log('Attempting OAuth token refresh...');

		try {
			const body = new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: oauth.refreshToken,
				client_id: OAUTH_CLIENT_ID,
			});

			const response = await fetch(OAUTH_TOKEN_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: body.toString(),
			});

			if (!response.ok) {
				const text = await response.text();
				this.logger.error(`OAuth refresh failed (${response.status}): ${text}`);
				return null;
			}

			const data = await response.json() as {
				access_token: string;
				refresh_token: string;
				expires_in: number;
				scope?: string;
			};

			const refreshed: CredentialsFile = {
				...creds,
				claudeAiOauth: {
					...oauth,
					accessToken: data.access_token,
					refreshToken: data.refresh_token,
					expiresAt: Date.now() + data.expires_in * 1000,
					scopes: data.scope ? data.scope.split(' ') : oauth.scopes,
				},
			};

			this.logger.log(`OAuth refresh succeeded — new token expires at ${new Date(refreshed.claudeAiOauth.expiresAt).toISOString()}`);
			return refreshed;
		} catch (err) {
			this.logger.error(`OAuth refresh error: ${err}`);
			return null;
		}
	}

	private async syncKeychainCredentials(): Promise<number | null> {
		// 1. Read from Keychain
		const creds = this.readKeychainCredentials();
		if (!creds || !creds.claudeAiOauth) {
			this.logger.error('No credentials in Keychain — has Claude been authenticated on the host?');
			return null;
		}

		const oauth = creds.claudeAiOauth;
		const now = Date.now();
		const timeUntilExpiry = oauth.expiresAt - now;

		// 2. Check if token needs refresh
		if (timeUntilExpiry <= TOKEN_REFRESH_BUFFER_MS) {
			const state = timeUntilExpiry <= 0 ? 'expired' : `expires in ${Math.round(timeUntilExpiry / 60000)}min`;
			this.logger.log(`Access token ${state} — refreshing...`);

			const refreshed = await this.refreshOAuthToken(creds);
			if (refreshed) {
				this.writeKeychainCredentials(refreshed);
				this.writeCredentialsFile(refreshed);
				this.logger.log('Synced refreshed credentials to Keychain + .credentials.json');
				return refreshed.claudeAiOauth.expiresAt;
			}

			this.logger.error('Token refresh failed — writing current Keychain credentials to file');
		} else {
			const minsLeft = Math.round(timeUntilExpiry / 60000);
			this.logger.log(`Access token valid for ${minsLeft}min — syncing Keychain -> .credentials.json`);
		}

		// 3. Write current Keychain credentials to file
		this.writeCredentialsFile(creds);
		return oauth.expiresAt;
	}

	private scheduleNextRefresh(expiresAt: number): void {
		if (this.syncTimeout) {
			clearTimeout(this.syncTimeout);
		}
		const delay = Math.max(expiresAt - TOKEN_REFRESH_BUFFER_MS - Date.now(), MIN_REFRESH_INTERVAL_MS);
		const minsUntil = Math.round(delay / 60000);
		this.logger.log(`Next token refresh scheduled in ${minsUntil}min (at ${new Date(Date.now() + delay).toISOString()})`);
		this.syncTimeout = setTimeout(async () => {
			const newExpiresAt = await this.syncKeychainCredentials();
			if (newExpiresAt) {
				this.scheduleNextRefresh(newExpiresAt);
			}
		}, delay);
	}
}
