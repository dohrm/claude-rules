# ADR-0003 : Abstraction ModelBackend sur Rig

**Statut :** Remplacé par [ADR-0015](0015-llm-client-rust-genai.md)  
**Date :** 2026-06-23  
**Tickets :** MIG-003, MIG-202, MIG-209, MIG-210, MIG-211

> **Remplacé (ADR-0015, 2026-07-24)** — l'`enum RigBackend` + `BackendCapabilities` existaient pour contourner les clients Rig typés ; `rust-genai` rend l'agnosticité native et cette machinerie disparaît. Ce qui survit : une **couture minimale** `ModelBackend` (~50 L) pour la testabilité, et les **rôles modèle** `chat`/`extract`/`compose`.

## Contexte

Rig est multi-provider mais les clients Rust sont **typés** (`openai::Client`, `gemini::Client`, …). La config YAML est **dynamique** (`provider: gemini`). Une couture Quill est nécessaire.

Utiliser Rig directement partout créerait des fuites de types et des limitations (features Cargo par provider, capacités inégales, fallback difficile).

## Décision

Deux couches dans **`crates/agent` uniquement** :

### 1. `ModelBackend` (trait)

- Responsabilité : un modèle, complétion (+ stream), éventuellement tools Rig.
- Implémentation interne : `enum RigBackend { OpenAiCompat(...), OpenAi(...), Gemini(...) }`.
- Factory : `build_backend(spec: &ProviderSpec, model: &str) -> Arc<dyn ModelBackend>`.

### 2. `AgentRuntime` (produit)

- Responsabilité : preamble profil, `QuillToolRegistry`, sandbox workspace, orchestration multi-tour.
- Expose : `run_turn(message) -> Stream<AgentEvent>`.
- Peut référencer **plusieurs** backends : `chat` et `extract` (tâches différentes).

### Config (`quill-core`, sans Rig)

```yaml
providers:
  local:
    kind: openai_compat
    base_url: http://localhost:8080/v1
  openai:
    kind: openai
    api_key_env: OPENAI_API_KEY

agent:
  chat:
    provider: local
    model: gemma-3-12b
  extract:
    provider: openai
    model: gpt-4o-mini
```

`kind` = discriminant factory. `agent.chat.provider` = **clé** dans `providers`.

## Règles

| Règle | Détail |
|-------|--------|
| Pas de `use rig::` hors `crates/agent` | Desktop, tools, mcp, core interdits |
| Pas de second crate `quill-llm` | Factory vit dans `agent/backend/` |
| Features Cargo | `quill-agent` features : `openai`, `gemini`, `openai-compat` |
| Capabilities | `BackendCapabilities` : fail fast si tools/stream non supportés |

## Conséquences

- Migration depuis `LlmConfig { primary, fallback }` : voir MIG-004 (rétro-compat temporaire OK).
- Ajout d'un provider = nouvelle variante enum + feature, pas de changement desktop.

## Références

- Discussion : providers Rig typés vs config dynamique (2026-06-23).
- [ADR-0011](0011-agent-architecture-react-tiers.md) — ajoute le rôle modèle `compose` (rédaction) aux rôles `chat`/`extract`.
