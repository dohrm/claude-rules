# Extract from Quill `AGENTS.md`

- L12: Règles : ADR du ticket avant code ; Rig uniquement dans `crates/agent` ; logique métier dans `tools/core`.
- L16: Rust cargo workspace (edition 2024, resolver 3). MCP server over stdio using `rmcp 0.15` (optionnel). Desktop + agent Rig (`crates/agent`, en cours). Campaign state lives as markdown + YAML on the filesystem — no database.
- L23: | `agent` | Agent runtime Rig — **seul crate Rig** (MIG-201+) |
