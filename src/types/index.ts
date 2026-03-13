/**
 * Shared types for SEP-Field
 *
 * All interfaces and types used across modules. This file imports nothing
 * from src/ to remain at the root of the dependency graph.
 */

import type { Terminal as XtermTerminal } from '@xterm/headless';

// --- Session type ---

export type SessionType = 'claude' | 'shell';

// --- Agent state (from stateDetector) ---

export type AgentState = 'busy' | 'waiting' | 'idle' | 'complete';

// --- Agent configuration ---

export interface AgentConfig {
	id: string;
	name: string;
	cwd: string;
	prompt?: string;
	devcontainerOverrides?: Record<string, unknown>;
	sessionType?: SessionType;
	profile?: string;
}

// --- Container profile ---

export interface ContainerProfile {
	name: string;
	description: string;
	image?: string;
	features?: Record<string, unknown>;
	postCreateCommand?: string;
	runArgs?: string[];
	mounts?: Array<{ source: string; target: string; type: string }>;
	remoteEnv?: Record<string, string>;
}

// --- Per-session state ---

export interface ManagedSession {
	id: string;
	name: string;
	cwd: string;
	prompt?: string;
	terminal: InstanceType<typeof Bun.Terminal> | null;
	subprocess: ReturnType<typeof Bun.spawn> | null;
	outputHistory: Buffer[];
	historySize: number;
	decoder: TextDecoder;
	dataBuffer: string;
	syncOutputMode: boolean;
	flushTimer: ReturnType<typeof setTimeout> | null;
	exited: boolean;
	exitCode: number | null;
	starting: boolean;
	startError: string | null;
	// State tracking
	xtermTerminal: XtermTerminal;
	agentState: AgentState;
	pendingAgentState: AgentState | null;
	pendingAgentStateStart: number;
	stateCheckInterval: ReturnType<typeof setInterval> | null;
	sessionType: SessionType;
}

// --- Session info (sent to clients) ---

export interface SessionInfo {
	id: string;
	name: string;
	status: 'starting' | 'running' | 'exited';
	exitCode?: number;
	agentState: AgentState;
	locked?: boolean;
	sessionType?: SessionType;
}

// --- Action registry ---

export interface ActionParams {
	[key: string]: unknown;
}

export interface ActionResult {
	success: boolean;
	data?: unknown;
	error?: string;
}

export interface SelectOption {
	value: string;
	label: string;
}

export interface ActionParamSchema {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'select';
	required: boolean;
	description: string;
	default?: unknown;
	options?: SelectOption[];
	optionsFrom?: string;
}

/** Example invocation for self-documenting actions. */
export interface ActionExample {
	description: string;
	params: ActionParams;
	response?: ActionResult;
}

export interface Action {
	name: string;
	description: string;
	params: ActionParamSchema[];
	/** Grouping category (e.g. 'lifecycle', 'tooling', 'monitoring'). */
	category?: string;
	/** Example invocations for documentation. */
	examples?: ActionExample[];
	execute: (sepSys: SEPSysInterface, params: ActionParams) => Promise<ActionResult>;
	resolveOptions?: (
		paramName: string,
		sepSys: SEPSysInterface,
	) => Promise<SelectOption[]>;
}

// --- SEPSys interface (for dependency injection into actions) ---

export interface SEPSysInterface {
	createSession(config: AgentConfig): Promise<void>;
	killSession(id: string): void;
	restartSession(id: string): Promise<void>;
	removeSession(id: string): Promise<void>;
	getSession(id: string): ManagedSession | undefined;
	getAllSessions(): Map<string, ManagedSession>;
	getSessionInfoList(): SessionInfo[];
	setDataHandler(callback: DataCallback): void;
	onEvent(handler: SessionEventHandler): void;
	adoptOrphanedContainers(): Promise<void>;
	shutdown(): Promise<void>;
	discoverGitRepos(workspaceDir: string): string[];
	createGitBranch(repoDir: string, branchName: string): { success: boolean; error?: string };
	buildImage(profile?: string): Promise<{ success: boolean; tag: string; error?: string }>;
	listImages(): Promise<Array<{ tag: string; size: string; created: string }>>;
	removeImage(profile?: string): Promise<{ success: boolean; error?: string }>;
}

// --- Event-driven communication ---

export type SessionEventType =
	| 'session-created'
	| 'session-exited'
	| 'session-removed'
	| 'state-changed'
	| 'session-list-changed';

export interface SessionEvent {
	type: SessionEventType;
	sessionId: string;
	data?: unknown;
}

export type SessionEventHandler = (event: SessionEvent) => void;

// --- Data callback for PTY output routing ---

export type DataCallback = (sessionId: string, data: string) => void;

// --- Logger ---

export interface Logger {
	log(msg: string): void;
	error(msg: string): void;
}
