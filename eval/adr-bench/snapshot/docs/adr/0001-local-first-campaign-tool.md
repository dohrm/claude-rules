# ADR-0001 : Outil local individuel

**Statut :** Accepté — périmètre amendé par [ADR-0014](0014-federated-local-first-exchange.md)  
**Date :** 2026-06-23  
**Tickets :** MIG-005, MIG-406

> **Amendement (ADR-0014, 2026-07-24)** — le périmètre *strictement single-user* est élargi à un modèle **multi-participant fédéré** : le handoff devient bidirectionnel et filtré (joueur → campagne autant que campagne → joueur), avec git comme substrat primaire et des bundles portables en secours. Les invariants ci-dessous restent vrais : **pas de serveur partagé, pas de sync temps réel, pas d'ACL runtime.** La protection anti-spoiler passe par le *filtrage à la projection*, jamais par un disque partagé.

## Contexte

Quill a parfois été pensé comme un portail multi-utilisateur avec risque de fuite des notes MJ vers les joueurs. Le produit réel est un **carnet de campagne local** : une instance Quill par utilisateur, un dossier markdown par rôle dans la vie de la table.

## Décision

- **Pas de serveur centralisé** de campagne partagée en temps réel.
- **Pas d'ACL anti-spoiler** au niveau runtime : le MJ et le joueur ont des **workspaces distincts** sur des machines / dossiers distincts.
- Le handoff MJ → joueur se fait par **export** (git, zip, `journal/`, player pack) — pas par sync Quill.

## Conséquences

### Positives

- Architecture simple, git-friendly, pas de auth/sync.
- L'agent n'a pas à implémenter un modèle de permissions multi-tenant.

### Négatives

- Pas de collaboration temps réel dans le produit.
- Le MJ doit explicitement publier ce que le joueur reçoit.

### Neutres

- Le profil `player` (ADR-0005) est une **posture cognitive** (corpus, vérité), pas de la sécurité réseau.

## Implications implémentation

- Sandbox agent = **ne pas sortir du workspace ouvert**, pas "masquer des fichiers au joueur sur le même disque".
- Player pack (Phase 4) = mécanisme de publication, pas optionnel à long terme pour le profil joueur.
