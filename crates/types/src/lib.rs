use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ConstraintKind {
    Point { id: u64, point: [f64; 2], weight: f64 },
    Polyline { id: u64, points: Vec<[f64; 2]>, weight: f64 },
    Polygon { id: u64, points: Vec<[f64; 2]>, weight: f64 },
    AnisotropicPin { id: u64, point: [f64; 2], sigma_major: f64, sigma_minor: f64, angle: f64 },
    Anchor { id: u64, point: [f64; 2] },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum TransformKind {
    Similarity(Similarity),
    Affine(Affine),
    Homography(Homography),
    Tps(Tps),
    Ffd(Ffd),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransformStack {
    pub transforms: Vec<TransformKind>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QualityMetrics {
    pub rmse: f64,
    pub p90_error: f64,
    pub residuals: Vec<f64>,
}

// Placeholder structs for transform kinds
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Similarity { pub params: [f64; 4] } // s, r, tx, ty
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Affine { pub params: [f64; 6] }
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Homography { pub params: [f64; 9] }
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tps { pub control_points: Vec<[f64; 2]>, pub lambda: f64 }
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Ffd { pub control_points: Vec<[f64; 2]>, pub grid_size: [usize; 2] }
