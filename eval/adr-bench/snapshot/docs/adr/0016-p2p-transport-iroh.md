# ADR-0016 : Transport P2P — iroh, identité Ed25519, rendez-vous, offline-first

**Statut :** Accepté
**Date :** 2026-07-24
**Implémente :** le port de transport d'[ADR-0014](0014-federated-local-first-exchange.md)
**Références :** [ADR-0001](0001-local-first-campaign-tool.md)

## Contexte

[ADR-0014](0014-federated-local-first-exchange.md) définit un **port de transport** `publish(packet)` / `receive()` sans engager de techno. Il faut un adaptateur qui livre les paquets entre workspaces **sans serveur de campagne**, à distance comme à la table.

Deux besoins réseau se dégagent du PRD :

- le joueur publie sa fiche / ses notes **depuis chez lui** (à distance) ;
- le play mode se déroule **à la table** (même réseau local).

Une intuition de conception a émergé : un modèle **P2P avec le poste MJ comme hub**, un **serveur de coordination léger** ne détenant aucune donnée campagne (juste un annuaire), une **identité de nœud** générée à l'installation, et un pairing par invitation.

Deux écueils à cette intuition brute :

1. **Un annuaire `ID → IP` ne suffit pas à connecter deux pairs derrière NAT.** Il faut en plus : découverte de l'endpoint public (STUN-like), coordination du hole-punching, et **relais de repli** quand le hole-punch échoue (~10-20 % des NAT symétriques) — le relais transporte alors des octets (chiffrés).
2. **Un `UUIDv5` est spoofable** : déterministe, non secret, il ne prouve pas l'identité du pair.

Ces deux problèmes sont **déjà résolus** par des briques éprouvées ; les réimplémenter serait un projet réseau à part entière, hors scope produit.

## Décision

Nous implémentons le port de transport d'ADR-0014 avec **[iroh](https://github.com/n0-computer/iroh)** (Rust, QUIC).

- **Connexions** — QUIC directes entre nœuds, chiffrées de bout en bout. iroh fournit nativement découverte, hole-punching et **relais de repli** ; nous **ne hand-rollons ni STUN, ni hole-punch, ni relais**.
- **Identité = clé publique Ed25519** (`NodeId` iroh), générée à l'installation de Quill. Auto-certifiante (le pair prouve la possession de son ID en signant) → règle le spoofing **et** le chiffrement d'un coup. Remplace l'idée d'UUIDv5.
- **Rendez-vous** — un relai iroh (public, ou self-hébergé — binaire Rust déployable sur l'infra k3s existante) sert la découverte et le fallback. Il **ne détient aucune donnée campagne, aucune logique métier** : c'est de l'infra de mise en relation, pas un serveur de campagne (ADR-0001 tient). Configurable, valeur par défaut fournie.
- **Pairing** — le MJ émet une **invitation** contenant son `NodeId` ; le joueur se connecte ; le MJ **autorise** le `NodeId` du joueur dans l'**allow-list de sa campagne**. La décision de confiance vit **côté MJ**, jamais sur le rendez-vous → pas d'ACL serveur (ADR-0001).
- **Offline-first / dégradation gracieuse** :
  - **pas de réseau** → pas de P2P, l'application reste pleinement fonctionnelle en solo (ADR-0014, couche offline-first) ;
  - **LAN / à la table** → découverte locale (mDNS), échange **sans** le rendez-vous ;
  - **distant** → rendez-vous pour la mise en relation, puis QUIC direct (ou relais si NAT hostile).
- **Charge utile** — le transport livre les **paquets typés** d'ADR-0014 (lot de commits de l'historique local, ou projection filtrée). Le filtrage anti-spoiler reste **en amont, côté MJ**.
- **Multi-poste d'un même utilisateur** — deux `NodeId` de confiance répliquant un workspace ; réconciliation par la couche historique d'ADR-0014, pas par le transport.

## Conséquences

### Positives
- Livraison automatique à distance **sans** remote git, nom de domaine, ni serveur de campagne.
- Sécurité (identité + chiffrement) fournie par la clé de nœud, sans infra d'auth.
- Coût de déploiement du rendez-vous marginal (binaire Rust, k3s ; relais publics en secours).
- Dégradation propre : solo offline, LAN sans infra, distant avec rendez-vous.
- iroh absorbe la complexité NAT : pas de code réseau maison à maintenir.

### Négatives
- **Dépendance lourde** (iroh + QUIC) et **à valider par un POC** avant industrialisation (le statut *Accepté* engage la direction, pas l'absence de risque d'implémentation).
- Le rendez-vous est **une pièce d'infra always-on** à maintenir — seule entorse au « 100 % local-first », atténuée par le fallback LAN et l'absence de données.
- Le relais de repli transporte des octets (chiffrés) dans les cas NAT défavorables : à documenter côté confidentialité.
- iroh est un écosystème en évolution : **pin de version**, comme pour tout client 0.x.

### Neutres
- Le transport **bundle portable** d'ADR-0014 reste disponible en parallèle (canal hors-ligne, joueur sans réseau).
- Aucune incidence sur `tools/core` / `core` / l'agent : le transport est derrière le port d'ADR-0014.

## Alternatives considérées

- **Annuaire maison `ID → IP` + hole-punch/relais maison** — rejeté : réimplémente STUN/TURN/ICE, projet réseau majeur, précisément la roue qu'iroh fournit.
- **`UUIDv5` comme identité** — rejeté : spoofable, n'apporte ni preuve d'identité ni chiffrement ; la clé Ed25519 fait les trois.
- **libp2p** — écarté par défaut : plus généraliste et lourd que le besoin (transfert de paquets entre pairs connus) ; iroh est plus ciblé QUIC + relais. Réexaminable si iroh se révèle insuffisant au POC.
- **WebRTC datachannels** — écarté : orienté navigateur/média, stack de signaling à porter côté desktop Rust sans gain sur iroh.
