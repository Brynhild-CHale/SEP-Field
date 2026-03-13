/**
 * Centralized path constants for the SEP-Field daemon.
 *
 * Environment variable overrides allow the launchd plist to pass explicit paths,
 * and enable running multiple instances for testing.
 */

import { resolve } from 'path';

const HOME = process.env.HOME || '/tmp';

export const SOCKET_PATH = process.env.SEP_FIELD_SOCKET || '/tmp/sep-field.sock';
export const PID_PATH    = process.env.SEP_FIELD_PID    || '/tmp/sep-field.pid';
export const LOG_DIR     = resolve(HOME, 'Library', 'Logs', 'sep-field');
export const LOG_PATH    = process.env.SEP_FIELD_LOG    || resolve(LOG_DIR, 'daemon.log');

export const PLIST_LABEL    = 'com.sep-field.daemon';
export const PLIST_PATH     = resolve(HOME, 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
export const PROJECT_ROOT   = resolve(import.meta.dir, '../..');
export const WRAPPER_PATH   = resolve(PROJECT_ROOT, 'src', 'service', 'wrapper.sh');

export const CONFIG_DIR       = resolve(HOME, '.config', 'sep-field');
export const USER_ACTIONS_DIR = resolve(CONFIG_DIR, 'actions');
export const CONFIG_PATH      = resolve(CONFIG_DIR, 'config.json');
export const PROFILES_DIR     = resolve(CONFIG_DIR, 'profiles');

// Backward compat aliases — existing code imports these names from protocol.ts
export const ORCHESTRATOR_SOCKET_PATH = SOCKET_PATH;
export const ORCHESTRATOR_PID_PATH    = PID_PATH;
export const ORCHESTRATOR_LOG_PATH    = LOG_PATH;
