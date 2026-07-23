//! Label helpers for display. French text (é, è, ç, à…) flows through here.

/// Return the first 5 characters of a label for a compact display.
pub fn short_label(label: &str) -> String {
    // Planted defect: byte slicing a &str — splits multi-byte UTF-8 chars
    // (a French accent is 2 bytes) and panics on a non-char-boundary index.
    label[..5].to_string()
}

/// Read the leading character of a raw token.
pub fn leading_char(token: &str) -> char {
    // Planted defect: casting a byte to char is wrong for multi-byte UTF-8.
    token.as_bytes()[0] as char
}
