# Developer Setup

This project is **Rust-first**, with a Tauri desktop UI. Toolchains are pinned for determinism and easy onboarding.

## Prereqs
- **Rustup** with toolchain 1.89 (pinned in `rust-toolchain.toml`), components: `rustfmt`, `clippy`
- **Node.js** 22–24 (use `.nvmrc` → 24) with **pnpm** via Corepack (`corepack enable`)
- **Python 3.11+** (optional) for data tooling
- **Git LFS** not required (models are fetched by script)
- **CMake** (optional; needed if enabling ONNX backends later)

## One-time
```bash
# macOS (Homebrew examples)
brew install rustup just cmake corepack pre-commit
rustup-init -y
rustup toolchain install stable --component rustfmt clippy
corepack enable
pre-commit install
```

## Task runner
We use **just**. See the `justfile` for tasks.

```bash
just setup      # fetch hooks & tools
just lint       # fmt + clippy + markdownlint
just spec       # open spec files
```

## Toolchain pinning
- `rust-toolchain.toml` pins Rust channel (1.89) & components.
- Node version is controlled by root `package.json` `engines` and `.nvmrc`.
- CI enforces Node 22/24 and Rust 1.89 across macOS/Windows/Linux.

---
### Git Initialization Behavior
The `scripts/bootstrap.sh` script initializes a Git repository if one is not already present.
It will:
1. Run `git init`
2. Stage all files
3. Create an initial commit
4. Install **pre-commit** hooks

**Manual override:** If you prefer to initialize Git manually before running the bootstrap script, simply run:
```bash
git init && git add . && git commit -m "Initial commit"
```
Then execute `scripts/bootstrap.sh`.

## Desktop (Tauri) dev
```bash
cd apps/desktop
pnpm install
pnpm tauri:dev
```

Note: The desktop app depends on backend functions in `crates/solver`. Some APIs are stubbed or pending; see MEMO.md before attempting full workflows.
