use solver::pairs_from_constraints;
use types::ConstraintKind;

#[test]
fn test_pairs_extraction_filters_bad() {
    let v = vec![
        // valid
        ConstraintKind::PointPair {
            id: 1,
            src: [0.0, 0.0],
            dst: [10.0, 0.0],
            dst_real: None,
            dst_local: None,
            weight: 1.0,
        },
        // duplicate
        ConstraintKind::PointPair {
            id: 2,
            src: [0.0, 0.0],
            dst: [10.0, 0.0],
            dst_real: None,
            dst_local: None,
            weight: 1.0,
        },
        // degenerate (src == dst)
        ConstraintKind::PointPair {
            id: 3,
            src: [5.0, 5.0],
            dst: [5.0, 5.0],
            dst_real: None,
            dst_local: None,
            weight: 1.0,
        },
        // NaN
        ConstraintKind::PointPair {
            id: 4,
            src: [f64::NAN, 1.0],
            dst: [2.0, 3.0],
            dst_real: None,
            dst_local: None,
            weight: 1.0,
        },
    ];

    let pairs = pairs_from_constraints(&v);
    assert_eq!(pairs.len(), 1);
    assert_eq!(pairs[0].0, [0.0, 0.0]);
    assert_eq!(pairs[0].1, [10.0, 0.0]);
}
