# ADR-0010 : Périmètre technique refusé

**Statut :** Accepté
**Date :** 2026-07-07
**Tickets :** —
**Contexte source :** vision « RPG Assistant » (juillet 2026)

## Contexte

La vision « RPG Assistant » (juillet 2026) propose une stack lourde : Qdrant, Graphiti + Neo4j, BGE-M3 sur GPU, Docling, Whisper, LangGraph/LlamaIndex. Pour un outil **local, mono-utilisateur, à l'échelle d'une campagne de loisir** (~10-20 livres, quelques dizaines de fiches — la vision elle-même écrit « tient en RAM sans effort »), cet empilement est de la complexité prématurée qui écraserait la maintenabilité.

Cet ADR **trace explicitement les refus** pour éviter que la vision docx ne ressurgisse comme dette non documentée. Il ne ferme pas les portes définitivement : il fixe les conditions de réouverture.

## Décision

| Composant vision | Décision | Raison |
|------------------|----------|--------|
| **Qdrant *serveur*** | **Rejeté** | Un daemon = ops/backup. *(Amendé [ADR-0012](0012-memory-search-retrieval-orchestrator.md) : le mode **embarqué** in-process ne tombe pas sous ce rejet — voir ci-dessous.)* |
| **Store vectoriel *embarqué* (Qdrant edge, …) + fastembed** | **Rouvert (near-term, éval-gated)** | In-process, sans daemon, CPU (fastembed ONNX), en `tools/core`. Justifié par la classe de modèle : petit modèle local → le retrieval porte l'intelligence ([ADR-0012](0012-memory-search-retrieval-orchestrator.md)). Ajouté après éval baseline. |
| **Graphiti + Neo4j** | **Rejeté** | Base graphe pour quelques dizaines d'entités = disproportionné. Les relations vivent en markdown ; si besoin → graphe en mémoire depuis le frontmatter (pattern Tantivy). |
| **LangGraph / LlamaIndex** | **Rejeté** | Rig (Rust) est déjà en place ([ADR-0002](0002-agent-runtime-rig.md)). Un framework Python scinderait la stack et torpillerait la migration. |
| **BGE-M3 GPU requis** | **Non requis** | GPU jamais imposé. La lane dense utilise **fastembed CPU** ([ADR-0012](0012-memory-search-retrieval-orchestrator.md)) ; un embedder plus lourd (BGE-M3) reste une option de config, pas un prérequis. |
| **Dense embeddings / hybrid** | **Near-term (éval-gated)** *(amendé)* | Passe de « Phase 5 conditionnelle » à cible near-term car **modèle local à petit contexte** ([ADR-0012](0012-memory-search-retrieval-orchestrator.md)). BM25 garde son rôle (noms propres) ; le dense ajoute le rappel sémantique ; fusion RRF + reranker. Confirmé par éval avant d'être posé. |
| **Docling** | **Différé** | pymupdf4llm one-shot suffit. Détail de préprocessing swappable, pas de l'architecture. Réévaluer si les tables de règles cassent réellement. |
| **Whisper (voix)** | **Différé** | Front-end de capture optionnel ultérieur. Ne doit pas façonner le cœur. |
| **MEMTIER / core memory** | **Rejeté comme framework** | Le « résumé ~800 tokens in-context » est un détail d'assemblage de preamble, pas un système de tiers à construire. |

## Conditions de réouverture

- **Dense/hybrid** → **rouvert** ([ADR-0012](0012-memory-search-retrieval-orchestrator.md)) : posé après une **éval baseline** (BM25-seul vs hybride+rerank sur corpus réel) qui confirme le gain. Store embarqué + fastembed CPU, sans daemon ni GPU.
- **Graphe en mémoire** → si des requêtes relationnelles multi-sauts deviennent un besoin produit récurrent.
- **Docling** → si l'extraction de tables de règles PDF échoue sur un corpus réel.
- **Voix** → post-Phase 4, sur demande utilisateur.

Aucune de ces réouvertures ne remet en cause l'ossature markdown + Rust + Rig + Tantivy.

## Conséquences

### Positives

- Stack maintenable, mono-langage, git-friendly, sans daemon ni GPU obligatoire.
- La valeur produit de la vision est absorbée par [ADR-0009](0009-temporal-facts-and-scopes.md) (~90 % de la valeur pour ~10 % de l'infra).

### Négatives

- Écart assumé avec la vision docx sur la stack. La vision reste une source d'idées produit, pas une spec technique.

### Neutres

- Ces refus sont réversibles sous conditions explicites ci-dessus.
