# ADR-0006 : Ordre des phases — coque min avant portail complet

**Statut :** Accepté  
**Date :** 2026-06-23  
**Tickets :** Phase 1–4 backlog

## Contexte

Tentation : compléter le portail desktop (édition entités, intrigues, canon) avant l'agent intégré. Risque : livrer un viewer sophistiqué sans débloquer l'indépendance Claude.

## Décision

Ordre obligatoire pour la **stratégie** :

1. **Phase 0** — gouvernance doc + config
2. **Phase 1** — coque min (session du jour, play shell sans channel)
3. **Phase 2** — agent notes (**bloqueur**)
4. **Phase 3** — synthèse + RAG agentique v0
5. **Phase 4** — profondeur portail (peut chevaucher lecture seule dès Phase 1)
6. **Phase 5** — RAG v2 si nécessaire
7. **Phase 6** — MCP optionnel (continu)

### Phase 1 — in scope

- Session du jour + refresh
- Play UI prête pour stream agent
- Lecture entités / canon / sessions (existant)

### Phase 1 — out of scope

- Éditeur entité formulaire complet
- Storyline CRUD UI
- Player pack
- Unification tokens design system

## Conséquences

- KPI « sans Claude Code » = Phase 2, pas Phase 4.
- Édition manuelle notes (hors chat agent) = Phase 4 (MIG-401), pas bloquante pour Phase 2.

## Exception

Tickets **bugfix** ou **dettes bloquantes CI** hors migration : OK hors phase, pas de feature portail.
