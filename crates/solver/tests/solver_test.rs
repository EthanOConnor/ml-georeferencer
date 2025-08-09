#[cfg(test)]
mod tests {
    use approx::assert_relative_eq;
    use nalgebra::Vector2;
    use solver::{
        affine_to_proj, compose_similarity, fit_affine_from_pairs, fit_similarity_from_pairs,
        invert_similarity, ransac_fit_similarity, Transform,
    };
    use types::{Affine, Similarity};

    #[test]
    fn test_similarity_apply() {
        let t = Similarity {
            params: [2.0, 0.0, 1.0, 2.0],
        };
        let p = Vector2::new(1.0, 1.0);
        let p2 = t.apply(&p);
        assert_relative_eq!(p2.x, 3.0, epsilon = 1e-6);
        assert_relative_eq!(p2.y, 4.0, epsilon = 1e-6);
    }

    #[test]
    fn test_fit_similarity_from_pairs_identity() {
        let pairs = [
            ([0.0, 0.0], [0.0, 0.0]),
            ([1.0, 0.0], [1.0, 0.0]),
            ([0.0, 1.0], [0.0, 1.0]),
        ];
        let t = fit_similarity_from_pairs(&pairs).unwrap();
        assert_relative_eq!(t.params[0], 1.0, epsilon = 1e-6);
        assert_relative_eq!(t.params[1], 0.0, epsilon = 1e-6);
        assert_relative_eq!(t.params[2], 0.0, epsilon = 1e-6);
        assert_relative_eq!(t.params[3], 0.0, epsilon = 1e-6);
    }

    #[test]
    fn test_fit_affine_from_pairs() {
        // affine: x' = 1*x + 2*y + 5, y' = 3*x + 4*y + 6
        let pairs = [
            ([0.0, 0.0], [5.0, 6.0]),
            ([1.0, 0.0], [6.0, 9.0]),
            ([0.0, 1.0], [7.0, 10.0]),
        ];
        let t = fit_affine_from_pairs(&pairs).unwrap();
        assert_relative_eq!(t.params[0], 1.0, epsilon = 1e-6);
        assert_relative_eq!(t.params[1], 2.0, epsilon = 1e-6);
        assert_relative_eq!(t.params[2], 3.0, epsilon = 1e-6);
        assert_relative_eq!(t.params[3], 4.0, epsilon = 1e-6);
        assert_relative_eq!(t.params[4], 5.0, epsilon = 1e-6);
        assert_relative_eq!(t.params[5], 6.0, epsilon = 1e-6);
    }

    #[test]
    fn test_ransac_fit_similarity_recovers() {
        let true_t = Similarity {
            params: [1.5, 0.2, 5.0, -3.0],
        };
        let mut pairs = Vec::new();
        for i in 0..20 {
            let p = Vector2::new(i as f64, (i as f64) * 0.5);
            let q = true_t.apply(&p);
            pairs.push(([p.x, p.y], [q.x, q.y]));
        }
        // add outliers
        pairs.push(([100.0, 100.0], [-100.0, -100.0]));
        let t = ransac_fit_similarity(&pairs, 1.0, 100).unwrap();
        assert_relative_eq!(t.params[0], true_t.params[0], epsilon = 1e-2);
        assert_relative_eq!(t.params[1], true_t.params[1], epsilon = 1e-2);
        assert_relative_eq!(t.params[2], true_t.params[2], epsilon = 1e-2);
        assert_relative_eq!(t.params[3], true_t.params[3], epsilon = 1e-2);
    }

    #[test]
    fn test_similarity_invert_compose() {
        let t = Similarity {
            params: [1.2, 0.3, 4.0, -2.0],
        };
        let inv = invert_similarity(&t);
        let composed = compose_similarity(&t, &inv);
        // composed should be close to identity
        let p = Vector2::new(2.0, -1.0);
        let q = composed.apply(&p);
        assert_relative_eq!(q.x, p.x, epsilon = 1e-6);
        assert_relative_eq!(q.y, p.y, epsilon = 1e-6);
    }

    #[test]
    fn test_affine_to_proj() {
        let aff = Affine {
            params: [1.0, 0.0, 0.0, 1.0, 5.0, -2.0],
        };
        let proj = affine_to_proj(&aff);
        assert!(proj.contains("+proj=pipeline"));
        assert!(proj.contains("+xoff=5"));
        assert!(proj.contains("+yoff=-2"));
    }
}
