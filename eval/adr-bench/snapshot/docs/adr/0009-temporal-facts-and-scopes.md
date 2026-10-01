# ADR-0009 : Modèle de faits temporel & scopes

**Statut :** Accepté
**Date :** 2026-07-07
**Tickets :** MIG-301, MIG-302, MIG-404, MIG-405, MIG-406
**Contexte source :** vision « RPG Assistant » (juillet 2026)

## Contexte

La vision produit demande une **mémoire narrative qui évolue session après session** et des requêtes rétroactives/perspectivées :

> « Que savait mon personnage à la fin de la session 5 sur Valdris ? »

Le modèle actuel ne sait pas y répondre : `Entity` porte un `created`/`updated` plat et `introduced_session` ; les notes ont des tags `[date:]`/`[location:]` hérités. **Pas de `session_at` par fait, pas de supersede, pas de scope de visibilité.** Le code peut *stocker* une entité mais pas raisonner sur *ce qui était connu, par qui, à quel moment*.

La vision propose de résoudre ça avec un knowledge graph temporel (Graphiti + Neo4j). C'est disproportionné pour l'échelle (voir [ADR-0010](0010-rejected-technical-scope.md)).

## Question tranchée : où vit un « fait » ?

Deux options :

- **A — Event-sourcing.** Les entités deviennent des projections d'un ledger append-only. Sémantiquement pur mais détruit le modèle « entité = document éditable à la main », ajoute une couche de reconstruction, se bat contre le git-friendly. **Rejeté.**
- **B — Le fait = l'événement de session.** L'entité reste un **document d'état courant** ; le temporel vit dans les **événements extraits à `session_process`**. **Retenu.**

L'option B est fidèle à l'existant (héritage de tags résolu au process time) et à la façon dont un MJ travaille : il note en chronologique, les entités sont des résumés vivants.

## Décision

### Trois couches, tout en markdown

| Couche | Fichiers | Rôle | Métadonnée |
|--------|----------|------|------------|
| **Entités** | `instance/pnj\|lieux\|factions/…` | État courant, éditable | `scope` (défaut `gm_only`), `introduced_session` |
| **Événements** | `sessions/<N>/processed.md` (bloc structuré) | **Épine temporelle** | `session_at`, `scope`, `known_by[]`, liens entités |
| **Corpus** | canon + instance | Recherche | ranking par `source` (voir [ADR-0007](0007-agentic-rag-v0-bm25.md)) |

### Scopes (métadonnée de rendu, PAS firewall)

```
scope ∈ { public | gm_only | player:<pj_semantic_id> }
```

- `public` — établi en jeu, connu de tous les PJ.
- `gm_only` — secrets, intentions, arcs cachés (défaut prudent).
- `player:<id>` — propre à un PJ (background, révélation privée).

Conformément à [ADR-0001](0001-local-first-campaign-tool.md), le scope **n'est pas** une ACL runtime anti-spoiler. C'est une **métadonnée de filtrage à l'export/récap** dans le workspace MJ unique. Le handoff joueur reste l'export (player pack, `journal/`).

### Résolution temporelle

Chaque événement porte `session_at` (session d'établissement). Une requête rétroactive filtre `session_at ≤ N`. Une requête perspectivée filtre en plus `scope = public OR known_by ∋ <pj>`.

Le **supersede** est chronologique et implicite : un événement de session N postérieur prime narrativement ; l'entité (état courant) reflète le dernier connu. Pas de `valid_at`/`invalid_at` explicite en v0.

### Démarrage minimal

- `scope` mono-valué suffit ; `known_by[]` explicite seulement quand la divergence par joueur devient réelle.
- Pas de versioning des documents entités. La vérité temporelle vit dans le stream d'événements, pas dans un historique d'entités.

## Conséquences

### Positives

- Répond à la requête temporelle/perspectivée sans DB, sans event-sourcing complet.
- Réutilise `session_process` comme point d'injection unique du stampage.
- Player pack (MIG-406) = rendu filtré sur le stream, mécanisme naturel.

### Négatives

- Impossible de reconstituer l'état exact d'une entité à la session N (seul l'état courant existe). Accepté : le stream d'événements couvre le besoin réel.
- Discipline requise : `session_process` doit stamper systématiquement.

### Neutres

- `weight`/`OVERRIDES_BOOK` de la vision = scoring de retrieval ([ADR-0007](0007-agentic-rag-v0-bm25.md)), pas du stockage.

## Implications implémentation

- `EntityFrontmatter` : ajouter `scope` (défaut `gm_only`).
- Nouveau type `SessionEvent { session_at, scope, known_by, entities[], content }` dans `quill-core`.
- `session_process` : extraire et stamper les événements (extension, pas réécriture).
- Résolution `scope`/`session_at` : fonction de filtrage dans `tools/core`, appelée par corpus/récap/export.
- Pas de dépendance nouvelle. Pas de Rig hors `crates/agent`.
