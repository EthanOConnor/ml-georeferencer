# Architecture

## Modules
- `solver`: constraint sets, optimizers (RANSAC, GN/IRLS), TPS/FFD/PWA
- `features`: edge/line/corner detectors, matchers
- `ml`: model runtime abstraction (ONNX/candle), pre/post‑processing
- `io`: readers (PDF vector/raster, MBTiles/COG, GPX), writers (VRT/TPS/PROJ)
- `viz`: realtime preview, residual heatmap, swipe/blink tools
- `schemas`: transform & constraints JSON schema
- `cli`: batch georeferencing for libraries
- `ui`: desktop/mobile shells (later)

## Dataflow
```
map → render channels ┐
                       ├─(manual constraints + auto suggestions)→ solver → transform stack
imagery/DEM → channels ┘
                                     └─ training record (for ML)
```

## Performance
- GPU (wgpu) for pyramids, filters, SSD/NCC, residual maps
- CPU SIMD (portable) for inner loops when GPU absent
- Tiles & caches sized for 60 fps preview on laptops
