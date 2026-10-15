use fixture::input::sum_even;

#[test]
fn sums_even_numbers() {
    assert_eq!(sum_even(&[1, 2, 3, 4]), 6);
    assert_eq!(sum_even(&[]), 0);
}
