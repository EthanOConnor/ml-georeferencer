# Spec: ML‑Assisted Map Georeferencer

This doc defines the **manual georeferencer** and the **ML assist** that proposes alignment.

## 1. Inputs
- Map: `.omap`/`.omapx`/OCAD/PDF (vector or raster)
- References: MBTiles/COG, DEM/DSM/LiDAR hillshade/slope, GPX/FIT, GIS vectors
- CRS: project CRS (PROJ); all inputs reprojected on the fly

## 2. Transform Model
- Global: Similarity → Affine → Homography (RANSAC init from high‑trust features)
- Local: TPS or FFD (B‑spline) or Piecewise‑Affine (triangulated GCPs)
- Regularization: bending energy (TPS λ), grid smoothness (FFD), clamped boundaries

## 3. Constraint Types
- Points (hard/soft), Lines (orthogonal distance), Areas (Chamfer/Hausdorff)
- Directional/anisotropic pins (elliptical uncertainty aligned to a line)
- Relational (“left of”, distance bands), Anchors (“don’t warp” regions)
- Change masks (exclude areas known to have changed)

## 4. Solver
- Coarse‑to‑fine Gauss‑Newton with robust loss (Huber/Tukey), IRLS
- Global RANSAC → local warp fit; preview updates live (GPU residuals)
- Trimmed least squares to reject outliers

## 5. Handling generalized cartography
- Point symbols default **Soft** (low weight) and/or **anisotropic** constraints
- Do **not** warp to satisfy readability offsets; instead record **cartographic_offset** per object
- Structure (contours/roads/buildings) dominates solve; point clutter informs QA only

## 6. Outputs
- Transform stack (global + local) with quality metrics
- Full constraint set with types/weights/ellipses
- PROJ pipeline when representable; VRT/TPS otherwise
- Quality report: RMSE, P90 error, residual heatmap

## 7. ML Assist
- Phase A: keypoint/graph (SuperPoint + LightGlue‑like) → RANSAC affine
- Phase B: dense correspondence (RAFT‑like) on (rendered map channels ↔ imagery/hillshade) → TPS/FFD distillation
- Phase C: change‑aware masks; GPS heatmap channel; uncertainty map
- Training data: every manual session; plus synthetic warps (sim/affine/homo + TPS/FFD, lens, elastic)

## 8. Determinism
- Deterministic mode: single‑thread tessellation, fixed seeds, fp32 only
- Export stability: same inputs produce bit‑identical outputs

## 9. Storage & Interop
- Store transform + constraints in project metadata; append‑only audit
- Prefer applying warp to **imagery**, not geometry; geometry edits are separate
