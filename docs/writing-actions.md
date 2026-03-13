# Writing Actions

This guide covers how to create new actions for SEP-Field.

## File Structure

Actions live in `src/actions/` as individual TypeScript files. Each file must:

- Use **kebab-case** naming (e.g., `create-agent.ts`, `list-agents.ts`)
- Export a single `action` object conforming to the `Action` interface
- Be a standalone module — no side effects on import

Infrastructure files (`index.ts`, `action-loader.ts`, `action-watcher.ts`) are ignored by the loader.

## Minimal Example

```typescript
import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
  name: 'ping',
  description: 'Health check that returns pong',
  category: 'monitoring',
  params: [],
  examples: [
    {
      description: 'Simple health check',
      params: {},
      response: { success: true, data: { message: 'pong' } },
    },
  ],
  async execute(_sepSys: SEPSysInterface, _params: ActionParams): Promise<ActionResult> {
    return { success: true, data: { message: 'pong' } };
  },
};
```

## Full Annotated Example

```typescript
import type { Action, ActionParams, ActionResult, SEPSysInterface } from '../types/index.ts';

export const action: Action = {
  // Unique identifier — used in API routes and the action registry.
  // Must be a non-empty string. Convention: kebab-case matching the filename.
  name: 'send-message',

  // Human-readable summary shown in docs and API responses.
  description: 'Send a text message to a running agent session',

  // Grouping for documentation. Common values: 'lifecycle', 'monitoring', 'tooling'.
  // Defaults to 'uncategorized' in docs if omitted.
  category: 'lifecycle',

  // Parameter schema — drives validation and documentation.
  params: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: 'Session ID of the target agent',
    },
    {
      name: 'message',
      type: 'string',
      required: true,
      description: 'Text to send to the agent',
    },
    {
      name: 'addNewline',
      type: 'boolean',
      required: false,
      default: true,
      description: 'Whether to append a newline after the message',
    },
  ],

  // Example invocations — used to generate documentation.
  examples: [
    {
      description: 'Send a prompt to a running agent',
      params: { id: 'agent-a1b2c3d4', message: 'Fix the login bug', addNewline: true },
      response: { success: true, data: { id: 'agent-a1b2c3d4', sent: true } },
    },
  ],

  // The handler. Receives the session manager and validated params.
  async execute(sepSys: SEPSysInterface, params: ActionParams): Promise<ActionResult> {
    const id = params.id as string;
    const message = params.message as string;

    if (!id || !message) {
      return { success: false, error: 'Missing required params: id, message' };
    }

    const session = sepSys.getSession(id);
    if (!session) {
      return { success: false, error: `Session ${id} not found` };
    }

    // ... implementation ...

    return { success: true, data: { id, sent: true } };
  },
};
```

## Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Unique action identifier (kebab-case) |
| `description` | `string` | yes | Human-readable summary |
| `category` | `string` | no | Grouping for docs (e.g., `'lifecycle'`, `'monitoring'`, `'tooling'`) |
| `params` | `ActionParamSchema[]` | yes | Parameter definitions (can be empty array) |
| `examples` | `ActionExample[]` | no | Example invocations for documentation |
| `execute` | `function` | yes | Async handler `(sepSys, params) => Promise<ActionResult>` |
| `resolveOptions` | `function` | no | Async resolver for dynamic `select` options `(paramName, sepSys) => Promise<SelectOption[]>` |

### Parameter Schema Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Parameter name |
| `type` | `'string' \| 'number' \| 'boolean' \| 'select'` | yes | Expected value type |
| `required` | `boolean` | yes | Whether the parameter must be provided |
| `description` | `string` | yes | What the parameter does (shown below focused field in TUI) |
| `default` | `unknown` | no | Default value when not provided |
| `options` | `SelectOption[]` | no | Static options for `select` type params |
| `optionsFrom` | `string` | no | Key indicating dynamic options resolved via `resolveOptions` (e.g. `'sessions'`) |

### The `select` Parameter Type

The `select` type renders a cycling picker in the TUI (left/right arrows to cycle through options). Options can be provided statically via `options` or resolved dynamically at runtime via `optionsFrom` + `resolveOptions`.

**Dynamic options example** (session picker):

```typescript
export const action: Action = {
  name: 'my-action',
  description: 'Do something with a session',
  category: 'lifecycle',
  params: [
    { name: 'id', type: 'select', required: true,
      description: 'Target session', optionsFrom: 'sessions' },
  ],
  async resolveOptions(paramName, sepSys) {
    if (paramName !== 'id') return [];
    return sepSys.getSessionInfoList().map(s => ({
      value: s.id,
      label: `${s.name} (${s.agentState})`,
    }));
  },
  async execute(sepSys, params) {
    // params.id will be the selected option's value
    // ...
  },
};
```

Dynamic options are fetched via `GET /actions/<name>/options/<param>` and refreshed each time the action is selected in the TUI.

## API Exposure

Every loaded action is automatically available as an HTTP endpoint:

```
POST /actions/<action-name>
Content-Type: application/json

{ "param1": "value1", "param2": "value2" }
```

The API server validates that the action exists, passes the JSON body as `params` to `execute()`, and returns the `ActionResult` as JSON.

## Hot Reload

The `ActionWatcher` monitors `src/actions/` for file changes with a 300ms debounce. When a change is detected:

1. All `.ts` files in the directory are re-imported (cache-busted)
2. Each module's `action` export is validated
3. The shared action registry is updated in-place (adds, updates, and removes)
4. Documentation is automatically regenerated

You do not need to restart the daemon to pick up action changes during development.

## Validation Rules

The action loader checks the following at load time:

- `action` export must be a non-null object
- `name` must be a non-empty string
- `description` must be a string
- `params` must be an array
- `execute` must be a function
- Duplicate `name` values across files are rejected (first loaded wins)

If validation fails, the action is skipped and an error is logged. Other valid actions continue to load normally.
