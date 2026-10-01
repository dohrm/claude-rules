# ADR-0004 : tools/core source unique, MCP optionnel

**Statut :** Accepté  
**Date :** 2026-06-23  
**Tickets :** MIG-203, MIG-602

## Contexte

La logique métier vit dans `quill-tools-core`. Le serveur MCP (`crates/mcp`) et le futur agent (`crates/agent`) risquent de dupliquer les appels ou la logique.

## Décision

- **Toute** mutation campagne passe par `quill-tools-core` (fonctions existantes : `notes::add_note`, `entity::add::entity_add`, etc.).
- **MCP** : wrappers `rmcp` minces → appellent `tools/core`.
- **Agent** : `QuillToolRegistry` → même fonctions, signatures adaptées pour Rig tools.
- **Desktop Tauri** : commandes → `tools/core` (lecture déjà ; écriture Phase 4).

Aucune logique métier dans :
- `templates/claude/`
- `channel-server/`
- handlers Tauri (sauf validation path / DTO)

## Conséquences

- Parité MCP / agent / Tauri testable via tests `tools/core`.
- MIG-602 : checklist de parité outils MCP vs agent.

## Anti-patterns interdits

- Nouveau tool uniquement dans MCP sans `tools/core`.
- Prompt Claude qui écrit des fichiers sans passer par un tool.
