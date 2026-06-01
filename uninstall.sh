#!/usr/bin/env bash
set -e

INSTALL_DIR="$HOME/.claude-sessions-manager"
BIN_PATH="$HOME/.local/bin/csm"

echo "→ Removing launcher..."
rm -f "$BIN_PATH"

echo "→ Removing application files..."
rm -rf "$INSTALL_DIR"

echo ""
echo "✓ Claude Sessions Manager TUI uninstalled."
echo ""
echo "  You may also remove the PATH entry from your shell rc file"
echo "  (~/.bashrc or ~/.zshrc) if it was added during installation."
echo ""
