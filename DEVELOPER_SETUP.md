# Developer Setup

This project is **Rust-first**, with optional UI shells later. We pin toolchains for
determinism and easy onboarding.

## Prereqs
- **Rustup** (stable) with components: `rustfmt`, `clippy`
- **Node.js** (via Corepack) for future desktop shell; **pnpm** enabled (`corepack enable`)
- **Python 3.11+** (optional) for data tooling
- **Git LFS** *not required* (models are fetched by script)
- **CMake** (onnxruntime builds on Windows/macOS; optional for now)

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
- `rust-toolchain.toml` pins Rust channel & components.
- Node version is controlled by `packageManager` + `engines` (future UI package).
- CI enforces the same versions across macOS/Windows/Linux.

---
### Git Initialization Behavior
The `scripts/bootstrap.sh` script now automatically initializes a Git repository if one is not already present.
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
