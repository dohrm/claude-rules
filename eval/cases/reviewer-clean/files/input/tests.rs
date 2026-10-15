use super::*;

#[test]
fn negative_numbers_keep_their_parity() {
    assert!(is_even(-4));
    assert!(!is_even(-3));
}
