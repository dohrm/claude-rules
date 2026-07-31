// Fixture for the code-simplifier: behavior is correct, the shape is not.
// Planted, unambiguous simplifications:
//   1. a needless `.clone()` of the Option<String> just to match on it,
//   2. `else` after a `return`,
//   3. a nested `if` inside a match arm that a guard expresses directly.
// The signature and the behavior must survive untouched.

pub struct Item {
    pub id: String,
    pub label: Option<String>,
}

pub fn resolve_label(item: &Item, fallback: &str) -> String {
    let label = item.label.clone();
    match label {
        Some(l) => {
            if l.is_empty() {
                return fallback.to_string();
            } else {
                return l;
            }
        }
        None => {
            return fallback.to_string();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(label: Option<&str>) -> Item {
        Item { id: "i-1".to_string(), label: label.map(|s| s.to_string()) }
    }

    #[test]
    fn returns_the_label_when_present() {
        assert_eq!(resolve_label(&item(Some("Invoice")), "n/a"), "Invoice");
    }

    #[test]
    fn falls_back_on_an_empty_label() {
        assert_eq!(resolve_label(&item(Some("")), "n/a"), "n/a");
    }

    #[test]
    fn falls_back_when_absent() {
        assert_eq!(resolve_label(&item(None), "n/a"), "n/a");
    }
}
