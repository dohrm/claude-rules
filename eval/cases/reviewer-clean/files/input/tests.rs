use super::*;

#[test]
fn sums_even_numbers() {
    assert_eq!(sum_even(&[1, 2, 3, 4]), 6);
    assert_eq!(sum_even(&[]), 0);
}

#[test]
fn negative_numbers_keep_their_parity() {
    assert!(is_even(-4));
    assert!(!is_even(-3));
}
