#![allow(dead_code)]

#[derive(Debug)]
pub struct TpsTransform {
    // Placeholder
    pub coefficients: Vec<f64>,
}

impl TpsTransform {
    pub fn new() -> Self {
        Self { coefficients: vec![] }
    }
}

impl Default for TpsTransform {
    fn default() -> Self {
        Self::new()
    }
}
