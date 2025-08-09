# ML‑Assisted Map Georeferencer

A **local‑first**, cross‑platform georeferencing tool for orienteering maps that pairs a
**world‑class manual georeferencer** with **ML‑assisted alignment**. It consumes maps
(`.omap`/`.omapx`/OCAD/PDF) and georeferenced references (orthophotos, COG/MBTiles, DEM/LiDAR,
GPX/FIT tracks, GIS layers) and outputs a **transform stack** (global + local) plus a **quality
report**. Every session becomes high‑quality training data for the ML model.

> Status: **spec-first repo** (v2025-08-07). This is a working blueprint with partial scaffolding; several backend functions are intentionally stubbed or pending (see MEMO.md for gaps).

## Highlights
- Ultrafast manual UX: realtime preview while dragging control points, residual heatmaps.
- Robust solver: RANSAC init → Gauss‑Newton TPS/FFD with robust/anisotropic losses.
- Constraint types: points, lines, areas, directional/relational, “don’t warp” anchors.
- ML assist: keypoint/graph coarse aligner → dense‑flow refinement → TPS/FFD distillation.
- Outputs: PROJ pipelines where possible, VRT/TPS otherwise. Deterministic exports.
- Local‑first storage; signed, append‑only operation logs ready for sync integration.

See **docs/SPEC.md** and **docs/ROADMAP.md** for the complete specification and plan.

## Running the Desktop App

The Tauri desktop shell lives in `apps/desktop` and can be run locally for
testing.

### Prerequisites (Ubuntu)

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev libsoup2.4-dev
```

### Prerequisites (macOS)

Install the Xcode command line tools and pnpm:

```bash
xcode-select --install
brew install pnpm
```

### Prerequisites (Windows)

Install the Visual Studio Build Tools with the "Desktop development with C++"
workload and ensure the WebView2 runtime is present. Then install pnpm:

```powershell
npm install -g pnpm
```

Minimum Node version for the desktop UI (Vite 7): Node 22+. The repo provides `.nvmrc` with `24` and root `package.json` engines (`>=22.12 <25`). Use Node 24 for best compatibility.

### Launch (Dev)

```bash
cd apps/desktop
pnpm install
pnpm run tauri:dev
```

This opens a window with map and reference panes where you can add pins,
toggle the "Global only" solver and view residuals.

## Canonical Build

This repo is a Rust + Node monorepo. Use pnpm for JS and Cargo for Rust.

- Install deps (root):
  - `pnpm install` (respects the pnpm workspace)
- Build Rust crates:
  - `cargo build --all-targets`
- Type-check frontend:
  - `pnpm -C apps/desktop exec tsc -p tsconfig.json --noEmit`
- Desktop dev (Tauri):
  - `pnpm -C apps/desktop tauri:dev`
- Desktop release bundle:
  - `pnpm -C apps/desktop tauri:build`

Shortcuts with just:
- `just build` – Build Rust workspace
- `just desktop-dev` – Run desktop app in dev
- `just desktop-build` – Bundle desktop app
- `just build-all` – Build Rust crates and desktop bundle

Notes:
- Rust toolchain pinned to 1.89 via `rust-toolchain.toml` (CI matches).
- Tauri v2 capabilities are minimized to `core` and `dialog` for least privilege; filesystem access is via backend Rust code.
- The bundle identifier is `com.mlgeoreferencer.desktop` (no `.app` suffix to avoid macOS conflicts).
- The desktop shell compiles once pending backend APIs in `solver` are implemented (see MEMO.md).
