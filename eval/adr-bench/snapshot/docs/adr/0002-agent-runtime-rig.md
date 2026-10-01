# ADR-0002 : Agent intégré via Rig

**Statut :** Remplacé par [ADR-0015](0015-llm-client-rust-genai.md)  
**Date :** 2026-06-23  
**Tickets :** MIG-201, MIG-213

> **Remplacé (ADR-0015, 2026-07-24)** — Rig est abandonné au profit de `rust-genai` (agnosticité providers/outils, prompt caching). Le principe « agent intégré in-process, un seul binaire desktop, MCP optionnel » de cet ADR **reste vrai** ; seul le framework LLM change.

## Contexte

Quill dépend aujourd'hui de Claude Code (MCP + channel-server expérimental) pour l'intelligence à table. Motivations du pivot :

1. **Indépendance** d'un second CLI.
2. **Maîtrise des coûts** — modèles locaux ou API au choix.
3. **Fournisseurs interchangeables** — OpenAI, Gemini, Ollama, etc. via config.

Le crate `quill-llm` existe mais n'est branché à aucun outil métier ; c'est une couche technique morte.

## Décision

- Introduire **`crates/agent`** basé sur [Rig](https://github.com/0xplaygrounds/rig) pour le tool loop, le streaming et les providers.
- **Supprimer `crates/llm`** une fois l'agent minimal opérationnel (MIG-213).
- Le **desktop** appelle l'agent **in-process** via Tauri (`agent_chat`), pas via WebSocket vers Claude.
- **`quill mcp`** reste pour les power-users qui veulent Cursor / Claude Code en externe.

## Conséquences

### Positives

- Un seul binaire desktop = expérience table complète.
- Config centralisée `~/.config/quill/config.yaml`.

### Négatives

- Dépendance à Rig (breaking changes annoncés par le projet — pin de version).
- Maintenance du runtime agent (streaming, erreurs, annulation).

### Neutres

- `templates/claude/` devient optionnel (Phase 6), pas supprimé immédiatement.

## Non-décision

- Choix du modèle par défaut (Gemma local vs API) : **config utilisateur**, pas ADR.
