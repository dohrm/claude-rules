/// Trivial on purpose: the crate is the subject of the gate, not the other way around.
pub fn add_one(n: i32) -> i32 {
    n + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn increments() {
        assert_eq!(add_one(1), 2);
    }

    #[test]
    fn tests_may_unwrap() {
        let n: i32 = "1".parse().unwrap();
        assert_eq!(add_one(n), 2);
    }
}
