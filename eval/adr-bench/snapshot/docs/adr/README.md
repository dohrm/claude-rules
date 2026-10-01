# Architecture Decision Records (ADR)

Décisions structurantes pour la migration Quill 2026. **En cas de conflit avec `docs/vision.md` ou le backlog legacy, les ADR priment.**

## Index

| ADR | Titre | Statut |
|-----|-------|--------|
| [0001](0001-local-first-campaign-tool.md) | Outil local individuel, pas de serveur partagé | Accepté (amendé par 0014) |
| [0002](0002-agent-runtime-rig.md) | Agent intégré via Rig, suppression quill-llm | Remplacé par 0015 |
| [0003](0003-model-backend-abstraction.md) | Abstraction ModelBackend sur providers Rig typés | Remplacé par 0015 |
| [0004](0004-tools-core-single-source.md) | tools/core unique, MCP adaptateur optionnel | Accepté |
| [0005](0005-gm-player-profiles.md) | Profils MJ/joueur : corpus et vérité, pas ACL serveur | Accepté |
| [0006](0006-phase-ordering.md) | Coque min → agent notes → synthèse avant portail complet | Accepté |
| [0007](0007-agentic-rag-v0-bm25.md) | RAG agentique v0 = tool loop sur BM25 Tantivy | Accepté |
| [0008](0008-deprecate-claude-channel.md) | Fin du channel-server et Claude comme runtime principal | Accepté |
| [0009](0009-temporal-facts-and-scopes.md) | Faits temporels & scopes en markdown, résolus au query time | Accepté |
| [0010](0010-rejected-technical-scope.md) | Refus stack lourde (Qdrant, Neo4j, LangGraph…), conditions de réouverture | Accepté |
| [0011](0011-agent-architecture-react-tiers.md) | Agent ReAct natif + tiers outils/tâches, pas de swarm v1 | Accepté |
| [0012](0012-memory-search-retrieval-orchestrator.md) | `memory_search` : orchestrateur retrieval déterministe, lanes enfichables | Accepté |
| [0013](0013-wikilinks-backlinks-obsidian-vault.md) | Wikilinks & backlinks, vault Obsidian-compatible, graphe en mémoire | Accepté |
| [0014](0014-federated-local-first-exchange.md) | Fédération local-first : topologie asymétrique, projection MJ, port de transport | Accepté |
| [0015](0015-llm-client-rust-genai.md) | Client LLM = rust-genai, tool-loop maison, couture minimale | Accepté |
| [0016](0016-p2p-transport-iroh.md) | Transport P2P : iroh, identité Ed25519, rendez-vous, offline-first | Accepté |

## Format

Chaque ADR suit :

- **Contexte** — pourquoi la décision
- **Décision** — ce qu'on fait
- **Conséquences** — positif, négatif, neutre
- **Tickets liés** — backlog migration

## Créer un nouvel ADR

1. Numéro suivant : `0009-...`
2. Statut : `Proposé` → `Accepté` | `Rejeté` | `Remplacé par ADR-XXXX`
3. Référencer depuis `docs/migration-plan.md` si impact phase
