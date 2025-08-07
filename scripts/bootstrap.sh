#!/usr/bin/env bash
set -euo pipefail

echo "→ Installing Rust components"
rustup component add rustfmt clippy || true

echo "→ Installing pre-commit"
if ! command -v pre-commit >/dev/null 2>&1; then
  pipx install pre-commit || pip install --user pre-commit
fi
if [ ! -d ".git" ]; then
  echo "→ Initializing git repository..."
  git init
  git add .
  git commit -m "Initial commit from bootstrap"
fi
pre-commit install || true

echo "→ Enabling Corepack (pnpm)"
corepack enable || true

echo "Bootstrap complete."
