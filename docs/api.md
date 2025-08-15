# Frontend-Backend API Contract

This document defines the Tauri command-based API between the React frontend and the Rust backend.

## 1. Conventions

- Commands are invoked via `invoke('command_name', args)`.
- Success returns `Promise<T>`; errors reject with a string message.
- Data types mirror the `types` crate (serialized via JSON): `ConstraintKind`, `TransformStack`, `QualityMetrics`, etc.
- Pixel coordinates: pixel centers are at integer coordinates; no implicit 0.5 offset is applied inside solver/export transforms.
- CRS normalization: when converting geographic CRSs, longitudes map to x and latitudes to y before projecting to any local plane to avoid axis-order ambiguity.

## 2. Implemented Commands (current)

These commands are implemented in `apps/desktop/src-tauri/src/main.rs`:

- `set_map_path(path: string) -> void`
  - Set the current map image path. Stored in state only.

- `set_reference_path(path: string) -> void`
  - Set the reference image path. Attempts robust sidecar detection (`.tfw`/`.jgw`/`.pgw`/`.gfw`/`.bpw` and `.wld`) plus `.prj`; falls back to TIFF/GeoTIFF tags (ModelTransformation or PixelScale+Tiepoint) and GeoKeys (EPSG) when applicable.

- `load_raster_data(path: string) -> string`
  - Load a raster file and return a `data:image/png;base64,...` URI for UI rendering.

- `get_constraints() -> ConstraintKind[]`
  - Return the in-memory list of constraints.

- `add_constraint(c: ConstraintKind) -> ConstraintKind[]`
  - Append a constraint and return the updated list. If a reference georeference is set, enriches point-pairs with derived `dst_real` and `dst_local`.

- `delete_constraint(id: number) -> ConstraintKind[]`
  - Remove a constraint by ID and return the updated list.

- `solve_global(method: 'similarity' | 'affine', errorUnit: 'pixels' | 'meters' | 'mapmm', mapScale?: number) -> [TransformStack, QualityMetrics]`
  - Fit a global transform using current constraints. Returns a one-element `TransformStack` and quality metrics including per-constraint residuals.

- `get_proj_string(method: 'similarity' | 'affine') -> string`
  - Return a PROJ pipeline string for the fitted transform.

- `export_world_file(pathWithoutExt: string, method: 'similarity' | 'affine') -> void`
  - Write an ESRI world file (`.tfw`) next to the given base path using the fitted transform.

- `export_georeferenced_geotiff(method: 'similarity' | 'affine', outputWithoutExt: string) -> void`
  - Compose the map->ref transform with the reference world transform and write a new world file and a default PRJ next to `outputWithoutExt`.

- `get_reference_georef() -> Georef | null`
  - Return the loaded reference georeference (affine + optional WKT), if available.

## 3. Planned Commands (spec)

The following are in the spec but not yet implemented. Treat as roadmap:

- `load_project(path: string) -> ProjectMetadata`
- `update_constraint(c: ConstraintKind) -> ConstraintKind[]`
- `solve_local(params...) -> [TransformStack, QualityMetrics]`

Refer to MEMO.md for pending backend functions that block some of the above.
