# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SEP-Field — a system for deploying multiple Claude Code instances into containerized (devcontainer) workspaces with connect/disconnect to live terminal sessions and real-time agent state tracking. Target host OS is macOS.

`src/` is the production codebase. `daemon-orchestrator-demo/` is the original tech demo (Phase 4) and should not be modified — it exists as a reference only.

## Tech Stack

- **Runtime:** Bun (TypeScript, ES2022 modules, JSX via react-jsx)
- **TUI framework:** React 19 + Ink 6 (terminal React renderer)
- **State management:** Zustand 5 (vanilla store, not React-bound)
- **Terminal emulation:** `@xterm/headless` for headless terminal state capture
- **PTY management:** `Bun.Terminal` API
- **Containers:** devcontainer CLI (`devcontainer up` / `devcontainer exec`)
- **Docker runtime:** Colima (required on macOS)
- **IPC:** Unix domain socket at `/tmp/sep-field.sock` (binary frame protocol) + HTTP API on port 7080

## Commands

```bash
bun install                    # Install dependencies

bun run dev                    # Run daemon in foreground (logs to stdout)
bun run start                  # Start daemon detached (launches Colima if needed)
bun run client                 # Connect TUI client to running daemon
bun run status                 # Check daemon status
bun run stop                   # Stop daemon (SIGTERM → graceful teardown)

bun run typecheck              # Type check (bunx tsc --noEmit)
bun run docs                   # Regenerate action docs from metadata

bun run service:install        # Install as macOS launchd login service
bun run service:uninstall      # Uninstall launchd service

tail -f ~/Library/Logs/sep-field/daemon.log  # View launchd service logs
```

## Architecture

### Daemon + Client Split

The system is a daemon (`src/main.ts`) communicating with TUI clients (`src/tui/client.tsx`) over two transports:

- **Stream transport** (Unix socket): Binary frame protocol for PTY data streaming, session attachment/detachment, and history replay. Multi-client — any number of TUI clients can connect, but each session can only be locked (attached) by one client at a time. Session list broadcasts go to all connected clients.
- **API transport** (HTTP): REST endpoints for action execution (`POST /actions/:name`), session listing (`GET /sessions`), and action discovery (`GET /actions`). This is how the TUI executes management actions.

### Core Managers (`src/core/`)

Four managers compose in `main.ts` — **AuthManager**, **ContainerManager**, **PtyManager**, **SEPSys**:

- **SEPSys** (`src/core/sep-sys.ts`) is the orchestration hub. It owns the sessions map, coordinates the other three managers, and emits events (`session-created`, `session-exited`, `state-changed`, `session-list-changed`) that transport layers subscribe to.
- Session creation is two-phase: immediate placeholder (so UI updates instantly), then async background init (container up → PTY spawn → state polling). Guards exist against race conditions if a session is removed during init. If an existing container is found for the workspace, SEPSys adopts it with `--continue` rather than starting fresh (handles daemon restarts gracefully).
- **ContainerManager** converts symlinks in agent sandbox directories to devcontainer bind mounts before calling `devcontainer up`. Symlinks are resolved to their host targets, entries added to the devcontainer config, and the symlink itself removed so containers don't see broken links.
- **StateDetector** reads xterm headless buffer content every 100ms with 200ms debounce to classify agent state: `busy`, `waiting`, `idle`, `complete`.

### Action System (`src/actions/`)

Actions are self-describing modules that export an `action: Action` object. See `docs/writing-actions.md` for the full authoring guide.

- **Loading:** `action-loader.ts` scans directories, dynamically imports `.ts` files, validates shape at runtime. Files named `index.ts`, `*-loader.ts`, `*-watcher.ts` are skipped.
- **Two directories:** Built-in (`src/actions/`) and user (`~/.config/sep-field/actions/`). User actions override built-in on name conflict.
- **Hot-reload:** `action-watcher.ts` watches user directory with 300ms debounce, cache-busts imports, regenerates docs on change. No daemon restart needed.
- **API exposure:** Every loaded action is automatically a `POST /actions/<name>` endpoint.
- Actions receive a `SEPSysInterface` (not the concrete class) for loose coupling.

### TUI (`src/tui/`)

React + Ink terminal application with three modes:

1. **Switcher** — Session picker list with state indicators. Arrow keys / j/k to navigate, Enter to attach, `?` to open management.
2. **Management** — Two-panel console (NavTree + DetailPanel) for executing actions. Tab switches focus, Enter executes (after confirmation checklist). Wrapped in CRT visual effects.
3. **Attached** — Raw PTY passthrough. Ink is *unmounted* entirely; stdin/stdout are wired directly to the daemon socket. Ctrl+q detaches back to switcher (re-mounts Ink). A one-row status ticker showing all agent states persists at the bottom; Ctrl+h/Ctrl+l scrolls it horizontally. Ctrl+n puts the ticker into number select mode.

**State pattern:** Zustand vanilla store (`tui/store.ts`) is created outside React so it persists across Ink mount/unmount cycles. The connection singleton (`tui/connection.ts`) also lives outside React and updates the store directly when frames arrive.

### Binary Frame Protocol (`src/transport/protocol.ts`)

Format: `[1 byte type][4 bytes payload length BE][N bytes payload]`

| Direction | Types |
|-----------|-------|
| Server→Client | `HISTORY` (0x01), `HISTORY_END` (0x02), `LIVE_DATA` (0x03), `PTY_EXIT` (0x04), `SESSION_LIST` (0x05) |
| Client→Server | `STDIN` (0x81), `RESIZE` (0x82), `DETACH` (0x83), `ATTACH` (0x84) |

`FrameParser` handles partial reads and coalesced writes.

### Service Layer (`src/service/`)

macOS launchd integration. `install.ts` runs three phases (splash art, prerequisite check, resource config, plist generation + bootstrap). `preflight.ts` provides shared prerequisite checking and system spec detection. `wrapper.sh` verifies prerequisites and exits 0 on failure (prevents launchd crash loops). `liveness.ts` and `paths.ts` provide status checking and path constants.

## Key Design Decisions

- Agent sandboxes: `test-space/agent{N}-sandbox/` — each gets `.devcontainer/`, `.git/`, and a copy of `~/.claude/`
- Containers bind-mount host `~/.claude/` for credential sharing; orchestrator refreshes OAuth tokens in-place from macOS Keychain
- Onboarding bypass patched into host's `~/.claude/.claude.json` so containers skip first-run setup
- Output buffering respects DEC synchronized output (mode 2026) for flicker-free rendering
- ONLCR flag explicitly cleared on PTY to prevent double carriage returns
- PTY history uses a 10MB ring buffer, streamed to clients in 4KB chunks
- `types/index.ts` has zero internal imports — it's the shared type foundation with no circular dependency risk

## Conventions

- Kebab-case filenames throughout (`create-agent.ts`, `action-loader.ts`)
- `.ts` extension in all import paths (`from '../types/index.ts'`)
- Actions are standalone modules with no side effects on import
- Event-driven communication between layers (SEPSys emits → transports subscribe)
- Dependency injection via interfaces for testability (`SEPSysInterface`, `Logger`)
