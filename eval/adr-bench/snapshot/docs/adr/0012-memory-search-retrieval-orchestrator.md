# ADR-0012 : `memory_search` — orchestrateur de retrieval déterministe

**Statut :** Accepté
**Date :** 2026-07-12
**Tickets :** MIG-303 (évolue), [MIG-320…MIG-326](../../backlog/migration/README.md)

> **Amendement 2026-07-13 — lanes denses actées.** L'éval-gate des lanes `semantic`/`rerank` est levée (décision produit) : l'éval devient une mesure a posteriori (MIG-326), pas un prérequis. Choix techniques : **fastembed-rs** (ONNX CPU), embedding **bge-m3 quantized** (`Bgem3Model::BGEM3Q`, dense 1024 dims, multilingue), reranker **`BGERerankerV2M3`** (multilingue). Store vectoriel : **brute-force cosine dans un sidecar** `campaign_dir/.quill/embeddings/vectors.bin` (bincode, hash par section pour l'embedding incrémental) — pas de LanceDB/ANN : à l'échelle d'une campagne (~10³–10⁴ chunks) le scan est ~1 ms, et le coût réel est l'embedding CPU, pas la recherche. Modèles téléchargés explicitement (écran admin desktop) dans un dossier global ; sans modèle, `memory_search` dégrade silencieusement en lexical+entity+events. La lane `events` est dégatée (persistance `processed.md`, commit 36b73e2).
**Étend :** [ADR-0007](0007-agentic-rag-v0-bm25.md), [ADR-0009](0009-temporal-facts-and-scopes.md)
**Amende :** [ADR-0010](0010-rejected-technical-scope.md)
**Dans le cadre de :** [ADR-0011](0011-agent-architecture-react-tiers.md) (reste un outil, pas un sous-agent)

## Contexte

L'agent cible n'est **pas** un modèle frontière à grand contexte (Claude Code) mais un **petit modèle local** (Ollama, qwen3:8b, ~32k) avec une campagne dont l'information **dépasse la fenêtre de contexte**. Conséquence structurante :

> Avec un petit modèle, **le retrieval est l'intelligence**. Le modèle ne peut ni tout tenir, ni compenser un retrieval médiocre en raisonnant. Ce qu'on lui donne doit être *peu, juste, déjà pertinent*.

Le bug « entity_get(Jocelyne) not found » a révélé que les outils actuels sont **bas-niveau et fragmentés** (`entity_get` exact, `entity_list`, `corpus_query` rendant des chunks bruts). Le modèle jongle et se trompe d'outil.

Besoin exprimé : **un seul outil `memory_search`** côté modèle principal, qui cache la complexité (plusieurs façons d'interroger) et rend la meilleure information.

## Décision

### `memory_search` = orchestrateur **déterministe** (pas de LLM interne)

`memory_search(query, viewpoint?, up_to_session?)` lance plusieurs **lanes** de retrieval, **fusionne** et **rerank**, et renvoie un top-k **compact, typé, résolu, sourcé**. Aucun LLM à l'intérieur.

- L'**agentique** (reformuler, creuser, réessayer) reste dans la **boucle ReAct principale** ([ADR-0011](0011-agent-architecture-react-tiers.md)) : elle rappelle `memory_search` en itérant. → `memory_search` reste un **outil**, pas un sous-agent. ADR-0011 intact.
- Justification du déterministe : un 8B planifie mal le retrieval et une boucle LLM par recherche coûte tokens/latence à table. Un fan-out + fusion fait mieux, plus vite, moins cher.

### Lanes (enfichables)

| Lane | Rôle | État |
|------|------|------|
| `lexical` | BM25 Tantivy (canon + instance) — noms propres | ✅ existe (`corpus_query`) |
| `entity_resolve` | nom/alias/id → entité, cross-dossier (pnj+pj+…), insensible accents/casse | à faire (règle Jocelyne) |
| `events` | `resolve_events` filtré (entité/session/scope) — [ADR-0009](0009-temporal-facts-and-scopes.md) | *gated* sur persistance des événements |
| `semantic` | dense (fastembed CPU + store vectoriel embarqué) | near-term, éval-gated |
| `rerank` | reranker CPU en 2ᵉ étage (précision@k) | near-term |

### Fusion & résultats

- Fusion multi-lanes par **RRF** (Reciprocal Rank Fusion) — pas de paramétrage fin.
- Résultat typé : `{ kind: entity | event | canon, title, snippet, ref (semantic_id | session_at | file:section), scope, relevance }`. Les **entités sont des objets de 1re classe** (sections d'un même fichier dédupliquées en une entité résolue) → l'agent enchaîne (`entity_get`, `events`) sans deviner le slug.
- **Filtre scope/temporel** ([ADR-0009](0009-temporal-facts-and-scopes.md)) appliqué selon le viewpoint (prêt MJ/joueur).

### Compaction (contrainte petit modèle)

- `memory_search` rend des extraits **distillés et bornés**, taillés au budget de contexte — jamais des dumps.
- Le runtime budgète le contexte : preamble + tools + top-k mémoire + conversation.

### Ce que ça subsume / garde

- **Subsume** `corpus_query` (devient la lane `lexical`), le futur `entity_search`, `events_for_entity`.
- **Garde** les fetch précis (`entity_get` par id) pour le drill-down.

## Le retrieval est nécessaire, pas suffisant

Même parfaitement nourri, un 8B (a) écrit parfois de mauvaises requêtes, (b) synthétise mal un gros paquet. Donc en complément (déjà acté) : jobs étroits (`extract`/`compose`, ADR-0011) et **routage de la synthèse dure vers un plus gros modèle** (`compose`/cloud) quand disponible.

## Conséquences

### Positives

- Une seule affordance mémoire pour le modèle principal ; complexité cachée.
- Frugal, déterministe, débuggable ; reste un outil (pas de swarm).
- Lanes enfichables : dense/rerank s'ajoutent sans changer l'interface ni le modèle.

### Négatives

- La lane `events` dépend de la fermeture de la boucle (persistance `processed.md`).
- Le gain du dense doit être **mesuré** (éval baseline) avant de l'ajouter — un a priori fort, pas une certitude.

## Séquencement

1. `memory_search` : lane `lexical` + `entity_resolve` + fusion + compaction. Règle Jocelyne, pose l'interface.
2. **Éval baseline** (questions règles + sémantiques, corpus réel) — chiffre le manque.
3. Lanes `semantic` + `rerank` (fastembed + store embarqué, en `tools/core`, sans Rig, sans GPU), RRF — si l'éval confirme.
4. Budget de contexte dans le runtime (transverse).

## Références

- [ADR-0007](0007-agentic-rag-v0-bm25.md) — RAG BM25 (memory_search en est l'évolution)
- [ADR-0009](0009-temporal-facts-and-scopes.md) — couches mémoire & résolution
- [ADR-0010](0010-rejected-technical-scope.md) — amendé : embarqué ≠ daemon
- [ADR-0011](0011-agent-architecture-react-tiers.md) — memory_search reste un outil
