#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::State;
use tauri_plugin_dialog;

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
    Ok(state.constraints.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn add_constraint(
    mut c: ConstraintKind,
    state: State<AppState>,
) -> Result<Vec<ConstraintKind>, String> {
    if let ConstraintKind::PointPair {
        dst,
        dst_real,
        dst_local,
        ..
    } = &mut c
    {
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
            let mut qm = QualityMetrics {
                rmse,
                p90_error: p90,
                residuals,
                residuals_by_id,
                warnings,
                unit: ErrorUnit::Pixels,
                map_scale: None,
            };
            if target_unit != ErrorUnit::Pixels {
                qm.convert_units(pixel_size, map_scale, target_unit);
            } else {
                qm.map_scale = map_scale;
            }
            Ok((
                TransformStack {
                    transforms: vec![TransformKind::Similarity(t)],
                },
                qm,
            ))
        }
        "affine" => {
            let t = solver::fit_affine_from_pairs(&pairs).map_err(|e| e.to_string())?;
            let (rmse, p90, residuals) = metrics_affine(&t, &pairs);
            let residuals_by_id = residuals_by_id_affine(&t, &list);
            let mut qm = QualityMetrics {
                rmse,
                p90_error: p90,
                residuals,
                residuals_by_id,
                warnings,
                unit: ErrorUnit::Pixels,
                map_scale: None,
            };
            if target_unit != ErrorUnit::Pixels {
                qm.convert_units(pixel_size, map_scale, target_unit);
            } else {
                qm.map_scale = map_scale;
            }
            Ok((
                TransformStack {
                    transforms: vec![TransformKind::Affine(t)],
                },
                qm,
            ))
        }
        _ => Err(format!("unknown method {}", method)),
    }
}

fn metrics_similarity(
    t: &types::Similarity,
    pairs: &[([f64; 2], [f64; 2])],
) -> (f64, f64, Vec<f64>) {
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
    if pairs.is_empty() {
        return true;
    }
    let n = pairs.len() as f64;
    let mean_x = pairs.iter().map(|(s, _)| s[0]).sum::<f64>() / n;
    let mean_y = pairs.iter().map(|(s, _)| s[1]).sum::<f64>() / n;
    let var = pairs
        .iter()
        .map(|(s, _)| (s[0] - mean_x).powi(2) + (s[1] - mean_y).powi(2))
        .sum::<f64>()
        / n;
    var < 1e-6
}

fn residuals_by_id_similarity(
    t: &types::Similarity,
    constraints: &[ConstraintKind],
) -> Vec<(u64, f64)> {
    constraints
        .iter()
        .filter_map(|c| match c {
            ConstraintKind::PointPair { id, src, dst, .. } => {
                let s = nalgebra::Vector2::from(*src);
                let d = nalgebra::Vector2::from(*dst);
                let pred = solver::Transform::apply(t, &s);
                Some((*id, (pred - d).norm()))
            }
            _ => None,
        })
        .collect()
}

fn residuals_by_id_affine(t: &types::Affine, constraints: &[ConstraintKind]) -> Vec<(u64, f64)> {
    constraints
        .iter()
        .filter_map(|c| match c {
            ConstraintKind::PointPair { id, src, dst, .. } => {
                let s = nalgebra::Vector2::from(*src);
                let d = nalgebra::Vector2::from(*dst);
                let pred = solver::Transform::apply(t, &s);
                Some((*id, (pred - d).norm()))
            }
            _ => None,
        })
        .collect()
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
fn export_world_file(
    path_without_ext: String,
    method: String,
    state: State<AppState>,
) -> Result<(), String> {
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
fn export_georeferenced_geotiff(
    state: State<AppState>,
    method: String,
    output_without_ext: String,
) -> Result<(), String> {
    // Compose map->ref pixel transform with ref pixel->world from .tfw or default
    let list = state.constraints.lock().map_err(|e| e.to_string())?;
    let pairs = solver::pairs_from_constraints(&list);
    let map2ref = match method.as_str() {
        "similarity" => {
            let t = solver::fit_similarity_from_pairs(&pairs).map_err(|e| e.to_string())?;
            let s = t.params[0];
            let th = t.params[1];
            let (c, si) = (th.cos(), th.sin());
            [s * c, -s * si, s * si, s * c, t.params[2], t.params[3]]
        }
        "affine" => {
            solver::fit_affine_from_pairs(&pairs)
                .map_err(|e| e.to_string())?
                .params
        }
        _ => return Err("unknown method".into()),
    };
    let ref_path = state
        .reference_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "reference path not set".to_string())?;
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
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
    ];
    let trans = [
        a[0] * b[4] + a[1] * b[5] + a[4],
        a[2] * b[4] + a[3] * b[5] + a[5],
    ];
    io::write_world_file(
        &output_without_ext,
        [lin[0], lin[1], lin[2], lin[3], trans[0], trans[1]],
    )
    .map_err(|e| e.to_string())?;
    // Write PRJ with NAD83(2011) as a reasonable default if no reference .prj found
    let prj_wkt = "GEOGCS[\"NAD83(2011)\",DATUM[\"NAD83_National_Spatial_Reference_System_2011\",SPHEROID[\"GRS 1980\",6378137,298.257222101]],PRIMEM[\"Greenwich\",0],UNIT[\"degree\",0.0174532925199433]]";
    let _ = io::write_prj(&output_without_ext, prj_wkt);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            export_georeferenced_geotiff,
            get_reference_georef,
            get_reference_crs,
            suggest_output_epsg,
            pixel_to,
            pixel_to_projected,
            metric_scale_at,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_reference_georef(state: State<AppState>) -> Result<Option<io::Georef>, String> {
    Ok(state.ref_georef.lock().map_err(|e| e.to_string())?.clone())
}

fn _convert_reference_pixel(
    px: f64,
    py: f64,
    mode: &str,
    policy: &str,
    state: &State<AppState>,
) -> Result<Option<[f64; 2]>, String> {
    let geo = match state.ref_georef.lock().map_err(|e| e.to_string())?.clone() {
        Some(g) => g,
        None => return Ok(None),
    };
    match mode {
        "lonlat" => {
            let world = io::pixel_to_world(&geo, [px, py]);
            if let Some(wkt) = &geo.wkt {
                let to_wgs84 =
                    proj::Proj::new_known_crs(wkt, "EPSG:4326", None).map_err(|e| e.to_string())?;
                let (lon, lat) = to_wgs84
                    .convert((world[0], world[1]))
                    .map_err(|e| e.to_string())?;
                Ok(Some([lon, lat]))
            } else {
                Ok(None)
            }
        }
        "local_m" => {
            let ref_path = state
                .reference_path
                .lock()
                .map_err(|e| e.to_string())?
                .clone()
                .ok_or_else(|| "reference path not set".to_string())?;
            let (w, h) = io::image_dimensions(&ref_path).map_err(|e| e.to_string())?;
            let center = [(w as f64) / 2.0, (h as f64) / 2.0];
            match io::pixel_to_local_meters(&geo, [px, py], center) {
                Ok(Some(m)) => Ok(Some(m)),
                _ => Ok(None),
            }
        }
        "utm" | "projected_m" => {
            if let Some(wkt) = &geo.wkt {
                let world = io::pixel_to_world(&geo, [px, py]);
                let to_wgs84 =
                    proj::Proj::new_known_crs(wkt, "EPSG:4326", None).map_err(|e| e.to_string())?;
                let (lon, lat) = to_wgs84
                    .convert((world[0], world[1]))
                    .map_err(|e| e.to_string())?;
                let zone = (((lon + 180.0) / 6.0).floor() as i32).clamp(1, 60);
                match policy {
                    "NAD83_2011" => {
                        let to_utm = proj::Proj::new(&format!(
                            "+proj=utm +zone={} +ellps=GRS80 +units=m +no_defs +type=crs",
                            zone
                        ))
                        .map_err(|e| e.to_string())?;
                        let (x, y) = to_utm.convert((lon, lat)).map_err(|e| e.to_string())?;
                        Ok(Some([x, y]))
                    }
                    _ => {
                        // WGS84
                        let north = lat >= 0.0;
                        let epsg = if north {
                            format!("EPSG:326{}", zone)
                        } else {
                            format!("EPSG:327{}", zone)
                        };
                        let to_utm = proj::Proj::new_known_crs("EPSG:4326", &epsg, None)
                            .map_err(|e| e.to_string())?;
                        let (x, y) = to_utm.convert((lon, lat)).map_err(|e| e.to_string())?;
                        Ok(Some([x, y]))
                    }
                }
            } else {
                Ok(None)
            }
        }
        "pixel" => Ok(Some([px, py])),
        _ => Ok(None),
    }
}

#[derive(serde::Serialize)]
struct CrsInfo {
    name: String,
    code: Option<String>,
    proj: Option<String>,
    wkt: Option<String>,
}

#[tauri::command]
fn get_reference_crs(state: State<AppState>) -> Result<Option<CrsInfo>, String> {
    let g = match state.ref_georef.lock().map_err(|e| e.to_string())?.clone() {
        Some(v) => v,
        None => return Ok(None),
    };
    let name = g
        .wkt
        .as_ref()
        .and_then(|w| w.splitn(2, '[').next())
        .unwrap_or("Unknown")
        .to_string();
    Ok(Some(CrsInfo {
        name,
        code: None,
        proj: None,
        wkt: g.wkt,
    }))
}

#[derive(serde::Serialize)]
struct EpsgSuggestion {
    epsg: Option<String>,
    proj: String,
    name: String,
    datum: String,
    zone: Option<i32>,
    notice: Option<String>,
}

#[tauri::command]
fn suggest_output_epsg(
    policy: String,
    state: State<AppState>,
) -> Result<Option<EpsgSuggestion>, String> {
    let geo = match state.ref_georef.lock().map_err(|e| e.to_string())?.clone() {
        Some(v) => v,
        None => return Ok(None),
    };
    let ref_path = match state
        .reference_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
    {
        Some(p) => p,
        None => return Ok(None),
    };
    let (w, h) = io::image_dimensions(&ref_path).map_err(|e| e.to_string())?;
    if let Some(wkt) = &geo.wkt {
        let world = io::pixel_to_world(&geo, [(w as f64) / 2.0, (h as f64) / 2.0]);
        let to_wgs84 =
            proj::Proj::new_known_crs(wkt, "EPSG:4326", None).map_err(|e| e.to_string())?;
        let (lon, lat) = to_wgs84
            .convert((world[0], world[1]))
            .map_err(|e| e.to_string())?;
        let zone = (((lon + 180.0) / 6.0).floor() as i32).clamp(1, 60);
        match policy.as_str() {
            "NAD83_2011" => {
                let proj_str = format!(
                    "+proj=utm +zone={} +ellps=GRS80 +units=m +no_defs +type=crs",
                    zone
                );
                let name = format!("NAD83(2011) / UTM zone {}N", zone);
                Ok(Some(EpsgSuggestion {
                    epsg: None,
                    proj: proj_str,
                    name,
                    datum: "NAD83(2011)".into(),
                    zone: Some(zone),
                    notice: Some("Using NAD83(2011) UTM (no EPSG on this system)".into()),
                }))
            }
            _ => {
                let north = lat >= 0.0;
                let epsg = if north {
                    format!("EPSG:326{}", zone)
                } else {
                    format!("EPSG:327{}", zone)
                };
                let proj_str = format!(
                    "+proj=utm +zone={} +datum=WGS84 +units=m +no_defs +type=crs",
                    zone
                );
                let name = format!("WGS84 / UTM zone {}{}", zone, if north { "N" } else { "S" });
                Ok(Some(EpsgSuggestion {
                    epsg: Some(epsg),
                    proj: proj_str,
                    name,
                    datum: "WGS84".into(),
                    zone: Some(zone),
                    notice: None,
                }))
            }
        }
    } else {
        Ok(None)
    }
}

#[derive(serde::Serialize)]
struct XY {
    x: f64,
    y: f64,
}

#[tauri::command]
fn pixel_to(mode: String, u: f64, v: f64, state: State<AppState>) -> Result<Option<XY>, String> {
    let r = _convert_reference_pixel(u, v, &mode, "WGS84", &state)?;
    Ok(r.map(|a| XY { x: a[0], y: a[1] }))
}

#[tauri::command]
fn pixel_to_projected(
    policy: String,
    u: f64,
    v: f64,
    state: State<AppState>,
) -> Result<Option<XY>, String> {
    let r = _convert_reference_pixel(u, v, "projected_m", &policy, &state)?;
    Ok(r.map(|a| XY { x: a[0], y: a[1] }))
}

#[derive(serde::Serialize)]
struct Mpp {
    mpp: f64,
}

#[tauri::command]
fn metric_scale_at(u: f64, v: f64, state: State<AppState>) -> Result<Option<Mpp>, String> {
    let geo = match state.ref_georef.lock().map_err(|e| e.to_string())?.clone() {
        Some(v) => v,
        None => return Ok(None),
    };
    if let (Ok(Some(l0)), Ok(Some(l1)), Ok(Some(l2))) = (
        io::pixel_to_local_meters(&geo, [u, v], [u, v]),
        io::pixel_to_local_meters(&geo, [u + 1.0, v], [u, v]),
        io::pixel_to_local_meters(&geo, [u, v + 1.0], [u, v]),
    ) {
        let du = ((l1[0] - l0[0]).powi(2) + (l1[1] - l0[1]).powi(2)).sqrt();
        let dv = ((l2[0] - l0[0]).powi(2) + (l2[1] - l0[1]).powi(2)).sqrt();
        let mpp = 0.5 * (du + dv);
        return Ok(Some(Mpp { mpp }));
    }
    Ok(None)
}
