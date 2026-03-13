#!/bin/bash
# wrapper.sh — launchd invokes this script to start the SEP-Field daemon.
#
# Colima VMs are now managed on-demand by the daemon itself.
# This script verifies prerequisites, then exec's into bun.
# Exits 0 on missing prereqs to prevent launchd crash-loop restart.

set -euo pipefail

# Augment PATH (covers tools installed after service:install)
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.bun/bin:${PATH}"

if ! command -v colima &>/dev/null; then
    echo "$(date -Iseconds) ERROR: colima not found. Install: brew install colima"
    exit 0  # exit 0 prevents launchd restart loop
fi

if ! command -v docker &>/dev/null; then
    echo "$(date -Iseconds) ERROR: docker not found. Install: brew install docker"
    exit 0
fi

if ! command -v devcontainer &>/dev/null; then
    echo "$(date -Iseconds) WARNING: devcontainer CLI not found. Install: npm install -g @devcontainers/cli"
fi

exec "${BUN_PATH}" run "${SEP_FIELD_ROOT}/src/main.ts"
