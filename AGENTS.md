Agent Orientation: ML‑Assisted Map Georeferencer

Purpose: This is a spec‑first, local‑first Rust + Tauri + React monorepo for georeferencing raster and vector maps against georeferenced references. A primary goal is producing training data (well aligned map/reference pairs) for a future fully automatic ML geareferencing application, so we need to produce very high quality (reference-grade) output with an extremely efficient human-centric workflow. Many components are scaffolded; some backend functions remain to be implemented (see MEMO.md for gaps).

Tech Stack
- Core: Rust 1.89 workspace with crates: `types`, `solver`, `io`, `features`, `cli`
- Desktop: Tauri v2 (Rust backend) + React 19 + Vite 7 (Node 22–24 via pnpm)
- Package mgmt: pnpm workspace (`packageManager: pnpm@10`), `.nvmrc` = Node 24
- CI: GitHub Actions (Node 22/24 matrix, Rust 1.89, lint, tests, Tauri bundle)

Repository Map
- Root
  - `Cargo.toml`: Rust workspace members (`crates/*`, `apps/desktop/src-tauri`, `tools/icon-gen`), rust-version 1.89
  - `pnpm-workspace.yaml`: includes `apps/*`, `crates/*`
  - `package.json`: workspace metadata, Node `engines >=22.12 <25`
  - `justfile`: common tasks (`build`, `test`, `desktop-dev`, etc.)
  - `rust-toolchain.toml`: toolchain pin (1.89, clippy, rustfmt)
  - `DEVELOPER_SETUP.md`: setup, tooling, Node version guidance
  - `README.md`: overview, run/build instructions
  - `docs/`: specifications and architecture
- Crates (`crates/*`)
  - `types`: shared DTOs (constraints, transforms, metrics) + unit conversions
  - `solver`: global solve (Similarity/Affine), RANSAC, PROJ helpers (partials pending)
  - `io`: georeferencing I/O (world/PRJ), raster to PNG data URI, geodesy helpers (partials)
  - `features`: placeholder for detectors/matchers (scaffolded)
  - `cli`: future batch CLI (scaffolded)
- Desktop (`apps/desktop`)
  - `src/`: React app (`App.tsx`, `Canvas.tsx`) invoking Tauri commands; minimal UX to add point pairs and solve global models
  - `src-tauri/`: Rust backend commands (see API below), capabilities restricted to `core` and `dialog`
  - `vite.config.ts`, `tsconfig*.json`, `package.json`
- Tools (`tools/icon-gen`): small Rust utility to generate the app icon

Build/Run Quickstart
- Rust crates only (fast): `just build` or `cargo build --all-targets`
- Lint/test (Rust): `just lint` (fmt + clippy) and `just test`
- Frontend typecheck: `pnpm -C apps/desktop typecheck`
  - If you see errors about missing node types, you may need to run `pnpm -C apps/desktop add -D @types/node`
- Desktop dev (Tauri):
  - `cd apps/desktop && pnpm install && pnpm tauri:dev`
  - Requires Node 22–24 (use `.nvmrc` → 24) and platform prerequisites (see README)
- Desktop bundle: `pnpm -C apps/desktop tauri:build`

Backend API (current)
- Defined in `apps/desktop/src-tauri/src/main.rs` (Tauri commands):
  - `set_map_path(path) -> void`
  - `set_reference_path(path) -> void` (reads world/PRJ)
  - `load_raster_data(path) -> data:image/png;base64,...`
  - `get_constraints() -> ConstraintKind[]`
  - `add_constraint(c) -> ConstraintKind[]` (enriches with `dst_real`, `dst_local` when ref georef present)
  - `delete_constraint(id) -> ConstraintKind[]`
  - `solve_global(method, errorUnit, mapScale?) -> [TransformStack, QualityMetrics]`
  - `get_proj_string(method) -> string`
  - `export_world_file(pathWithoutExt, method) -> void`
  - `export_georeferenced_geotiff(method, outputWithoutExt) -> void`
  - `get_reference_georef() -> Georef | null`
See `docs/api.md` for request/response details.

Specs & Roadmap
- `docs/SPEC.md`: inputs, transform models, solver behavior, outputs, determinism
- `docs/ROADMAP.md`: staged goals (G1…G6)
- `docs/ARCHITECTURE.md`: modules, dataflow, perf notes
- `schemas/*.schema.json`: JSON schemas for constraints/transform stacks

Notable Gaps (blocking items)
- `crates/solver`: functions referenced by tests and Tauri (e.g., `pairs_from_constraints`, `similarity_to_proj`, `affine_to_proj`) are pending. See MEMO.md.
- `docs/api.md`: updated to match current commands; “planned” ones are not implemented yet.
- `crates/io`: geodesy conversions are minimal and may require revision for robust CRS handling.

Conventions
- Formatting: `cargo fmt --all`, ESLint/Prettier for frontend
- Linting: `cargo clippy --all-targets -D warnings`, TypeScript `pnpm typecheck`, ESLint `pnpm lint`
- Commit hygiene: pre-commit hooks for basic checks; CI runs lint/tests and bundles Tauri
- ALWAYS update all relevant documentation, including this document, when significant changes are made - feature progress, component/framework/library updates, etc.

Where to Extend
- Global solver: complete PROJ helpers and constraint extraction; add affine/similarity PROJ pipelines
- Local solver: TPS/FFD fitting and integration into `TransformStack`
- I/O: MBTiles/COG readers, PDF vector/raster handling, robust georeferencing parsing, OpenOrienteering Mapper .omap import and wireframe rendering
- Frontend: richer constraint tools (lines/areas/anchors), residual heatmaps, QA reports

Further Reading
- Start with `README.md` and `docs/SPEC.md`, then inspect `crates/solver/src/lib.rs` and `apps/desktop/src-tauri/src/main.rs` to align API and solver implementations.
