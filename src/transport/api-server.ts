/**
 * ApiServer — HTTP/REST API for control operations
 *
 * Uses Bun.serve() to expose actions via HTTP.
 * Routes:
 *   GET  /              — API schema discovery
 *   GET  /actions       — list available actions
 *   GET  /sessions      — current session list
 *   POST /actions/:name — execute action with JSON body params
 */

import type { SEPSysInterface, Action, Logger } from '../types/index.ts';
import { API_DEFAULT_PORT } from './protocol.ts';

export class ApiServer {
	private sepSys: SEPSysInterface;
	private actions: Map<string, Action>;
	private logger: Logger;
	private port: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private server: any = null;

	constructor(
		sepSys: SEPSysInterface,
		actions: Map<string, Action>,
		logger: Logger,
		port: number = API_DEFAULT_PORT,
	) {
		this.sepSys = sepSys;
		this.actions = actions;
		this.logger = logger;
		this.port = port;
	}

	/** Start the HTTP server. */
	start(): void {
		this.server = Bun.serve({
			port: this.port,
			fetch: (req) => this.handleRequest(req),
		});
		this.logger.log(`API server listening on http://localhost:${this.port}`);
	}

	/** Stop the HTTP server. */
	stop(): void {
		if (this.server) {
			this.server.stop();
			this.server = null;
		}
	}

	private buildSchema(): object {
		const actionList = Array.from(this.actions.values()).map((a) => ({
			name: a.name,
			description: a.description,
			category: a.category ?? null,
			params: a.params,
			examples: a.examples ?? [],
		}));

		return {
			name: 'SEP-Field',
			version: '0.1.0',
			endpoints: [
				{ method: 'GET', path: '/', description: 'API schema and discovery' },
				{ method: 'GET', path: '/actions', description: 'List available actions with metadata' },
				{ method: 'GET', path: '/sessions', description: 'List current agent sessions' },
				{ method: 'POST', path: '/actions/:name', description: 'Execute an action by name with JSON body params' },
			],
			actions: actionList,
			types: {
				SessionInfo: {
					id: 'string',
					name: 'string',
					status: "'starting' | 'running' | 'exited'",
					exitCode: 'number (optional)',
					agentState: "'busy' | 'waiting' | 'idle' | 'complete'",
				},
				ActionResult: {
					success: 'boolean',
					data: 'unknown (optional)',
					error: 'string (optional)',
				},
			},
		};
	}

	private async handleRequest(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const path = url.pathname;

		// GET / — API schema discovery
		if (req.method === 'GET' && path === '/') {
			return Response.json(this.buildSchema());
		}

		// GET /actions — list available actions
		if (req.method === 'GET' && path === '/actions') {
			const list = Array.from(this.actions.values()).map((a) => ({
				name: a.name,
				description: a.description,
				category: a.category ?? null,
				params: a.params,
				examples: a.examples ?? [],
			}));
			return Response.json(list);
		}

		// GET /sessions — current session list
		if (req.method === 'GET' && path === '/sessions') {
			const sessions = this.sepSys.getSessionInfoList();
			return Response.json(sessions);
		}

		// GET /actions/:name/options/:param — resolve dynamic select options
		if (req.method === 'GET' && path.startsWith('/actions/')) {
			const optionsMatch = path.match(/^\/actions\/([^/]+)\/options\/([^/]+)$/);
			if (optionsMatch) {
				const [, actionName, paramName] = optionsMatch;
				const action = this.actions.get(actionName);
				if (!action || !action.resolveOptions) {
					return Response.json(
						{ success: false, error: `No options resolver for ${actionName}` },
						{ status: 404 },
					);
				}
				try {
					const options = await action.resolveOptions(paramName, this.sepSys);
					return Response.json(options);
				} catch (err) {
					return Response.json(
						{ success: false, error: `Failed to resolve options: ${err}` },
						{ status: 500 },
					);
				}
			}
		}

		// POST /actions/:name — execute action
		if (req.method === 'POST' && path.startsWith('/actions/')) {
			const actionName = path.slice('/actions/'.length);
			const action = this.actions.get(actionName);

			if (!action) {
				return Response.json(
					{ success: false, error: `Unknown action: ${actionName}` },
					{ status: 404 },
				);
			}

			let params = {};
			try {
				const body = await req.text();
				if (body.length > 0) {
					params = JSON.parse(body);
				}
			} catch {
				return Response.json(
					{ success: false, error: 'Invalid JSON body' },
					{ status: 400 },
				);
			}

			try {
				const result = await action.execute(this.sepSys, params);
				const status = result.success ? 200 : 400;
				return Response.json(result, { status });
			} catch (err) {
				this.logger.error(`Action ${actionName} threw: ${err}`);
				return Response.json(
					{ success: false, error: `Action failed: ${err}` },
					{ status: 500 },
				);
			}
		}

		return Response.json({ error: 'Not found' }, { status: 404 });
	}
}
