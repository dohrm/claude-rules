# ADR-0014 : Fédération local-first — topologie asymétrique, projection côté MJ, port de transport

**Statut :** Accepté
**Date :** 2026-07-24
**Amende :** [ADR-0001](0001-local-first-campaign-tool.md) (périmètre single-user)
**Références :** [ADR-0005](0005-gm-player-profiles.md), [ADR-0009](0009-temporal-facts-and-scopes.md), [ADR-0016](0016-p2p-transport-iroh.md) (transport concret), `docs/PRD.md`

## Contexte

ADR-0001 a posé un outil **strictement mono-utilisateur** : un workspace par personne, handoff **unidirectionnel** MJ → joueur par export. Le PRD (juillet 2026) fait apparaître quatre flux que ce cadre ne couvre pas :

1. les joueurs veulent **consulter** fiches et récaps ;
2. les joueurs **écrivent** des notes que le MJ récupère ;
3. la **fiche du PJ** circule joueur → campagne sans copier-coller ;
4. un **co-MJ** écrit dans la campagne aux côtés du MJ.

Trois de ces flux vont dans le sens **joueur → campagne**, absent d'ADR-0001. Le PRD tranche pour un modèle **local-first fédéré** (chacun son workspace, données échangées) et rejette le serveur central, le temps réel multi-postes et l'ACL runtime.

Contrainte dure : **la protection anti-spoiler ne peut pas reposer sur un partage de disque.** Donner à un joueur un accès (clone, dossier synchronisé) au contenu MJ expose les spoilers, quelle que soit l'isolation applicative — c'est le motif du refus d'ACL runtime dans ADR-0001.

Enfin, un constat de conception : le débat « git vs bundles vs P2P » mélangeait deux préoccupations **orthogonales** — *ce qui* circule (sémantique) et *par quel tuyau* (transport). Les séparer clarifie ce qui est durable (le modèle de confiance) et ce qui est remplaçable (le tuyau).

## Décision

Nous adoptons une **fédération local-first sans serveur de campagne**, en couches, où la sémantique d'échange est stable et le transport est enfichable.

### Couches (du durable au remplaçable)

1. **Offline-first** — l'application est **pleinement fonctionnelle sans réseau** : édition, agent, recherche, historique local. L'échange entre participants est une **couche d'enrichissement en ligne**, jamais un prérequis.
2. **Historique local** — chaque nœud versionne son workspace en local (commits/timeline, façon git). **Aucun remote, aucun nom de domaine requis** : l'historique ne sort du poste que sous forme de paquet transporté.
3. **Paquet typé** — l'unité d'échange : `MàJ de fiche PJ`, `lot de notes`, `player pack projeté`, avec émetteur, destinataire et version de base. Vit dans le core, indépendant du transport.
4. **Projection / filtre anti-spoiler** — réalisée **côté MJ, avant émission** (extension d'[ADR-0009](0009-temporal-facts-and-scopes.md)). Le contenu spoiler n'est **jamais écrit** dans le paquet destiné au joueur — la protection vient du filtrage, pas d'un ACL runtime ni d'un disque masqué.
5. **Port de transport** — une **frontière (port hexagonal)** `publish(packet)` / `receive() -> packet`. Aucun engagement techno à ce niveau. Adaptateurs : **transport P2P** (cible, [ADR-0016](0016-p2p-transport-iroh.md)) et **bundle portable** (fichier autoportant, canal hors-ligne pour le joueur léger).

### Topologie asymétrique (l'anti-spoiler vient de la projection)

- **Co-MJ** — participant de confiance : réplique **complète** du workspace, réconciliation par la couche historique. Aucun filtrage (un co-MJ est un MJ).
- **Joueur** — ne reçoit **jamais** le workspace campagne. Il détient son propre workspace (son PJ, ses notes).
  - Joueur → campagne : publie ses **données propres** (aucun spoiler) ; le MJ les **reçoit/importe**.
  - Campagne → joueur : le MJ publie une **projection filtrée** (player pack : journal, récaps, entités `scope: public|player`) — un **artefact distinct**, jamais le workspace campagne.
- **Multi-poste d'un même utilisateur** — plusieurs nœuds *de confiance* répliquant le même workspace ; réconciliés par la **même couche historique** que le co-MJ (mirror), pas un mécanisme dédié.

### Invariants d'ADR-0001 conservés

Pas de serveur de campagne partagé, pas de synchronisation temps réel, **pas d'ACL runtime**. Ce qui change : le périmètre passe de *single-user* à *multi-participant fédéré*, et le handoff devient **bidirectionnel et filtré**.

### Question laissée ouverte

Le **modèle fin de droits / de projection** — quelles métadonnées portent le `scope`, granularité du filtrage, vérification de non-fuite — n'est pas arrêté ici. Cet ADR fixe la topologie, les couches et le principe « protection par projection, jamais par disque partagé ». Le mécanisme détaillé fera l'objet d'un ADR dédié.

## Conséquences

### Positives
- Sépare le **durable** (modèle de confiance, projection, couches) du **remplaçable** (transport) : changer de tuyau ne touche pas le core.
- **Dissout l'objection remote git** : l'historique reste local, un transport livre les paquets — aucun remote ni nom de domaine.
- Offline-first strict : l'outil ne dépend d'aucune infra pour son usage solo.
- Le joueur léger reste trivial (bundle portable, aucun compte).
- L'anti-spoiler ne repose sur aucune promesse de sécurité applicative fragile : ce qui n'est pas projeté n'existe pas chez le joueur.

### Négatives
- Deux adaptateurs de transport à supporter (P2P + bundle) et deux sens d'échange à outiller (publier / recevoir).
- La réconciliation (co-MJ, multi-poste) impose une résolution de conflit **manuelle** (acceptée, PRD).
- La projection filtrée devient un mécanisme **critique** (une fuite = un spoiler) : à tester sérieusement quand le modèle de droits sera arrêté.

### Neutres
- Le player pack d'ADR-0001 n'est pas jeté : il devient le paquet **campagne → joueur** de la projection bidirectionnelle.
- Le profil `player` (ADR-0005) reste une posture cognitive ; il gagne un sens opérationnel (« ce qu'on projette vers ce rôle »).

## Alternatives considérées

- **git comme substrat d'échange (remote/fork partagé)** — rejeté : impose un remote (serveur, nom de domaine) et un clone expose les spoilers sur le disque du joueur. git est conservé **uniquement** comme historique **local**.
- **Dossier synchronisé (Syncthing / drive)** — rejeté : couche de sync contraire à l'épine « pas de sync » d'ADR-0001, conflits concurrents ingérables, partage de disque = fuite spoiler.
- **Transport unique figé (choisir P2P *ou* bundle définitivement)** — rejeté : le port permet le bundle hors-ligne **et** le P2P en ligne sans re-décider le modèle.
