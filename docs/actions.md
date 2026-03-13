# Action Reference

> Auto-generated from action metadata. Do not edit.

## lifecycle

### `archive-agent`

Teardown container and remove session, workspace stays on disk

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `id` | `string` | yes | — | Session ID to archive |

**Example:** *Archive an agent, keeping its workspace*

```json
{
  "id": "agent-a1b2c3d4"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "agent-a1b2c3d4",
    "archivedWorkspace": "/abs/test-space/agent1-sandbox"
  }
}
```

**API:** `POST /actions/archive-agent`

### `create-agent`

Create a new agent container and session

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `name` | `string` | yes | — | Display name for the agent |
| `cwd` | `string` | yes | — | Workspace directory (will be created if needed) |
| `prompt` | `string` | yes | — | Initial prompt for Claude |
| `devcontainerOverrides` | `string` | no | — | JSON object of devcontainer.json fields to merge with generated config. Protected fields (claude mount, CLAUDE_CONFIG_DIR, claude-code extension, postCreateCommand prefix) are always enforced. Ignored if workspace already has a devcontainer.json. |

**Example:** *Create a new agent to work on a feature branch*

```json
{
  "name": "feature-auth",
  "cwd": "./test-space/agent1-sandbox",
  "prompt": "Implement JWT authentication"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "agent-a1b2c3d4",
    "name": "feature-auth",
    "cwd": "/abs/test-space/agent1-sandbox",
    "status": "starting"
  }
}
```

**API:** `POST /actions/create-agent`

### `kill-agent`

Kill a running agent process

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `id` | `string` | yes | — | Session ID to kill |

**Example:** *Kill a running agent by session ID*

```json
{
  "id": "agent-a1b2c3d4"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "agent-a1b2c3d4"
  }
}
```

**API:** `POST /actions/kill-agent`

### `restart-agent`

Restart an exited or running session

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `id` | `string` | yes | — | Session ID to restart |

**Example:** *Restart an exited agent*

```json
{
  "id": "agent-a1b2c3d4"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "agent-a1b2c3d4"
  }
}
```

**API:** `POST /actions/restart-agent`

## monitoring

### `list-agents`

List all current agent sessions

No parameters.

**Example:** *List all agents*

```json
{}
```

Response:

```json
{
  "success": true,
  "data": []
}
```

**API:** `POST /actions/list-agents`

## tooling

### `open-vscode`

Launch VS Code attached to an agent devcontainer

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `id` | `string` | yes | — | Session ID whose container to open |

**Example:** *Open VS Code for a running agent*

```json
{
  "id": "agent-a1b2c3d4"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "agent-a1b2c3d4",
    "cwd": "/abs/test-space/agent1-sandbox"
  }
}
```

**API:** `POST /actions/open-vscode`
