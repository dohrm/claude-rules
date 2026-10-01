# Extract from Quill `CLAUDE.md`

- L12: Règles agents de code : lire les ADR du ticket, ne pas importer **genai** hors de `crates/agent/src/backend` (ADR-0015, successeur de la règle Rig), toute logique métier dans `tools/core`.
- L16: Rust cargo workspace (edition 2024, resolver 3). MCP server over stdio using `rmcp 0.15` (optionnel). Desktop Tauri + agent intégré (client LLM `genai` + tool-loop maison, `crates/agent`, ADR-0015). Campaign state lives as markdown + YAML on the filesystem — no database.
- L23: | `agent` | Agent runtime : client LLM `genai`, `ModelBackend` fin, tool-loop maison — **seul crate autorisé à dépendre de `genai` ; `genai::` confiné à `src/backend/`** (ADR-0015) |
