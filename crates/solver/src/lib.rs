use anyhow::{anyhow, Result};
use nalgebra::{Matrix2, Vector2, SVD};
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
    Ok(Similarity {
        params: [s, theta, t[0], t[1]],
    })
}

pub fn fit_affine_from_pairs(pairs: &[([f64; 2], [f64; 2])]) -> Result<Affine> {
    let n = pairs.len();
    if n < 3 {
        return Err(anyhow!(
            "At least 3 pairs are required to fit an affine transform."
        ));
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
    Ok(Affine {
        params: [x[0], x[1], x[2], x[3], x[4], x[5]],
    })
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
    let mut best_transform = Similarity {
        params: [1.0, 0.0, 0.0, 0.0],
    };
    for _ in 0..max_iters {
        let sample: Vec<_> = pairs
            .choose_multiple(&mut rand::thread_rng(), 2)
            .cloned()
            .collect();
        if sample.len() < 2 {
            continue;
        }
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
    if best_inliers == 0 {
        return Err(anyhow!("RANSAC failed to find a model"));
    }
    Ok(best_transform)
}

/// Extract point-pair constraints as (src, dst) pixel-space pairs.
/// G1 behavior: only PointPair constraints are considered. We drop any pairs
/// with NaNs/Infs, duplicates (exact equality on all four coordinates), and
/// degenerate pairs where src == dst within 1e-12 in L2 norm.
pub fn pairs_from_constraints(constraints: &[ConstraintKind]) -> Vec<([f64; 2], [f64; 2])> {
    let mut out: Vec<([f64; 2], [f64; 2])> = Vec::new();
    for c in constraints {
        if let ConstraintKind::PointPair { src, dst, .. } = c {
            let [sx, sy] = *src;
            let [dx, dy] = *dst;
            if !(sx.is_finite() && sy.is_finite() && dx.is_finite() && dy.is_finite()) {
                continue;
            }
            let dsq = (sx - dx) * (sx - dx) + (sy - dy) * (sy - dy);
            if dsq <= 1e-24 {
                // |src-dst| <= 1e-12
                continue;
            }
            let pair = (*src, *dst);
            // exact duplicate filter
            if out.iter().any(|p| p.0 == pair.0 && p.1 == pair.1) {
                continue;
            }
            out.push(pair);
        }
    }
    out
}

/// Return PROJ pipeline string for a similarity transform.
/// Mapping uses pixel centers at integer coordinates (no implicit 0.5 offset):
/// x = a*u + b*v + c; y = d*u + e*v + f
pub fn similarity_to_proj(sim: &Similarity) -> String {
    let s = sim.params[0];
    let th = sim.params[1];
    let tx = sim.params[2];
    let ty = sim.params[3];
    let c = th.cos();
    let si = th.sin();
    let a = s * c;
    let b = -s * si;
    let d = s * si;
    let e = s * c;
    format!(
        "+proj=pipeline +step +proj=affine +xoff={:.17} +yoff={:.17} +s11={:.17} +s12={:.17} +s21={:.17} +s22={:.17}",
        tx, ty, a, b, d, e
    )
}

/// Return PROJ pipeline string for an affine transform.
/// Affine params: [a,b,c,d,tx,ty] where
/// x = a*u + b*v + tx; y = c*u + d*v + ty
pub fn affine_to_proj(aff: &Affine) -> String {
    let a = aff.params[0];
    let b = aff.params[1];
    let c = aff.params[2];
    let d = aff.params[3];
    let tx = aff.params[4];
    let ty = aff.params[5];
    format!(
        "+proj=pipeline +step +proj=affine +xoff={:.17} +yoff={:.17} +s11={:.17} +s12={:.17} +s21={:.17} +s22={:.17}",
        tx, ty, a, b, c, d
    )
}

/// Return the inverse of a similarity transform.
pub fn invert_similarity(sim: &Similarity) -> Similarity {
    let s = sim.params[0];
    let th = sim.params[1];
    let tx = sim.params[2];
    let ty = sim.params[3];
    let c = th.cos();
    let si = th.sin();
    let r_t = Matrix2::new(c, si, -si, c); // R^T
    let inv_s = 1.0_f64 / s;
    let t = Vector2::new(tx, ty);
    let t_inv = -inv_s * (r_t * t);
    Similarity {
        params: [inv_s, -th, t_inv.x, t_inv.y],
    }
}

/// Compose two similarity transforms: result = b ∘ a
pub fn compose_similarity(a: &Similarity, b: &Similarity) -> Similarity {
    let s1 = a.params[0];
    let th1 = a.params[1];
    let t1 = Vector2::new(a.params[2], a.params[3]);
    let r1 = Matrix2::new(th1.cos(), -th1.sin(), th1.sin(), th1.cos());

    let s2 = b.params[0];
    let th2 = b.params[1];
    let t2 = Vector2::new(b.params[2], b.params[3]);
    let r2 = Matrix2::new(th2.cos(), -th2.sin(), th2.sin(), th2.cos());

    let s = s2 * s1;
    let r = r2 * r1;
    let t = s2 * (r2 * t1) + t2;

    // Recover angle from rotation matrix
    let theta = r[(1, 0)].atan2(r[(0, 0)]);
    Similarity {
        params: [s, theta, t.x, t.y],
    }
}
