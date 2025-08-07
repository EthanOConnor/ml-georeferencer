# Roadmap

## G1 — Manual Core (6–8 weeks)
- Load map (omap/ocad/pdf) + references (MBTiles/COG/DEM/GPX)
- GCPs, line/area constraints; RANSAC + affine/TPS; live preview
- Residual heatmap; outlier table; export PROJ/VRT; training record

## G2 — Assisted UX
- Auto‑suggest GCPs (corners/intersections/ridge & saddle)
- Anisotropic/directional pins; anchors; change masks
- Session QA report; CLI batch mode

## G3 — ML Keypoint Baseline
- Detector/descriptor + graph matcher; synthetic training
- Autopropose global transform + confidence
- Integrate into UX (one‑click accept/refine)

## G4 — Dense Refinement
- RAFT‑like dense correspondence on map‑channels↔imagery
- TPS/FFD distillation; uncertainty maps; mask changed regions

## G5 — Mobile & Models
- Mobile preview; model packaging; offline inference
- GPS heatmap channel; energy‑aware pipelines

## G6 — Productize
- Model registry/versioning; quality dashboards
- Export bundles; organization policies; documentation site
