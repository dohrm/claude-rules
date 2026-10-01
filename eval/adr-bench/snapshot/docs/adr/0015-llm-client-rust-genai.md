# ADR-0015 : Client LLM = rust-genai, tool-loop maison, couture minimale

**Statut :** Accepté
**Date :** 2026-07-24
**Remplace :** [ADR-0002](0002-agent-runtime-rig.md) (Rig comme runtime), [ADR-0003](0003-model-backend-abstraction.md) (abstraction ModelBackend sur Rig typé)
**Préserve :** [ADR-0011](0011-agent-architecture-react-tiers.md) (tiers ReAct / outils / tâches)

## Contexte

`crates/agent` repose sur **Rig** (`rig-core 0.39`) pour le tool loop, le streaming et les providers ([ADR-0002](0002-agent-runtime-rig.md)). Les clients Rust de Rig sont **typés par provider** (`openai::Client`, `gemini::Client`) alors que la config Quill est dynamique — d'où l'abstraction `ModelBackend` + `enum RigBackend` + `BackendCapabilities` construite par [ADR-0003](0003-model-backend-abstraction.md) *uniquement pour contourner ce manque d'agnosticité*.

Ce contournement montre ses limites en usage :

1. **Agnosticité providers incomplète** — chaque provider = une variante enum, un fichier `backend/*.rs`, des features Cargo, des capacités inégales à gérer à la main (~390 lignes de code de couture).
2. **Agnosticité outils** — l'API tool-calling de Rig varie selon le provider ; l'uniformité doit être maintenue côté Quill.
3. **Prompt caching faible** — la contrainte coût/on-prem d'[ADR-0011](0011-agent-architecture-react-tiers.md) (« coût tokens à optimiser ») est mal servie.

**État vérifié du couplage (2026-07-24)** : `rig::` n'apparaît que dans **6 fichiers, 21 références, tous dans `crates/agent`**. `tools/core`, `core`, `desktop`, `mcp` sont **zéro Rig**. L'abstraction d'ADR-0003 a donc **tenu son rôle de confinement** : remplacer le client LLM est un travail localisé, pas un rewrite.

[`rust-genai`](https://github.com/jeremychone/rust-genai) offre nativement ce que la couture Rig simule : sélection par **string de modèle** + namespacing `adapter::model`, **API tool-calling uniforme** (`tool_choice` provider-neutre), **prompt caching** (Anthropic `cache_control`, OpenAI `prompt_cache_key`), streaming, structured output. C'est un **client**, pas un framework agent : il ne fournit **pas** de boucle ReAct.

## Décision

Nous remplaçons Rig par **`rust-genai`** comme client LLM de `crates/agent`, et nous **reconstruisons le tool-loop** au-dessus de son API.

- **Client** : `genai` devient la couche multi-provider. L'`enum RigBackend`, les fichiers `backend/{openai,openai_compat,gemini,client}.rs` et `BackendCapabilities` sont **supprimés** — la sélection de provider redevient un string de modèle piloté par la config (le motif d'ADR-0003 disparaît).
- **Couture minimale conservée** : un trait fin `ModelBackend` (complétion + stream) implémenté par un unique `GenaiBackend` (~40-60 L). Objectif : **faker le modèle en tests** (pas d'HTTP) et maintenir la discipline « **pas de `genai::` hors `crates/agent/backend/`** » (successeur direct de la règle « pas de `rig::` hors agent »).
- **Tool-loop maison** : `runtime/mod.rs` et l'adaptateur d'outils (ex-`rig_adapter.rs`) sont réécrits en une boucle tool-calling multi-tour sur `exec_chat_stream` (Reason/Act/Observe implicite via tool-calling natif, conforme à [ADR-0011](0011-agent-architecture-react-tiers.md) — aucun scratchpad prompté à la main).
- **Prompt caching** exploité pour le préfixe statique (tools + system preamble), au service de la contrainte coût.
- **Pin de version** : `genai` est pré-1.0 ; on épingle la version comme on épinglait Rig.

Les rôles modèle (`chat`/`extract`/`compose`, ADR-0003 + ADR-0011) et la config YAML `providers`/`agent.*` sont **conservés** : seul le discriminant `kind`/factory est remplacé par la résolution genai.

## Conséquences

### Positives
- Agnosticité providers **et** outils native : ajouter un provider = un string de modèle, plus de variante enum ni de feature Cargo.
- ~390 lignes de couture backend supprimées ; le code agent se rapproche de son intention métier.
- Prompt caching de première classe → moins de tokens, sert on-prem/coût.
- Le confinement d'ADR-0003 rend la migration localisée (6 fichiers, tous dans `crates/agent`).

### Négatives
- **Le tool-loop est à reconstruire** (~200-350 L) : c'est le vrai coût, `genai` n'étant pas un framework agent.
- On échange le churn de Rig contre celui de `genai` (pré-1.0, releases beta) — surface plus petite (client vs framework), mais réel.
- Fenêtre de régression sur streaming / annulation / erreurs pendant la réécriture de `runtime`.

### Neutres
- `tools/core`, `core`, `desktop`, `mcp` : aucun changement (déjà zéro LLM-framework).
- ADR-0011 (tiers, taxonomie outil/tâche/sous-agent) reste vrai à l'identique.

## Alternatives considérées

- **Rester sur Rig** — écarté : l'agnosticité providers/outils et le prompt caching sont structurellement en deçà ; la couture ADR-0003 est un coût de maintenance permanent pour un manque que genai comble nativement.
- **`genai::Client` direct sans trait** — écarté : wrapper un client déjà agnostique serait normalement une couche prématurée, mais la couture d'~50 L se paie en testabilité (fake sans HTTP) et en discipline d'import ; jugée rentable ici, contrairement au reste de l'ex-abstraction qu'on supprime.
- **Autre client agnostique (async-openai only, appels HTTP maison)** — écarté : `async-openai` n'est pas multi-provider ; du HTTP maison recréerait exactement la couture qu'on veut supprimer.
