# A Note About Symlinks in Devcontainer Sandboxes

## The Problem

Symlinks placed in a sandbox directory (e.g. `agent3-sandbox/task.md -> ~/projects/foo/task.md`) don't work inside the container. The container only mounts the sandbox directory as its workspace — the symlink target path doesn't exist in the container's filesystem. Claude Code sees a broken symlink and can't read or edit the file.

## The Solution

Replace symlinks with Docker bind mounts. Before `devcontainer up`, scan the sandbox for symlinks, resolve their host targets, and generate corresponding bind mount entries in `devcontainer.json`. The symlink itself becomes the declarative config — if you want a file available in the sandbox, symlink it in.

### How It Would Work

1. Before generating `devcontainer.json`, walk the sandbox directory looking for symlinks
2. For each symlink, resolve the real host path (`fs.realpathSync` or `readlinkSync`)
3. Convert each into a devcontainer mount entry:
   ```json
   {
     "source": "~/projects/foo/task.md",
     "target": "/workspaces/agent3-sandbox/task.md",
     "type": "bind"
   }
   ```
4. Remove the symlink from the sandbox (so it doesn't confuse the container)
5. The file appears as a regular file inside the container, edits flow back to the host
6. The agent never gets access to the parent directory of the target — only the specific file

### Why This Is Good

- **Symlinks as config**: No separate config file needed. Drop a symlink in the sandbox, it gets mounted.
- **Fine-grained access**: Each file is mounted individually. The agent can edit `task.md` but can't see or access anything else in the directory where `task.md` lives.
- **Bidirectional**: Changes made inside the container are immediately visible on the host and vice versa.
- **No copying**: Unlike `cpSync`, there's no data duplication. The container works with the real file.
