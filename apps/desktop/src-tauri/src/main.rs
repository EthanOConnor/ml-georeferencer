#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::State;
use types::{ConstraintKind, QualityMetrics, TransformKind, TransformStack};

#[derive(Default)]
struct AppState {
    map_path: Mutex<Option<String>>,
    reference_path: Mutex<Option<String>>,
    constraints: Mutex<Vec<ConstraintKind>>,
}

#[tauri::command]
fn set_map_path(path: String, state: State<AppState>) -> Result<(), String> {
    *state.map_path.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(())
}

#[tauri::command]
fn set_reference_path(path: String, state: State<AppState>) -> Result<(), String> {
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
fn add_constraint(c: ConstraintKind, state: State<AppState>) -> Result<Vec<ConstraintKind>, String> {
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
fn solve_global(method: String, state: State<AppState>) -> Result<(TransformStack, QualityMetrics), String> {
    let list = state.constraints.lock().map_err(|e| e.to_string())?;
    let pairs = solver::pairs_from_constraints(&list);
    if pairs.len() < 2 && method == "similarity" {
        return Err(format!("need ≥2 pairs; got {}", pairs.len()));
    }
    if pairs.len() < 3 && method == "affine" {
        return Err(format!("need ≥3 pairs; got {}", pairs.len()));
    }
    match method.as_str() {
        "similarity" => {
            let t = solver::fit_similarity_from_pairs(&pairs).map_err(|e| e.to_string())?;
            let (rmse, p90, residuals) = metrics_similarity(&t, &pairs);
            Ok((
                TransformStack { transforms: vec![TransformKind::Similarity(t)] },
                QualityMetrics { rmse, p90_error: p90, residuals },
            ))
        }
        "affine" => {
            let t = solver::fit_affine_from_pairs(&pairs).map_err(|e| e.to_string())?;
            let (rmse, p90, residuals) = metrics_affine(&t, &pairs);
            Ok((
                TransformStack { transforms: vec![TransformKind::Affine(t)] },
                QualityMetrics { rmse, p90_error: p90, residuals },
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
            export_world_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
