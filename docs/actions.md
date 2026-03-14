# Action Reference

> Auto-generated from action metadata. Do not edit.

## lifecycle

### `archive-agent`

Teardown container and remove session, workspace stays on disk

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `all` | `boolean` | no | `false` | Archive all active sessions |
| `id` | `select` | no | — | Session to archive |

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
| `profile` | `string` | no | — | Container profile name (from manage-profiles) for environment customization |
| `branch` | `boolean` | no | `false` | Create and checkout a git branch before starting |
| `branchName` | `string` | no | — | Branch name (defaults to agent/<name>) |
| `repoPath` | `string` | no | — | Git repo path (required when workspace has multiple repos) |

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

### `create-interactive-agent`

Create an agent in interactive mode (no prompt)

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `name` | `string` | yes | — | Display name for the agent |
| `dir` | `string` | yes | — | Workspace directory (created if needed) |

**API:** `POST /actions/create-interactive-agent`

### `kill-agent`

Kill a running agent process

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `all` | `boolean` | no | `false` | Kill all running agents |
| `id` | `select` | no | — | Session to kill |

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
| `id` | `select` | yes | — | Session to restart |

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

### `manage-cache`

Build, list, and remove cached container images for faster startup

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `command` | `select` | yes | — | Operation to perform |
| `profile` | `string` | no | — | Profile name to build/remove (omit for default image) |

**Example:** *Build the default cached image*

```json
{
  "command": "build"
}
```

**Example:** *Build a cached image for a Python profile*

```json
{
  "command": "build",
  "profile": "python"
}
```

**Example:** *List all cached images*

```json
{
  "command": "list"
}
```

**API:** `POST /actions/manage-cache`

### `manage-profiles`

Manage container profiles (list, get, create, delete)

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `command` | `select` | yes | — | Operation to perform |
| `name` | `string` | no | — | Profile name (required for get/create/delete) |
| `description` | `string` | no | — | Profile description (for create) |
| `image` | `string` | no | — | Docker image override (for create) |
| `postCreateCommand` | `string` | no | — | Command to run after claude-code install (for create) |
| `runArgs` | `string` | no | — | JSON array of Docker run args (for create) |
| `features` | `string` | no | — | JSON object of devcontainer features (for create) |
| `mounts` | `string` | no | — | JSON array of mount objects (for create) |
| `remoteEnv` | `string` | no | — | JSON object of remote environment variables (for create) |

**Example:** *List all profiles*

```json
{
  "command": "list"
}
```

**Example:** *Create a Python profile*

```json
{
  "command": "create",
  "name": "python",
  "description": "Python development environment",
  "image": "mcr.microsoft.com/devcontainers/python:3.12",
  "postCreateCommand": "pip install pytest"
}
```

**API:** `POST /actions/manage-profiles`

### `open-vscode`

Launch VS Code attached to an agent devcontainer

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `id` | `select` | yes | — | Session to open in VS Code |

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
