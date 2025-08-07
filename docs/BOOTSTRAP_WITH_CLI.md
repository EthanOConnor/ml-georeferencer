# Repo Bootstrap via OpenAI CLI (Codex/GPT‑5)

Paste the following prompt into your OpenAI CLI session to scaffold the repository.
Adjust org/name as needed.

## 0) Create repo & commit spec
```bash
mkdir ml-georeferencer && cd ml-georeferencer
git init
cp -R /path/to/georeferencer-spec/* .  # replace with the extracted spec files
git add . && git commit -m "chore: import spec and roadmap"
gh repo create yourorg/ml-georeferencer --public --source=. --push
```

## 1) Ask GPT‑5 (Codex) to generate scaffolding
Prompt:
```
You are a build system expert. Generate a cross-platform Rust workspace skeleton for an
ML-assisted georeferencer:

- Create Cargo workspace with crates: solver, features, io, cli
- Pin toolchain via rust-toolchain.toml (stable + rustfmt + clippy)
- Add minimal src/lib.rs for solver/features/io, and src/main.rs for cli that prints version
- Add feature flags: gpu (wgpu), onnx, opencv
- Add dev-deps: anyhow, thiserror, serde, serde_json, clap, approx
- Add basic unit test in solver that instantiates a TPS transform struct
- Add Justfile tasks: build, test, lint, fmt
- Ensure `cargo clippy --all-targets -D warnings` passes
Output the full file list and contents.
```
Run:
```bash
openai chat.completions.create -m gpt-5.0-pro -g true -p "$(cat <<'PROMPT'
[PASTE PROMPT TEXT FROM ABOVE]
PROMPT
)"
```

## 2) Install hooks & check
```bash
just setup
just lint
```

## 3) (Optional) Add desktop shell later
Ask GPT‑5 for a minimal Tauri app that loads the solver crate via FFI and shows two panes
(swipe/blink preview). Keep it in `apps/desktop` with its own `package.json` and `src-tauri`.
```
