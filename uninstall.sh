#!/usr/bin/env bash
set -e

BIN_PATH="$HOME/.local/bin/csm"
STATE_DIR="$HOME/.claude-sessions-manager"

echo "→ Removing launcher..."
rm -f "$BIN_PATH"

echo ""
echo "✓ Claude Sessions Manager TUI uninstalled."
echo ""
echo "  Saved sessions were kept in $STATE_DIR"
echo "  Delete that folder to remove saved state:  rm -rf \"$STATE_DIR\""
echo ""
echo "  You may also remove the PATH entry from your shell rc file"
echo "  (~/.bashrc or ~/.zshrc) if it was added during installation."
echo ""
