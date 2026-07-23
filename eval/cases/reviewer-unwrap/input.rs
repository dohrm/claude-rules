//! Configuration parsing for the server bootstrap.

/// Parse the listen port from a raw env string.
pub fn parse_port(raw: &str) -> u16 {
    // Planted defect: `unwrap()` in production code — panics on malformed
    // input instead of propagating a Result. Forbidden outside tests.
    raw.parse::<u16>().unwrap()
}

/// Parse an optional worker count, defaulting to 4.
pub fn worker_count(raw: Option<&str>) -> usize {
    // Planted defect: `expect` with no error handling on user-controlled input.
    raw.map(|s| s.parse::<usize>().expect("worker count must be a number"))
        .unwrap_or(4)
}
