To: PM, Domain Experts, External Reviewers, Senior Devs
Subject: Repository Review – Gaps, Risks, and Clarifications Needed

Summary
I reviewed the monorepo end-to-end. It’s a solid spec‑first foundation with a minimal Tauri desktop shell and Rust workspace. A few backend functions referenced by the UI/tests are missing; API docs were out of sync (fixed). Below are the specific items that need direction or domain input.

1) Backend Function Gaps (High Priority)
- Missing in `crates/solver` but referenced:
  - `pairs_from_constraints(&[ConstraintKind]) -> Vec<([f64;2],[f64;2])>`
    - Required by desktop backend (`solve_global`, `get_proj_string`, exports). Intent: extract point‑pair constraints with weights ignored for now or used later.
  - `similarity_to_proj(&Similarity) -> String` and `affine_to_proj(&Affine) -> String`
    - Used by desktop for PROJ export. Need decisions on the exact pipeline format and axis conventions (pixel coordinates vs. projected meters). Example approach: `+proj=pipeline +step +proj=affine +xoff=tx +yoff=ty +s11=a +s12=b +s21=c +s22=d`.
  - Tests reference `invert_similarity` and `compose_similarity` helpers.

Ask: Approve the PROJ pipeline specification and coordinate system conventions; confirm that pairs should be extracted only from `PointPair` constraints for G1.

2) CRS/Geodesy Handling in `io` (Medium Priority)
- `pixel_to_local_meters` converts via `WKT -> EPSG:4326 -> local AEQD`. Concerns:
  - The `proj` crate’s `new_known_crs` typically expects EPSG codes or PROJ strings, not raw WKT. We should parse PRJ/WKT to an EPSG/proj string or use a different constructor.
  - The local plane is centered on `[0,0]` image pixel; do we want a different origin? The UI currently uses `dst_local` for error units.

Ask: Provide desired behavior and accuracy requirements for CRS conversions. Can we depend on GDAL/Proj full parsing, or must we stay in pure Rust? Acceptable fallbacks when PRJ is missing?

3) Desktop App Security and Capabilities (Medium Priority)
- Capabilities: `core` and `dialog` only. Backend reads arbitrary paths via Rust std I/O. That’s acceptable in Tauri v2, but we should confirm the security stance (e.g., limiting file access or adding `fs` plugin policies).
- CSP allows `connect-src 'self' https://*;` which is permissive. It’s helpful for map tiles/dev, but confirm for release.

Ask: Define release CSP and any additional capabilities (e.g., `fs`) needed for MBTiles/COG/PDF workflows.

4) Desktop UX/Data Flow (Lower Priority for G1)
- The UI shows two panes and supports similarity/affine solves. Local warps (TPS/FFD), QA views, and line/area constraints are roadmap items. Export currently writes `.tfw`/`.prj` only; no GeoTIFF rewrite.

Ask: For G1, is `.tfw`/`.prj` sufficient, or do we want an in‑place GeoTIFF with updated tags? If so, we need a strategy (likely GDAL binding or an in‑house GeoTIFF writer).

5) Node/React Versions (Informational)
- React 19 + Vite 7 + Node 22–24. CI validates Node 22/24. This is modern and OK. No action required.

6) CI/Tooling Alignment (Resolved)
- Workspace `rust-version` now matches `rust-toolchain.toml` (1.89). Docs updated.

Proposed Next Steps
1. Approve PROJ string format and coordinate conventions; then implement the missing solver helpers and constraint extractor.
2. Decide on CRS parsing strategy (accept WKT, convert to EPSG/PROJ, or require EPSG). Update `io` accordingly.
3. Confirm Tauri capabilities and CSP for release builds.
4. Clarify export targets for G1 (world file vs GeoTIFF updates).

References
- Specs: `docs/SPEC.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`
- API (updated): `docs/api.md`
- Orientation: `AGENTS.md`

