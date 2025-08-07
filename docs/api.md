# Frontend-Backend API Contract

This document defines the Tauri command-based API for communication between the React frontend and the Rust backend.

## 1. Conventions

- **Commands**: All backend functions are invoked via `invoke('command_name', { args })`.
- **Responses**: Successful invocations return `Promise<T>`. Errors return `Promise<never>` with a descriptive error message string.
- **Data Types**: All data structures (e.g., `ConstraintKind`, `TransformStack`) match the definitions in the `types` crate and are serialized as JSON.

## 2. Commands

### `load_project`

Loads project metadata, including paths to map and reference files.

- **Request**: `{ path: string }`
- **Response**: `ProjectMetadata` (A new struct to be defined in `types`)

### `get_constraints`

Retrieves the current list of constraints.

- **Request**: `null`
- **Response**: `ConstraintKind[]`

### `add_constraint`

Adds a new constraint and returns the updated list.

- **Request**: `ConstraintKind`
- **Response**: `ConstraintKind[]`

### `update_constraint`

Updates an existing constraint.

- **Request**: `ConstraintKind`
- **Response**: `ConstraintKind[]`

### `delete_constraint`

Deletes a constraint by its ID.

- **Request**: `{ id: u64 }`
- **Response**: `ConstraintKind[]`

### `solve_global`

Performs a global solve (Similarity/Affine) based on the current constraints.

- **Request**: `null`
- **Response**: `{ transform: TransformStack, metrics: QualityMetrics }`

### `solve_local`

Performs a local warp (TPS/FFD) solve.

- **Request**: `{ lambda: f64 }` (or other regularization params)
- **Response**: `{ transform: TransformStack, metrics: QualityMetrics }`
