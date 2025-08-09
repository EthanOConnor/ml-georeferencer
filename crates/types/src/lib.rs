use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ConstraintKind {
    Point {
        id: u64,
        point: [f64; 2],
        weight: f64,
    },
    PointPair {
        id: u64,
        src: [f64; 2],
        dst: [f64; 2],
        /// Real-world coordinates derived from the reference georeferencing (CRS units)
        dst_real: Option<[f64; 2]>,
        /// Local meter-plane coordinates relative to the reference origin
        dst_local: Option<[f64; 2]>,
        weight: f64,
    },
    Polyline {
        id: u64,
        points: Vec<[f64; 2]>,
        weight: f64,
    },
    Polygon {
        id: u64,
        points: Vec<[f64; 2]>,
        weight: f64,
    },
    AnisotropicPin {
        id: u64,
        point: [f64; 2],
        sigma_major: f64,
        sigma_minor: f64,
        angle: f64,
    },
    Anchor {
        id: u64,
        point: [f64; 2],
    },
}

/// Units for reporting positional error metrics
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum ErrorUnit {
    Pixels,
    Meters,
    MapMillimeters,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum TransformKind {
    Similarity(Similarity),
    Affine(Affine),
    Homography(Homography),
    Tps(Tps),
    Ffd(Ffd),
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TransformStack {
    pub transforms: Vec<TransformKind>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QualityMetrics {
    pub rmse: f64,
    pub p90_error: f64,
    pub residuals: Vec<f64>,
    pub residuals_by_id: Vec<(u64, f64)>,
    pub warnings: Vec<String>,
    /// Units used for error reporting
    pub unit: ErrorUnit,
    /// Optional map scale denominator (e.g. 10000 for 1:10000)
    pub map_scale: Option<f64>,
}
impl Default for QualityMetrics {
    fn default() -> Self {
        Self {
            rmse: 0.0,
            p90_error: 0.0,
            residuals: Vec::new(),
            residuals_by_id: Vec::new(),
            warnings: Vec::new(),
            unit: ErrorUnit::Pixels,
            map_scale: None,
        }
    }
}

// Placeholder structs for transform kinds
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Similarity {
    pub params: [f64; 4],
} // s, r, tx, ty
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Affine {
    pub params: [f64; 6],
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Homography {
    pub params: [f64; 9],
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tps {
    pub control_points: Vec<[f64; 2]>,
    pub lambda: f64,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Ffd {
    pub control_points: Vec<[f64; 2]>,
    pub grid_size: [usize; 2],
}

impl ConstraintKind {
    pub fn id(&self) -> u64 {
        match self {
            ConstraintKind::Point { id, .. }
            | ConstraintKind::PointPair { id, .. }
            | ConstraintKind::Polyline { id, .. }
            | ConstraintKind::Polygon { id, .. }
            | ConstraintKind::AnisotropicPin { id, .. }
            | ConstraintKind::Anchor { id, .. } => *id,
        }
    }
}

impl QualityMetrics {
    /// Convert metrics to the requested unit. `pixel_size` is the ground
    /// distance represented by a single reference pixel in meters. When
    /// converting to or from `MapMillimeters`, `map_scale` must be provided
    /// (denominator, e.g. 10000 for 1:10000).
    pub fn convert_units(&mut self, pixel_size: f64, map_scale: Option<f64>, target: ErrorUnit) {
        let mut factor = 1.0;
        match (self.unit, target) {
            (ErrorUnit::Pixels, ErrorUnit::Meters) => factor = pixel_size,
            (ErrorUnit::Meters, ErrorUnit::Pixels) => factor = 1.0 / pixel_size,
            (ErrorUnit::Pixels, ErrorUnit::MapMillimeters) => {
                if let Some(s) = map_scale {
                    factor = pixel_size * (1000.0 / s);
                }
            }
            (ErrorUnit::MapMillimeters, ErrorUnit::Pixels) => {
                if let Some(s) = map_scale {
                    factor = (s / 1000.0) / pixel_size;
                }
            }
            (ErrorUnit::Meters, ErrorUnit::MapMillimeters) => {
                if let Some(s) = map_scale {
                    factor = 1000.0 / s;
                }
            }
            (ErrorUnit::MapMillimeters, ErrorUnit::Meters) => {
                if let Some(s) = map_scale {
                    factor = s / 1000.0;
                }
            }
            _ => {}
        }
        self.rmse *= factor;
        self.p90_error *= factor;
        for r in &mut self.residuals {
            *r *= factor;
        }
        for (_, r) in &mut self.residuals_by_id {
            *r *= factor;
        }
        self.unit = target;
        if target == ErrorUnit::MapMillimeters {
            self.map_scale = map_scale;
        }
    }
}
