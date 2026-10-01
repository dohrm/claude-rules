# ADR-0007 : RAG agentique v0 sur BM25

**Statut :** Accepté  
**Date :** 2026-06-23  
**Tickets :** MIG-303, MIG-304, MIG-501, MIG-502

> **Amendement 2026-07-12 ([ADR-0012](0012-memory-search-retrieval-orchestrator.md)) :** `corpus_query` devient la **lane `lexical`** d'un outil `memory_search` (orchestrateur déterministe). Le cadrage « corpus_query en boucle » ci-dessous est réalisé par la boucle ReAct principale appelant `memory_search`. Surtout : la cible étant un **petit modèle local** (32k), le dense + reranking passe de « Phase 5 conditionnelle » à **near-term éval-gated** — le retrieval porte l'intelligence quand le modèle ne peut pas compenser.

## Contexte

`corpus_query` utilise Tantivy BM25 (sections markdown H1–H3). La vision mentionnait embeddings et wiki `.quill/memory/` distillé par Claude. L'objectif est un RAG **agentique**, pas un pseudo-wiki statique.

## Décision

### RAG agentique v0 (Phase 3)

- L'agent reçoit le tool `corpus_query`.
- Preamble : ne pas affirmer une règle sans avoir cherché ; citer les extraits.
- **Pas** de refonte embeddings en Phase 3.
- **Pas** de maintien de `/wiki-build` comme couche produit.

### Scoring par source (hiérarchie de vérité)

La hiérarchie `weight`/`OVERRIDES_BOOK` de la vision est un **scoring de retrieval**, pas du stockage ([ADR-0009](0009-temporal-facts-and-scopes.md)). Le score BM25 est pondéré par la source du chunk :

| Source | Poids indicatif | Origine |
|--------|-----------------|---------|
| Note MJ / `OVERRIDES_BOOK` | ~1.0 | instance, amendement explicite |
| Événement de session | ~0.8 | `sessions/<N>/processed.md` |
| Livre de base | ~0.4 | canon, immutable |

Sur contradiction canon/instance, l'instance prime (déjà l'invariant produit). Les valeurs exactes se calibrent en usage ; ce n'est pas un paramétrage fin bloquant.

### RAG v2 (Phase 5, conditionnel)

Déclencher seulement si en campagne réelle :

- échecs synonymes / paraphrases fréquents ;
- corpus très large ;
- besoin multilingue.

Options : hybrid BM25 + dense, Rig fastembed, meilleur chunking.

## Conséquences

- `EmbeddingConfig` dans `config.yaml` : dormant jusqu'à Phase 5.
- `session_process` actuel (tableau tags résolus) reste ; la **synthèse LLM** est un tool/agent séparé (MIG-301).

## Métrique succès Phase 3

Une question règles en session obtient une réponse avec ≥ 1 extrait `corpus_query` pertinent affiché à l'utilisateur.
