#!/usr/bin/env bash
set -euo pipefail

REPO="AbdelzaherAbdelgwad/claude-sessions-manager-tui"
BIN_PATH="$HOME/.local/bin/csm"

# ── Runtime dependency ────────────────────────────────────────────────────────
# The binary embeds the Bun runtime, but the app spawns `claude` at runtime.
if ! command -v claude &>/dev/null; then
  echo "✗ 'claude' not found. Install Claude Code: https://claude.ai/code"
  exit 1
fi

# ── Detect platform → release asset ───────────────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Linux-x86_64)  asset="csm-linux-x64" ;;
  Linux-aarch64) asset="csm-linux-arm64" ;;
  Darwin-arm64)  asset="csm-macos-arm64" ;;
  *)
    echo "✗ No prebuilt binary for: $os-$arch"
    echo "  Supported: Linux (x86_64/aarch64), macOS (Apple Silicon / arm64)."
    echo "  Build from source instead — see the Development section in the README."
    exit 1
    ;;
esac

# ── Download ──────────────────────────────────────────────────────────────────
url="https://github.com/$REPO/releases/latest/download/$asset"
echo "→ Downloading $asset ..."
mkdir -p "$(dirname "$BIN_PATH")"
if ! curl -fsSL "$url" -o "$BIN_PATH"; then
  echo "✗ Download failed: $url"
  echo "  Make sure a release has been published for this platform."
  exit 1
fi
chmod +x "$BIN_PATH"

# ── Ensure ~/.local/bin is on PATH ────────────────────────────────────────────
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *)
    SHELL_RC="$HOME/.bashrc"
    [ "$(basename "${SHELL:-}")" = "zsh" ] && SHELL_RC="$HOME/.zshrc"
    echo "" >> "$SHELL_RC"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
    echo "→ Added ~/.local/bin to PATH in $SHELL_RC"
    echo "  Run: source $SHELL_RC  (or open a new terminal)"
    ;;
esac

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "✓ Installed! Run the app with:"
echo ""
echo "    csm"
echo ""
