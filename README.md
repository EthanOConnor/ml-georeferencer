# ML‑Assisted Map Georeferencer

A **local‑first**, cross‑platform georeferencing tool for orienteering maps that pairs a
**world‑class manual georeferencer** with **ML‑assisted alignment**. It consumes maps
(`.omap`/`.omapx`/OCAD/PDF) and georeferenced references (orthophotos, COG/MBTiles, DEM/LiDAR,
GPX/FIT tracks, GIS layers) and outputs a **transform stack** (global + local) plus a **quality
report**. Every session becomes high‑quality training data for the ML model.

> Status: **spec-first repo** (v2025-08-07). Use this as the blueprint to scaffold code.

## Highlights
- Ultrafast manual UX: realtime preview while dragging control points, residual heatmaps.
- Robust solver: RANSAC init → Gauss‑Newton TPS/FFD with robust/anisotropic losses.
- Constraint types: points, lines, areas, directional/relational, “don’t warp” anchors.
- ML assist: keypoint/graph coarse aligner → dense‑flow refinement → TPS/FFD distillation.
- Outputs: PROJ pipelines where possible, VRT/TPS otherwise. Deterministic exports.
- Local‑first storage; signed, append‑only operation logs ready for sync integration.

See **docs/SPEC.md** and **docs/ROADMAP.md** for the complete specification and plan.
