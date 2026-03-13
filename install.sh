#!/usr/bin/env bash
# SEP-Field installer — curl one-liner entry point.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Brynhild-CHale/SEP-Field/main/install.sh | bash
#
# What it does:
#   1. Checks for Bun (installs if missing)
#   2. Clones the repo to ~/.sep-field (or SEP_FIELD_DIR)
#   3. Runs bun install
#   4. Runs the interactive service installer
#
set -euo pipefail

REPO="https://github.com/Brynhild-CHale/SEP-Field.git"
INSTALL_DIR="${SEP_FIELD_DIR:-$HOME/.sep-field}"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
error() { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; }

# --- Platform check ---
if [[ "$(uname)" != "Darwin" ]]; then
	error "SEP-Field requires macOS."
	exit 1
fi

# --- Git ---
if ! command -v git &>/dev/null; then
	error "git is not installed. Install Xcode Command Line Tools: xcode-select --install"
	exit 1
fi

# --- Bun ---
if ! command -v bun &>/dev/null; then
	info "Bun not found — installing..."
	curl -fsSL https://bun.sh/install | bash
	# Source the updated PATH so bun is available in this session
	export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
	export PATH="$BUN_INSTALL/bin:$PATH"
	if ! command -v bun &>/dev/null; then
		error "Bun installation succeeded but 'bun' not found in PATH."
		error "Restart your terminal and re-run this script."
		exit 1
	fi
fi

# --- Clone or update ---
if [[ -d "$INSTALL_DIR/.git" ]]; then
	info "Existing installation found at $INSTALL_DIR — pulling latest..."
	git -C "$INSTALL_DIR" pull --ff-only
else
	if [[ -d "$INSTALL_DIR" ]]; then
		error "$INSTALL_DIR already exists but is not a git repo. Remove it or set SEP_FIELD_DIR."
		exit 1
	fi
	info "Cloning SEP-Field to $INSTALL_DIR..."
	git clone "$REPO" "$INSTALL_DIR"
fi

# --- Install deps ---
info "Installing dependencies..."
cd "$INSTALL_DIR"
bun install

# --- Run service installer ---
info "Running SEP-Field installer..."
bun run service:install
