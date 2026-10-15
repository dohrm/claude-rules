//! Small, deliberately clean module — a well-written change the reviewer
//! should pass without inventing problems (guards against false positives).

/// Sum the even numbers in a slice.
pub fn sum_even(xs: &[i64]) -> i64 {
    xs.iter().copied().filter(|n| n % 2 == 0).sum()
}

#[cfg(test)]
mod tests;
