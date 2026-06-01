#!/usr/bin/env bash
set -e

REPO="https://github.com/AbdelzaherAbdelgwad/claude-sessions-manager-tui"
INSTALL_DIR="$HOME/.claude-sessions-manager"
BIN_PATH="$HOME/.local/bin/csm"

# ── Check dependencies ────────────────────────────────────────────────────────

check_dep() {
  if ! command -v "$1" &>/dev/null; then
    echo "✗ '$1' not found. $2"
    exit 1
  fi
}

check_dep git  "Install git: https://git-scm.com"
check_dep bun  "Install Bun: curl -fsSL https://bun.sh/install | bash"
check_dep claude "Install Claude Code: https://claude.ai/code"

echo "✓ All dependencies found"

# ── Clone or update ───────────────────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Updating existing installation..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "→ Cloning repository..."
  git clone "$REPO" "$INSTALL_DIR"
fi

# ── Install dependencies ──────────────────────────────────────────────────────

echo "→ Installing dependencies..."
bun install --cwd "$INSTALL_DIR" --frozen-lockfile

# ── Create launcher script ────────────────────────────────────────────────────

mkdir -p "$(dirname "$BIN_PATH")"

cat > "$BIN_PATH" <<EOF
#!/usr/bin/env bash
exec bun "$INSTALL_DIR/App.tsx" "\$@"
EOF

chmod +x "$BIN_PATH"

# ── Ensure ~/.local/bin is in PATH ────────────────────────────────────────────

LOCAL_BIN="\$HOME/.local/bin"
SHELL_RC=""
if [ -n "$ZSH_VERSION" ] || [ "$(basename "$SHELL")" = "zsh" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ] || [ "$(basename "$SHELL")" = "bash" ]; then
  SHELL_RC="$HOME/.bashrc"
fi

if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]] && [ -n "$SHELL_RC" ]; then
  echo "" >> "$SHELL_RC"
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
  echo "→ Added ~/.local/bin to PATH in $SHELL_RC"
  echo "  Run: source $SHELL_RC  (or open a new terminal)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "✓ Installed! Run the app with:"
echo ""
echo "    csm"
echo ""
