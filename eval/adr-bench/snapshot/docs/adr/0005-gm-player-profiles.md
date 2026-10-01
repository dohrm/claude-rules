# ADR-0005 : Profils MJ et joueur

**Statut :** Accepté  
**Date :** 2026-06-23  
**Tickets :** MIG-005, MIG-404, MIG-405, MIG-406, MIG-407

## Contexte

MJ et joueur partagent le **même workflow outillé** (notes, corpus, entités) mais diffèrent sur :

1. **Anticipation** — MJ prépare / anticipe ; joueur journalise / interprète.
2. **Assertions de vérité** — MJ écrit l'instance (PNJ, timeline) ; joueur écrit du subjectif.

Ce n'est pas un problème de fuite (ADR-0001) : workspaces séparés.

## Décision

Champ dans `campaign.yaml` :

```yaml
profile: gm          # gm | player (défaut: gm)
player_character: rosa   # requis si profile: player
```

### Routage des notes

| Profil | Destination par défaut |
|--------|------------------------|
| `gm` | `sessions/YYYY-MM-DD/raw.md` via `note_add` |
| `player` | `pj/{semantic_id}/journal.md` ou `notes/` (à figer MIG-404) |

### Politique corpus (`corpus_query` / index scope)

| Profil | Scope |
|--------|--------|
| `gm` | canon + instance complète |
| `player` | canon + PJ du joueur + `journal/` + whitelist optionnelle |

### Politique vérité (agent preamble)

| Profil | Comportement |
|--------|--------------|
| `gm` | Peut proposer mutations `instance/` (confirmation requise) |
| `player` | N'écrit pas `instance/` sauf sa fiche PJ ; formulations subjectives |

### Handoff

- MJ publie via `journal/` et/ou `quill export player-pack` (MIG-406).
- Le joueur ouvre un **pack** comme workspace, pas le dossier MJ complet.

## Conséquences

- Phase 2 démarre en `profile: gm` seulement.
- Profil joueur = Phase 4, après agent notes MJ stable.

## Niveaux de vérité (référence)

| Niveau | Qui écrit | Exemple |
|--------|-----------|---------|
| Canon | import | règles VtM |
| Instance | MJ | `pnj/prince.md` |
| Subjectif | joueur (et notes MJ privées) | journal PJ |
| Publié | MJ → export | `journal/recap.md` |
