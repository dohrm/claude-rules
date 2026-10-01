# ADR-0011 : Architecture agent — ReAct natif, tiers outils/tâches, pas de swarm v1

**Statut :** Accepté
**Date :** 2026-07-12
**Tickets :** MIG-301, MIG-303, MIG-313
**Étend :** [ADR-0003](0003-model-backend-abstraction.md) (rôles modèle)

## Contexte

Discussion d'architecture agent. Proposition initiale : un agent principal **ReAct** + une fonctionnalité **swarm** (sous-agents spécialisés : rédactionnel, mémoire, …).

Deux constats de départ :

1. **Le ReAct est déjà là.** `AgentRuntime` (Rig) exécute un tool loop multi-tour streamé = Reason/Act/Observe. Avec les modèles à tool-calling natif, le raisonnement est implicite et supérieur à un ReAct prompté à la main.
2. **La plupart des « agents spécialisés » ne sont pas des agents.** Un « agent rédactionnel » = 1 appel LLM (outil). Un « agent de mémoire » = `corpus_query` + `session_synthesize` (outils + tâche, déjà en place, ADR-0009).

Contrainte produit (vision juillet 2026) : **coût tokens à optimiser**, **on-prem Gemma** privilégié. Un swarm multiplie tokens, latence, non-déterminisme et coût de debug — à confiner.

## Décision

### Taxonomie : outil / tâche / sous-agent

| Niveau | Définition | Exemples |
|--------|-----------|----------|
| **Outil** | 1 appel déterministe ou 1 appel LLM borné | `note_add`, `entity_add`, `corpus_query`, `generate_recap` |
| **Tâche** | opération bornée multi-étapes, modèle dédié, **sans boucle autonome** ; propose → confirme | `session_synthesize`, `entity_prefill` |
| **Sous-agent** | boucle multi-tour **autonome**, contexte isolé, outils/modèle propres | *(aucun en v1)* |

Un sous-agent ne se justifie que si : boucle autonome **ET** contexte isolé **ET** (parallélisme réel **OU** vérification indépendante).

### Architecture en tiers

```
Tier 1 — Agent principal ReAct (tool-calling natif Rig, modèle chat)
   ├─ Tier 2a — Outils (tools/core)
   └─ Tier 2b — Tâches (modèle extract/compose, propose → confirme)
Tier 3 — Sous-agents (swarm) : NON implémenté en v1
```

1. **Agent principal** = boucle Rig actuelle. Pas de framework ReAct explicite maison (pas de scratchpad `Thought/Action`). Tout l'interactif temps réel passe par lui.
2. **Outils & tâches** portent le « spécialisé ». Une tâche = un rôle modèle + un prompt dédiés, appelée comme un outil par l'agent principal.
3. **Pas de sous-agents autonomes en v1.** On s'arrête aux tiers 1+2.

### Rôles modèle (étend ADR-0003)

```yaml
agent:
  chat:    { provider: local,  model: gemma-3-12b }   # agent principal
  extract: { provider: local,  model: gemma-3-12b }   # extraction structurée (JSON)
  compose: { provider: openai, model: gpt-4o }        # rédaction narrative riche
```

`compose` est nouveau : rédaction (recap, description PNJ). Optionnel — fallback sur `chat` si absent (comme `extract` aujourd'hui).

### Transparence du raisonnement

Le tool-calling natif reste la source de vérité. L'UI **peut** afficher les étapes (appels d'outils, éventuelles pensées) — c'est de l'affichage, non structurant. Non bloquant.

### Invariants transverses

- **Tout écrit passe par `tools/core`** ([ADR-0004](0004-tools-core-single-source.md)). Aucun tier n'a de write privilégié.
- **L'agent propose, l'humain confirme** ([ADR-0009](0009-temporal-facts-and-scopes.md)).
- **Partage GM/joueur** : même moteur ; seuls le preamble et le scope changent entre profils. Une tâche (ex. `entity_prefill`) sert les deux.

## Conditions de réouverture (swarm — Tier 3)

Introduire des sous-agents **uniquement** si, en usage réel :

- une tâche **offline** (fin de session) bénéficie d'un **fan-out parallèle** mesurable (ex. extraire entités ∥ événements ∥ relations puis merger) ;
- une **réconciliation mémoire** multi-étapes (contradiction événement/entité → recherche → supersede) dépasse ce qu'une tâche linéaire gère ;
- le besoin est **hors temps réel** (coût token acceptable car non interactif).

Le swarm restera alors **confiné à l'offline batch**, jamais à table par défaut.

## Conséquences

### Positives

- Frugal, déterministe-friendly, debuggable. Aligné contrainte coût/on-prem.
- Réutilise l'existant (Rig loop, rôles ADR-0003, colonne ADR-0009).
- Extensible : les tâches se multiplient sans orchestration multi-agent.

### Négatives

- Pas de parallélisme agent en v1 (acceptable : le temps réel est séquentiel et petit).

### Neutres

- `compose` dormant tant qu'aucune tâche de rédaction ne l'utilise.

## Implications implémentation

- `AgentModelsConfig` + `ResolvedAgentConfig` + `AgentBindings` : ajouter le rôle `compose` (fallback `chat`).
- Première tâche `compose` : outil/tâche `generate_recap` (récap de session narratif).
- `entity_prefill` (tâche) : réutilise l'extraction ADR-0009 pour pré-remplir le dialog de création d'entité (accroche agent côté desktop).
