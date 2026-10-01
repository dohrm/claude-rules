# ADR-0008 : Fin du channel-server comme runtime principal

**Statut :** Accepté  
**Date :** 2026-06-23  
**Tickets :** MIG-104, MIG-105, MIG-208, MIG-212

## Contexte

Le Play mode desktop utilise `channel-server` (Bun) + API expérimentale `notifications/claude/channel` de Claude Code. Non portable, second processus, dépendance forte.

## Décision

1. **Phase 1** : découpler l'UI du WebSocket channel (MIG-104).
2. **Phase 2** : remplacer par `agent_chat` Tauri in-process (MIG-208).
3. **Phase 2 fin** : supprimer `crates/desktop/channel-server/` (MIG-212).

Le store `useChatStore` WebSocket est remplacé par un store basé sur `AgentEvent` + invoke Tauri.

## Conséquences

- Plus besoin de Bun en runtime desktop pour le play mode.
- `PlayPage` ne mentionne plus « Claude » comme interlocuteur obligatoire (libellés neutres : « Assistant »).

## Ce qui reste

- MCP + `claude-setup` pour qui veut Claude Code **en parallèle** (ADR-0004), pas comme runtime Play.
