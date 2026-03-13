/**
 * Documentation Generator — builds docs from action metadata
 *
 * Dual-purpose: importable function + standalone script (import.meta.main).
 * Generates docs/actions.md (full reference) and updates README.md
 * (compact summary between marker comments).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadActionsFromDirectory } from '../actions/action-loader.ts';
import type { Action, ActionParamSchema, ActionExample, Logger } from '../types/index.ts';

// --- Public API ---

export interface GenerateDocsOptions {
	actionsDir: string;
	projectRoot: string;
	logger?: Logger;
	preloadedActions?: Action[];
	builtinNames?: Set<string>;
	userActionNames?: Set<string>;
}

export interface GenerateDocsResult {
	actionsDocPath: string;
	readmePath: string;
	actionCount: number;
}

const ACTIONS_START = '<!-- ACTIONS-START -->';
const ACTIONS_END = '<!-- ACTIONS-END -->';

const silentLogger: Logger = {
	log() {},
	error() {},
};

export async function generateDocs(options: GenerateDocsOptions): Promise<GenerateDocsResult> {
	const { actionsDir, projectRoot, logger = silentLogger, builtinNames, userActionNames } = options;

	// Load actions
	let actions: Action[];
	if (options.preloadedActions) {
		actions = options.preloadedActions;
	} else {
		const result = await loadActionsFromDirectory(actionsDir, logger);
		for (const err of result.errors) {
			logger.error(`Doc gen: ${err}`);
		}
		actions = result.actions;
	}

	// Sort alphabetically by name
	actions.sort((a, b) => a.name.localeCompare(b.name));

	// Group by category
	const grouped = new Map<string, Action[]>();
	for (const action of actions) {
		const cat = action.category || 'uncategorized';
		if (!grouped.has(cat)) grouped.set(cat, []);
		grouped.get(cat)!.push(action);
	}

	// Sort categories alphabetically
	const sortedCategories = Array.from(grouped.keys()).sort();

	// Ensure docs/ directory exists
	const docsDir = resolve(projectRoot, 'docs');
	mkdirSync(docsDir, { recursive: true });

	// Generate docs/actions.md
	const actionsDocPath = resolve(docsDir, 'actions.md');
	const actionsContent = renderActionsDoc(sortedCategories, grouped, builtinNames, userActionNames);
	writeFileSync(actionsDocPath, actionsContent);
	logger.log(`Generated ${actionsDocPath}`);

	// Generate/update README.md
	const readmePath = resolve(projectRoot, 'README.md');
	const actionsSection = renderReadmeSection(actions, builtinNames, userActionNames);
	updateReadme(readmePath, actionsSection);
	logger.log(`Updated ${readmePath}`);

	return { actionsDocPath, readmePath, actionCount: actions.length };
}

// --- Renderers ---

function actionSourceLabel(name: string, builtinNames?: Set<string>, userActionNames?: Set<string>): string {
	if (!userActionNames || !builtinNames) return '';
	const isUser = userActionNames.has(name);
	const isBuiltin = builtinNames.has(name);
	if (isUser && isBuiltin) return ' *(user override)*';
	if (isUser) return ' *(user)*';
	return '';
}

function renderActionsDoc(categories: string[], grouped: Map<string, Action[]>, builtinNames?: Set<string>, userActionNames?: Set<string>): string {
	const lines: string[] = [
		'# Action Reference',
		'',
		'> Auto-generated from action metadata. Do not edit.',
		'',
	];

	for (const cat of categories) {
		const actions = grouped.get(cat)!;
		lines.push(`## ${cat}`, '');

		for (const action of actions) {
			const label = actionSourceLabel(action.name, builtinNames, userActionNames);
			lines.push(`### \`${action.name}\`${label}`, '');
			lines.push(action.description, '');

			// Params table
			if (action.params.length > 0) {
				lines.push('| Name | Type | Required | Default | Description |');
				lines.push('|------|------|----------|---------|-------------|');
				for (const p of action.params) {
					const def = p.default !== undefined ? `\`${JSON.stringify(p.default)}\`` : '—';
					lines.push(`| \`${p.name}\` | \`${p.type}\` | ${p.required ? 'yes' : 'no'} | ${def} | ${p.description} |`);
				}
				lines.push('');
			} else {
				lines.push('No parameters.', '');
			}

			// Examples
			if (action.examples && action.examples.length > 0) {
				for (const ex of action.examples) {
					lines.push(`**Example:** *${ex.description}*`);
					lines.push('');
					lines.push('```json');
					lines.push(JSON.stringify(ex.params, null, 2));
					lines.push('```');
					if (ex.response) {
						lines.push('');
						lines.push('Response:');
						lines.push('');
						lines.push('```json');
						lines.push(JSON.stringify(ex.response, null, 2));
						lines.push('```');
					}
					lines.push('');
				}
			}

			lines.push(`**API:** \`POST /actions/${action.name}\``, '');
		}
	}

	return lines.join('\n');
}

function renderReadmeSection(actions: Action[], builtinNames?: Set<string>, userActionNames?: Set<string>): string {
	const lines: string[] = [
		'',
		'## Actions',
		'',
		'| Action | Category | Description |',
		'|--------|----------|-------------|',
	];

	for (const action of actions) {
		const anchor = action.name;
		const cat = action.category || 'uncategorized';
		const label = actionSourceLabel(action.name, builtinNames, userActionNames);
		lines.push(`| [\`${action.name}\`](docs/actions.md#${anchor})${label} | ${cat} | ${action.description} |`);
	}

	lines.push('');
	lines.push('See [Action Reference](docs/actions.md) for full details and [Writing Actions](docs/writing-actions.md) for the authoring guide.');
	lines.push('');

	return lines.join('\n');
}

function updateReadme(readmePath: string, actionsSection: string): void {
	if (!existsSync(readmePath)) {
		// Create from template
		const content = renderReadmeTemplate(actionsSection);
		writeFileSync(readmePath, content);
		return;
	}

	// Update between markers
	const existing = readFileSync(readmePath, 'utf-8');
	const startIdx = existing.indexOf(ACTIONS_START);
	const endIdx = existing.indexOf(ACTIONS_END);

	if (startIdx !== -1 && endIdx !== -1) {
		const before = existing.slice(0, startIdx + ACTIONS_START.length);
		const after = existing.slice(endIdx);
		writeFileSync(readmePath, before + actionsSection + after);
	} else {
		// Markers missing — append them
		const appendix = '\n' + ACTIONS_START + actionsSection + ACTIONS_END + '\n';
		writeFileSync(readmePath, existing + appendix);
	}
}

function renderReadmeTemplate(actionsSection: string): string {
	return `# SEP-Field

A system for deploying multiple Claude Code instances into containerized (devcontainer) workspaces with connect/disconnect to live terminal sessions and real-time agent state tracking.

## Quick Start

\`\`\`bash
# Install dependencies
bun install

# Start daemon
bun run start

# Connect TUI client
bun run client

# Check status
bun run status

# Stop daemon
bun run stop
\`\`\`

## Architecture

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

${ACTIONS_START}${actionsSection}${ACTIONS_END}

## Development

\`\`\`bash
# Type check
bun run typecheck

# Regenerate docs from action metadata
bun run docs
\`\`\`
`;
}

// --- Standalone entry point ---

if (import.meta.main) {
	const projectRoot = resolve(import.meta.dir, '../..');
	const actionsDir = resolve(import.meta.dir, '../actions');

	const logger: Logger = {
		log(msg: string) { console.log(msg); },
		error(msg: string) { console.error(`ERROR: ${msg}`); },
	};

	const result = await generateDocs({ actionsDir, projectRoot, logger });
	console.log(`Done — ${result.actionCount} actions documented`);
}
