OpenOrienteering Mapper .omap Import and Skeleton Render (Spec)

Goals
- Import essential geometry and metadata from .omap files for alignment and QA.
- Render a lightweight wireframe/skeleton for visual context over the reference raster.
- Preserve enough attribution to map back edits later (IDs, layer names).

Format Overview
- .omap (OpenOrienteering Mapper) is an XML-based format (UTF-8) with project-wide metadata and a list of objects.
- Common elements: <map>, <symbol> catalog, <object> entries (points, lines, areas), layers, coordinate system info.
- Units: internal coordinates in mm at map scale or projected units depending on document settings. Symbols reference ISOM/ISSprOM styles.

MVP Parsed Fields
- Map metadata: name, scale denominator, georeferencing (if present), symbol set info.
- Layers: id, name, visibility.
- Objects (subset):
  - Point: id, layer, xy, symbol-id.
  - Polyline: id, layer, points[] (xy), symbol-id.
  - Polygon: id, layer, outer[] (xy), holes(optional).

Coordinate Handling
- If CRS/georeferencing present in .omap: extract and normalize to `crs` string (EPSG/proj/WKT) and an affine if defined.
- Else: assume OOM internal coordinates in mm at map scale (map mm). When composing with reference raster, require user to align via constraints.
- Conversion rules:
  - Internal mm → map meters: meters = map_mm / 1000 * scale.
  - For rendering over reference in pixel space, use fitted transform stack to map OOM geometry → reference pixels.

Import Pipeline
1) Parse XML using a streaming reader (quick-xml or roxmltree in future).
2) Extract metadata (map name, scale, CRS if any).
3) Index layers and symbols (minimally symbol name/type/color for legend overlay, optional at MVP).
4) Create a lightweight `OomDoc` data structure:
   - `meta { name, scale, crs: Option<String> }`
   - `layers: Vec<{ id, name, visible }>`
   - `objects: enum { Point, Polyline, Polygon }` with geometry in document units.

Skeleton Rendering
- Strategy: CPU draw to offscreen canvas in the UI, using thin strokes and low alpha by symbol category.
- Styling (MVP):
  - Point objects: small circle.
  - Polylines: 1px line, color by layer hash.
  - Polygons: outline only, no fill (or transparent fill with low alpha).
- Transform chain: OOM coords (map mm or meters) → map image px (via inverse of fitted map->ref) or directly → reference px using fitted map->ref ∘ ref->world if georef available.
- Performance: simplify polylines with Douglas-Peucker at view scale; clip to viewport.

Interactivity
- Hover: display layer/name/id.
- Toggle layers: simple list with checkboxes.
- Snap assist (later): allow snapping constraints to OOM vertices.

Validation
- Unit tests: parse small .omap fixture with 1 point, 1 line, 1 polygon; verify counts and bounding box.
- Visual: golden images for skeleton render at fixed transform.

Planned Extensions
- Render symbolized styles (ISOM/ISSprOM) for a richer preview.
- Support text objects; curved text.
- Write-back transforms to .omap or export aligned GeoJSON.

