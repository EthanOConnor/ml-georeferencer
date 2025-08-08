use anyhow::{anyhow, Result};
use nalgebra::{Matrix2, SVD, Vector2};
use rand::seq::SliceRandom;
use types::{Affine, ConstraintKind, Similarity};

pub trait Transform {
    fn apply(&self, point: &Vector2<f64>) -> Vector2<f64>;
}

impl Transform for Similarity {
    fn apply(&self, point: &Vector2<f64>) -> Vector2<f64> {
        let s = self.params[0];
        let theta = self.params[1];
        let tx = self.params[2];
        let ty = self.params[3];
        let rotation = Matrix2::new(theta.cos(), -theta.sin(), theta.sin(), theta.cos());
        s * rotation * point + Vector2::new(tx, ty)
    }
}

impl Transform for Affine {
    fn apply(&self, point: &Vector2<f64>) -> Vector2<f64> {
        let a = self.params[0];
        let b = self.params[1];
        let c = self.params[2];
        let d = self.params[3];
        let tx = self.params[4];
        let ty = self.params[5];
        let linear_map = Matrix2::new(a, b, c, d);
        linear_map * point + Vector2::new(tx, ty)
    }
}

pub fn fit_similarity_from_pairs(pairs: &[([f64; 2], [f64; 2])]) -> Result<Similarity> {
    let n = pairs.len();
    if n < 2 {
        return Err(anyhow!("At least 2 pairs are required (got {})", n));
    }

    let (src_points, dst_points): (Vec<_>, Vec<_>) = pairs
        .iter()
        .map(|(s, d)| (Vector2::from(*s), Vector2::from(*d)))
        .unzip();
    let src_centroid: Vector2<f64> = src_points.iter().sum::<Vector2<f64>>() / (n as f64);
    let dst_centroid: Vector2<f64> = dst_points.iter().sum::<Vector2<f64>>() / (n as f64);

    let centered_src: Vec<_> = src_points.iter().map(|p| p - src_centroid).collect();
    let centered_dst: Vec<_> = dst_points.iter().map(|p| p - dst_centroid).collect();

    let sum_centered_src_sq_norm: f64 = centered_src.iter().map(|p| p.norm_squared()).sum();
    if !sum_centered_src_sq_norm.is_finite() || sum_centered_src_sq_norm <= f64::EPSILON {
        return Err(anyhow!("Insufficient variance in source points"));
    }

    let mut c = Matrix2::zeros();
    for i in 0..n {
        c += centered_dst[i] * centered_src[i].transpose();
    }

    let svd = SVD::new(c, true, true);
    let u = svd.u.ok_or_else(|| anyhow!("SVD U matrix not found"))?;
    let v_t = svd.v_t.ok_or_else(|| anyhow!("SVD V_t matrix not found"))?;

    let mut r = u * v_t;
    if r.determinant() < 0.0 {
        let mut u_clone = u.clone_owned();
        u_clone.column_mut(1).scale_mut(-1.0);
        r = u_clone * v_t;
    }

    let s = (c.transpose() * r).trace() / sum_centered_src_sq_norm;
    let t = dst_centroid - s * r * src_centroid;
    let theta = r.m21.atan2(r.m11);
    Ok(Similarity { params: [s, theta, t[0], t[1]] })
}

pub fn fit_affine_from_pairs(pairs: &[([f64; 2], [f64; 2])]) -> Result<Affine> {
    let n = pairs.len();
    if n < 3 {
        return Err(anyhow!("At least 3 pairs are required to fit an affine transform."));
    }
    let mut a = nalgebra::DMatrix::<f64>::zeros(2 * n, 6);
    let mut b = nalgebra::DVector::<f64>::zeros(2 * n);
    for i in 0..n {
        let src = pairs[i].0;
        let dst = pairs[i].1;
        a[(2 * i, 0)] = src[0];
        a[(2 * i, 1)] = src[1];
        a[(2 * i, 4)] = 1.0;
        a[(2 * i + 1, 2)] = src[0];
        a[(2 * i + 1, 3)] = src[1];
        a[(2 * i + 1, 5)] = 1.0;
        b[2 * i] = dst[0];
        b[2 * i + 1] = dst[1];
    }
    let decomp = a.svd(true, true);
    let x = decomp.solve(&b, 1e-6).map_err(|e| anyhow!(e.to_string()))?;
    Ok(Affine { params: [x[0], x[1], x[2], x[3], x[4], x[5]] })
}

pub fn ransac_fit_similarity(
    pairs: &[([f64; 2], [f64; 2])],
    threshold_px: f64,
    max_iters: usize,
) -> Result<Similarity> {
    if pairs.len() < 2 {
        return Err(anyhow!("RANSAC needs ≥2 pairs; got {}", pairs.len()));
    }
    if !threshold_px.is_finite() || threshold_px <= 0.0 {
        return Err(anyhow!("RANSAC threshold must be positive and finite"));
    }
    let mut best_inliers = 0usize;
    let mut best_transform = Similarity { params: [1.0, 0.0, 0.0, 0.0] };
    for _ in 0..max_iters {
        let sample: Vec<_> = pairs
            .choose_multiple(&mut rand::thread_rng(), 2)
            .cloned()
            .collect();
        if sample.len() < 2 { continue; }
        if let Ok(transform) = fit_similarity_from_pairs(&sample) {
            let mut inliers = 0;
            for (src, dst) in pairs {
                let src_vec = Vector2::from(*src);
                let dst_vec = Vector2::from(*dst);
                let predicted_dst = transform.apply(&src_vec);
                if (predicted_dst - dst_vec).norm() < threshold_px {
                    inliers += 1;
                }
            }
            if inliers > best_inliers {
                best_inliers = inliers;
                let all_inliers: Vec<_> = pairs
                    .iter()
                    .filter(|(src, dst)| {
                        let src_vec = Vector2::from(*src);
                        let dst_vec = Vector2::from(*dst);
                        let predicted_dst = transform.apply(&src_vec);
                        (predicted_dst - dst_vec).norm() < threshold_px
                    })
                    .cloned()
                    .collect();
                if let Ok(refit_transform) = fit_similarity_from_pairs(&all_inliers) {
                    best_transform = refit_transform;
                }
            }
        }
    }
    if best_inliers == 0 { return Err(anyhow!("RANSAC failed to find a model")); }
    Ok(best_transform)
}

pub fn pairs_from_constraints(constraints: &[ConstraintKind]) -> Vec<([f64; 2], [f64; 2])> {
    constraints
        .iter()
        .filter_map(|c| match c {
            ConstraintKind::PointPair { src, dst, .. } => Some((*src, *dst)),
            _ => None,
        })
        .collect()
}

/// Invert a similarity transform.
pub fn invert_similarity(t: &Similarity) -> Similarity {
    let s = t.params[0];
    let theta = t.params[1];
    let tx = t.params[2];
    let ty = t.params[3];
    let inv_s = 1.0 / s;
    let inv_theta = -theta;
    let c = inv_theta.cos();
    let si = inv_theta.sin();
    let inv_tx = -inv_s * (c * tx - si * ty);
    let inv_ty = -inv_s * (si * tx + c * ty);
    Similarity { params: [inv_s, inv_theta, inv_tx, inv_ty] }
}

/// Compose two similarity transforms (a followed by b).
pub fn compose_similarity(a: &Similarity, b: &Similarity) -> Similarity {
    let (sa, ta, txa, tya) = (a.params[0], a.params[1], a.params[2], a.params[3]);
    let (sb, tb, txb, tyb) = (b.params[0], b.params[1], b.params[2], b.params[3]);
    let ca = ta.cos();
    let sa_sin = ta.sin();
    let s = sa * sb;
    let theta = ta + tb;
    let tx = sa * (ca * txb - sa_sin * tyb) + txa;
    let ty = sa * (sa_sin * txb + ca * tyb) + tya;
    Similarity { params: [s, theta, tx, ty] }
}

/// Convert similarity to a PROJ pipeline string.
pub fn similarity_to_proj(t: &Similarity) -> String {
    let s = t.params[0];
    let th = t.params[1];
    let (c, si) = (th.cos(), th.sin());
    let a = s * c;
    let b = -s * si;
    let d = s * si;
    let e = s * c;
    let tx = t.params[2];
    let ty = t.params[3];
    format!("+proj=pipeline +step +proj=affine +s11={a} +s12={b} +s21={d} +s22={e} +xoff={tx} +yoff={ty}")
}

/// Invert an affine transform. Returns None if not invertible.
pub fn invert_affine(t: &Affine) -> Option<Affine> {
    let [a, b, c, d, tx, ty] = t.params;
    let det = a * d - b * c;
    if det.abs() < f64::EPSILON {
        return None;
    }
    let inv_a = d / det;
    let inv_b = -b / det;
    let inv_c = -c / det;
    let inv_d = a / det;
    let inv_tx = -(inv_a * tx + inv_b * ty);
    let inv_ty = -(inv_c * tx + inv_d * ty);
    Some(Affine { params: [inv_a, inv_b, inv_c, inv_d, inv_tx, inv_ty] })
}

/// Compose two affine transforms (a followed by b).
pub fn compose_affine(a: &Affine, b: &Affine) -> Affine {
    let [a1, b1, c1, d1, tx1, ty1] = a.params;
    let [a2, b2, c2, d2, tx2, ty2] = b.params;
    let a_ = a2 * a1 + b2 * c1;
    let b_ = a2 * b1 + b2 * d1;
    let c_ = c2 * a1 + d2 * c1;
    let d_ = c2 * b1 + d2 * d1;
    let tx_ = a2 * tx1 + b2 * ty1 + tx2;
    let ty_ = c2 * tx1 + d2 * ty1 + ty2;
    Affine { params: [a_, b_, c_, d_, tx_, ty_] }
}

/// Convert an affine transform to a PROJ pipeline string.
pub fn affine_to_proj(t: &Affine) -> String {
    let [a, b, c, d, tx, ty] = t.params;
    format!("+proj=pipeline +step +proj=affine +s11={a} +s12={b} +s21={c} +s22={d} +xoff={tx} +yoff={ty}")
}
