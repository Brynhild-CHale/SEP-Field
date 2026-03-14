# SEP-Field

> "An SEP is something we can't see, or don't see, or our brain doesn't
> let us see, because we think that it's somebody else's problem."
> -- Douglas Adams, *Life, the Universe and Everything*

A system for deploying multiple Claude Code instances into containerized
workspaces with connect/disconnect to live terminal sessions and real-time
agent state tracking.

But this is just the default implementation...

Actions allow for arbitrary extension of the system — any operation that can be
expressed as an async function receiving the orchestrator interface becomes a
first-class API endpoint and TUI command.

API driven so you can automate deployment and monitoring. This lets you SEP
the SEP-Field by making it easy to drive by other agents.

Because actions are hot-loading, workflows can be developed and deployed on the fly.

## Prerequisites

macOS with:

| Tool | Install | Required |
|------|---------|----------|
| [Bun](https://bun.sh) | `curl -fsSL https://bun.sh/install \| bash` | Yes |
| [Colima](https://github.com/abiosoft/colima) | `brew install colima` | Yes |
| [Docker CLI](https://docs.docker.com/engine/install/) | `brew install docker` | Yes |
| [devcontainer CLI](https://github.com/devcontainers/cli) | `npm install -g @devcontainers/cli` | Yes |

## Install

One-liner (installs Bun if needed, clones to `~/.sep-field`):

```bash
curl -fsSL https://raw.githubusercontent.com/Brynhild-CHale/SEP-Field/main/install.sh | bash
```

Or set a custom install directory:

```bash
SEP_FIELD_DIR=~/my/path curl -fsSL https://raw.githubusercontent.com/Brynhild-CHale/SEP-Field/main/install.sh | bash
```

### Manual install

```bash
git clone https://github.com/Brynhild-CHale/SEP-Field.git ~/.sep-field
cd ~/.sep-field
bun install
bun run service:install
```

The installer will:

1. Check prerequisites (colima, docker, devcontainer)
2. Prompt for VM resource allocation (CPUs, RAM)
3. Install and bootstrap the launchd service

## Quick Start

After `bun run service:install`, the `sep` command is available system-wide:

```bash
sep              # Connect TUI client
sep start        # Start daemon
sep stop         # Stop daemon
sep status       # Check daemon status
sep log          # Tail daemon log
sep -h           # Show all commands 
```

Or use `bun run` scripts directly:

```bash
bun run start    # Start daemon
bun run client   # Connect TUI client
bun run status   # Check daemon status
bun run stop     # Stop daemon
```

## launchd Service (macOS)

Once installed via `bun run service:install`, `bun run start/stop/status` automatically route through launchctl. The daemon:

- **Starts at login** (`RunAtLoad`)
- **Restarts on crash** (`KeepAlive.SuccessfulExit: false`)
- **Does NOT restart** after graceful `bun run stop`
- **Exits cleanly** if prerequisites are missing (no crash loop)

Logs go to `~/Library/Logs/sep-field/daemon.log`.

```bash
# Uninstall
bun run service:uninstall
```

## Custom Actions

Actions are loaded from two directories, merged at startup:

1. **Built-in** — `src/actions/` (ships with the package)
2. **User** — `~/.config/sep-field/actions/` (auto-created on first run)

On a name conflict, **user wins** — the user action replaces the built-in. Drop any `.ts` file exporting an `action` object into the user directory and the daemon picks it up via hot-reload (no restart needed). Deleting a user override automatically restores the original built-in action.

See [Writing Actions](docs/writing-actions.md) for the file format.

<!-- ACTIONS-START -->
## Actions

| Action | Category | Description |
|--------|----------|-------------|
| [`archive-agent`](docs/actions.md#archive-agent) | lifecycle | Teardown container and remove session, workspace stays on disk |
| [`create-agent`](docs/actions.md#create-agent) | lifecycle | Create a new agent container and session |
| [`create-interactive-agent`](docs/actions.md#create-interactive-agent) | lifecycle | Create an agent in interactive mode (no prompt) |
| [`kill-agent`](docs/actions.md#kill-agent) | lifecycle | Kill a running agent process |
| [`list-agents`](docs/actions.md#list-agents) | monitoring | List all current agent sessions |
| [`manage-cache`](docs/actions.md#manage-cache) | tooling | Build, list, and remove cached container images for faster startup |
| [`manage-profiles`](docs/actions.md#manage-profiles) | tooling | Manage container profiles (list, get, create, delete) |
| [`open-vscode`](docs/actions.md#open-vscode) | tooling | Launch VS Code attached to an agent devcontainer |
| [`restart-agent`](docs/actions.md#restart-agent) | lifecycle | Restart an exited or running session |

See [Action Reference](docs/actions.md) for full details and [Writing Actions](docs/writing-actions.md) for the authoring guide.
<!-- ACTIONS-END -->

## API

The daemon exposes an HTTP API (default port `7080`) for programmatic control. This is the primary interface for driving SEP-Field from other agents, scripts, or CI pipelines.

### Discovery

`GET /` returns a full API schema — every endpoint, every registered action with its parameters, examples, and type definitions. This is designed for agentic consumption: point an LLM at this endpoint and it has everything it needs to operate the system.

```bash
curl http://localhost:7080/
```

Response includes:
- `endpoints` — all available routes with methods and descriptions
- `actions` — every registered action with name, description, category, params (name/type/required/default/description), and example invocations with expected responses
- `types` — `SessionInfo` and `ActionResult` schemas

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | API schema and action discovery (start here) |
| `GET` | `/actions` | List all available actions with metadata |
| `GET` | `/sessions` | List current agent sessions with state |
| `GET` | `/actions/:name/options/:param` | Resolve dynamic select options for a parameter |
| `POST` | `/actions/:name` | Execute an action (JSON body with params) |

### Quick examples

```bash
# Discover everything the API can do
curl http://localhost:7080/

# List running agents
curl http://localhost:7080/sessions

# Create an agent
curl -X POST http://localhost:7080/actions/create-agent \
  -H 'Content-Type: application/json' \
  -d '{"name": "my-agent", "cwd": "./workspace", "prompt": "Fix the login bug"}'

# List agents (via action)
curl -X POST http://localhost:7080/actions/list-agents

# Kill an agent
curl -X POST http://localhost:7080/actions/kill-agent \
  -H 'Content-Type: application/json' \
  -d '{"id": "agent-a1b2c3d4"}'

# Archive (teardown container, keep workspace)
curl -X POST http://localhost:7080/actions/archive-agent \
  -H 'Content-Type: application/json' \
  -d '{"id": "agent-a1b2c3d4"}'
```

### Response format

All action responses follow the `ActionResult` shape:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "reason" }
```

HTTP status: `200` on success, `400` on action failure, `404` on unknown action, `500` on exception.

### Agentic usage

The `GET /` discovery endpoint is purpose-built for LLM tool use. A typical integration pattern:

1. Fetch `GET /` to get the full schema
2. Present the actions list as available tools
3. Map action params to tool parameters
4. Execute via `POST /actions/:name` with JSON body

Custom actions dropped into `~/.config/sep-field/actions/` are automatically hot-loaded and appear in discovery — no daemon restart needed. This means you can extend the API surface while the system is running.

### Port configuration

The API port defaults to `7080`. To change it:

**During install** — the installer prompts for a custom port.

**After install** — edit `~/.config/sep-field/config.json`:

```json
{
  "apiPort": 8080,
  "vm": { ... }
}
```

Then restart the daemon (`sep stop && sep start`).

**Ad-hoc** — set the `API_PORT` environment variable:

```bash
API_PORT=8080 bun run dev
```

## Architecture

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Development

```bash
# Run daemon in foreground (no detach, logs to stdout)
bun run dev

# Type check
bun run typecheck

# Regenerate docs from action metadata
bun run docs
```
