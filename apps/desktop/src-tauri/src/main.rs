#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::State;
use types::{ConstraintKind, ErrorUnit, QualityMetrics, TransformKind, TransformStack};

#[derive(Default)]
struct AppState {
    map_path: Mutex<Option<String>>,
    reference_path: Mutex<Option<String>>,
    constraints: Mutex<Vec<ConstraintKind>>,
    ref_georef: Mutex<Option<io::Georef>>,
}

#[tauri::command]
fn set_map_path(path: String, state: State<AppState>) -> Result<(), String> {
    *state.map_path.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(())
}

#[tauri::command]
fn set_reference_path(path: String, state: State<AppState>) -> Result<(), String> {
    let base = std::path::Path::new(&path)
        .with_extension("")
        .to_string_lossy()
        .into_owned();
    let georef = io::read_georeferencing(&base).ok();
    *state.ref_georef.lock().map_err(|e| e.to_string())? = georef;
    *state.reference_path.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(())
}

#[tauri::command]
fn load_raster_data(path: String) -> Result<String, String> {
    io::load_raster(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_constraints(state: State<AppState>) -> Result<Vec<ConstraintKind>, String> {
    Ok(state
        .constraints
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}

#[tauri::command]
fn add_constraint(mut c: ConstraintKind, state: State<AppState>) -> Result<Vec<ConstraintKind>, String> {
    if let ConstraintKind::PointPair { dst, dst_real, dst_local, .. } = &mut c {
        if let Some(geo) = state.ref_georef.lock().map_err(|e| e.to_string())?.as_ref() {
            if dst_real.is_none() {
                *dst_real = Some(io::pixel_to_world(geo, *dst));
            }
            if dst_local.is_none() {
                if let Ok(Some(local)) = io::pixel_to_local_meters(geo, *dst, [0.0, 0.0]) {
                    *dst_local = Some(local);
                }
            }
        }
    }
    let mut list = state.constraints.lock().map_err(|e| e.to_string())?;
    list.push(c);
    Ok(list.clone())
}

#[tauri::command]
fn delete_constraint(id: u64, state: State<AppState>) -> Result<Vec<ConstraintKind>, String> {
    let mut list = state.constraints.lock().map_err(|e| e.to_string())?;
    list.retain(|c| c.id() != id);
    Ok(list.clone())
}

#[tauri::command]
fn solve_global(
    method: String,
    error_unit: String,
    map_scale: Option<f64>,
    state: State<AppState>,
) -> Result<(TransformStack, QualityMetrics), String> {
    let list = state.constraints.lock().map_err(|e| e.to_string())?;
    let pairs = solver::pairs_from_constraints(&list);
    if pairs.len() < 2 && method == "similarity" {
        return Err(format!("need ≥2 pairs; got {}", pairs.len()));
    }
    if pairs.len() < 3 && method == "affine" {
        return Err(format!("need ≥3 pairs; got {}", pairs.len()));
    }
    let mut warnings = Vec::new();
    if variance_low(&pairs) {
        warnings.push("Low variance in source points; results may be unstable".to_string());
    }
    let pixel_size = state
        .ref_georef
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|g| {
            let ax = (g.affine[0].powi(2) + g.affine[2].powi(2)).sqrt();
            let ay = (g.affine[1].powi(2) + g.affine[3].powi(2)).sqrt();
            (ax + ay) / 2.0
        })
        .unwrap_or(1.0);
    let target_unit = match error_unit.as_str() {
        "meters" => ErrorUnit::Meters,
        "mapmm" => ErrorUnit::MapMillimeters,
        _ => ErrorUnit::Pixels,
    };

    match method.as_str() {
        "similarity" => {
            let t = solver::fit_similarity_from_pairs(&pairs).map_err(|e| e.to_string())?;
            let (rmse, p90, residuals) = metrics_similarity(&t, &pairs);
            let residuals_by_id = residuals_by_id_similarity(&t, &list);
            let mut qm = QualityMetrics { rmse, p90_error: p90, residuals, residuals_by_id, warnings, unit: ErrorUnit::Pixels, map_scale: None };
            if target_unit != ErrorUnit::Pixels {
                qm.convert_units(pixel_size, map_scale, target_unit);
            } else {
                qm.map_scale = map_scale;
            }
            Ok((
                TransformStack { transforms: vec![TransformKind::Similarity(t)] },
                qm,
            ))
        }
        "affine" => {
            let t = solver::fit_affine_from_pairs(&pairs).map_err(|e| e.to_string())?;
            let (rmse, p90, residuals) = metrics_affine(&t, &pairs);
            let residuals_by_id = residuals_by_id_affine(&t, &list);
            let mut qm = QualityMetrics { rmse, p90_error: p90, residuals, residuals_by_id, warnings, unit: ErrorUnit::Pixels, map_scale: None };
            if target_unit != ErrorUnit::Pixels {
                qm.convert_units(pixel_size, map_scale, target_unit);
            } else {
                qm.map_scale = map_scale;
            }
            Ok((
                TransformStack { transforms: vec![TransformKind::Affine(t)] },
                qm,
            ))
        }
        _ => Err(format!("unknown method {}", method)),
    }
}

fn metrics_similarity(t: &types::Similarity, pairs: &[([f64; 2], [f64; 2])]) -> (f64, f64, Vec<f64>) {
    let residuals: Vec<f64> = pairs
        .iter()
        .map(|(src, dst)| {
            let s = nalgebra::Vector2::from(*src);
            let d = nalgebra::Vector2::from(*dst);
            let pred = solver::Transform::apply(t, &s);
            (pred - d).norm()
        })
        .collect();
    summarize_residuals(residuals)
}

fn metrics_affine(t: &types::Affine, pairs: &[([f64; 2], [f64; 2])]) -> (f64, f64, Vec<f64>) {
    let residuals: Vec<f64> = pairs
        .iter()
        .map(|(src, dst)| {
            let s = nalgebra::Vector2::from(*src);
            let d = nalgebra::Vector2::from(*dst);
            let pred = solver::Transform::apply(t, &s);
            (pred - d).norm()
        })
        .collect();
    summarize_residuals(residuals)
}

fn summarize_residuals(mut residuals: Vec<f64>) -> (f64, f64, Vec<f64>) {
    if residuals.is_empty() {
        return (0.0, 0.0, residuals);
    }
    let rmse = (residuals.iter().map(|r| r * r).sum::<f64>() / residuals.len() as f64).sqrt();
    residuals.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let idx = ((residuals.len() as f64) * 0.9).floor() as usize;
    let idx = idx.min(residuals.len() - 1);
    let p90 = residuals[idx];
    (rmse, p90, residuals)
}

fn variance_low(pairs: &[([f64; 2], [f64; 2])]) -> bool {
    if pairs.is_empty() { return true; }
    let n = pairs.len() as f64;
    let mean_x = pairs.iter().map(|(s, _)| s[0]).sum::<f64>()/n;
    let mean_y = pairs.iter().map(|(s, _)| s[1]).sum::<f64>()/n;
    let var = pairs.iter().map(|(s, _)| (s[0]-mean_x).powi(2) + (s[1]-mean_y).powi(2)).sum::<f64>()/n;
    var < 1e-6
}

fn residuals_by_id_similarity(t: &types::Similarity, constraints: &[ConstraintKind]) -> Vec<(u64, f64)> {
    constraints.iter().filter_map(|c| match c {
        ConstraintKind::PointPair { id, src, dst, .. } => {
            let s = nalgebra::Vector2::from(*src);
            let d = nalgebra::Vector2::from(*dst);
            let pred = solver::Transform::apply(t, &s);
            Some((*id, (pred - d).norm()))
        }
        _ => None,
    }).collect()
}

fn residuals_by_id_affine(t: &types::Affine, constraints: &[ConstraintKind]) -> Vec<(u64, f64)> {
    constraints.iter().filter_map(|c| match c {
        ConstraintKind::PointPair { id, src, dst, .. } => {
            let s = nalgebra::Vector2::from(*src);
            let d = nalgebra::Vector2::from(*dst);
            let pred = solver::Transform::apply(t, &s);
            Some((*id, (pred - d).norm()))
        }
        _ => None,
    }).collect()
}

#[tauri::command]
fn get_proj_string(method: String, state: State<AppState>) -> Result<String, String> {
    let list = state.constraints.lock().map_err(|e| e.to_string())?;
    let pairs = solver::pairs_from_constraints(&list);
    match method.as_str() {
        "similarity" => {
            let t = solver::fit_similarity_from_pairs(&pairs).map_err(|e| e.to_string())?;
            Ok(solver::similarity_to_proj(&t))
        }
        "affine" => {
            let t = solver::fit_affine_from_pairs(&pairs).map_err(|e| e.to_string())?;
            Ok(solver::affine_to_proj(&t))
        }
        _ => Err(format!("unknown method {}", method)),
    }
}

#[tauri::command]
fn export_world_file(path_without_ext: String, method: String, state: State<AppState>) -> Result<(), String> {
    let list = state.constraints.lock().map_err(|e| e.to_string())?;
    let pairs = solver::pairs_from_constraints(&list);
    match method.as_str() {
        "similarity" => {
            let t = solver::fit_similarity_from_pairs(&pairs).map_err(|e| e.to_string())?;
            // Convert similarity to affine params [a,b,c,d,tx,ty]
            let s = t.params[0];
            let th = t.params[1];
            let (c, si) = (th.cos(), th.sin());
            let a = s * c;
            let b = -s * si;
            let d = s * si;
            let e = s * c;
            let tx = t.params[2];
            let ty = t.params[3];
            io::write_world_file(&path_without_ext, [a, b, d, e, tx, ty]).map_err(|e| e.to_string())
        }
        "affine" => {
            let t = solver::fit_affine_from_pairs(&pairs).map_err(|e| e.to_string())?;
            let p = t.params;
            io::write_world_file(&path_without_ext, [p[0], p[1], p[2], p[3], p[4], p[5]])
                .map_err(|e| e.to_string())
        }
        _ => Err(format!("unknown method {}", method)),
    }
}

#[tauri::command]
fn export_georeferenced_geotiff(state: State<AppState>, method: String, output_without_ext: String) -> Result<(), String> {
    // Compose map->ref pixel transform with ref pixel->world from .tfw or default
    let list = state.constraints.lock().map_err(|e| e.to_string())?;
    let pairs = solver::pairs_from_constraints(&list);
    let map2ref = match method.as_str() {
        "similarity" => {
            let t = solver::fit_similarity_from_pairs(&pairs).map_err(|e| e.to_string())?;
            let s = t.params[0]; let th = t.params[1]; let (c,si)=(th.cos(), th.sin());
            [s*c, -s*si, s*si, s*c, t.params[2], t.params[3]]
        }
        "affine" => solver::fit_affine_from_pairs(&pairs).map_err(|e| e.to_string())?.params,
        _ => return Err("unknown method".into()),
    };
    let ref_path = state.reference_path.lock().map_err(|e| e.to_string())?.clone().ok_or_else(|| "reference path not set".to_string())?;
    // Strip extension from reference path
    let ref_base = std::path::Path::new(&ref_path)
        .with_extension("")
        .to_string_lossy()
        .into_owned();
    // Try reading reference world file
    let ref_aff = match io::read_world_file(&ref_base) {
        Ok(a) => a,
        Err(_) => [1.0, 0.0, 0.0, 1.0, 0.0, 0.0], // identity fallback
    };
    // Compose: world = ref_aff ∘ map2ref; 2x2 linear and translation
    let a = ref_aff;
    let b = map2ref;
    let lin = [
        a[0]*b[0] + a[1]*b[2],
        a[0]*b[1] + a[1]*b[3],
        a[2]*b[0] + a[3]*b[2],
        a[2]*b[1] + a[3]*b[3],
    ];
    let trans = [a[0]*b[4] + a[1]*b[5] + a[4], a[2]*b[4] + a[3]*b[5] + a[5]];
    io::write_world_file(&output_without_ext, [lin[0], lin[1], lin[2], lin[3], trans[0], trans[1]])
        .map_err(|e| e.to_string())?;
    // Write PRJ with NAD83(2011) as a reasonable default if no reference .prj found
    let prj_wkt = "GEOGCS[\"NAD83(2011)\",DATUM[\"NAD83_National_Spatial_Reference_System_2011\",SPHEROID[\"GRS 1980\",6378137,298.257222101]],PRIMEM[\"Greenwich\",0],UNIT[\"degree\",0.0174532925199433]]";
    let _ = io::write_prj(&output_without_ext, prj_wkt);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            set_map_path,
            set_reference_path,
            load_raster_data,
            get_constraints,
            add_constraint,
            delete_constraint,
            solve_global,
            get_proj_string,
            export_world_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
