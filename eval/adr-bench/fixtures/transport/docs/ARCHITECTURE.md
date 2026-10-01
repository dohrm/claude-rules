# Extract from Quill `docs/ARCHITECTURE.md`

- L67: | Fédération / échange | port de transport + paquet typé, projection côté MJ | Multi-participant sans serveur, anti-spoiler par projection, offline-first | [0014](adr/0014-federated-local-first-exchange.md) |
- L68: | Transport P2P | iroh (QUIC), identité Ed25519, rendez-vous | Livraison à distance sans remote/domaine ; fallback LAN/mDNS, bundle hors-ligne | [0016](adr/0016-p2p-transport-iroh.md) |
- L69: | Historique | git **local** par nœud (pas de remote) | Timeline/commits ; ne sort du poste que via un paquet transporté | [0014](adr/0014-federated-local-first-exchange.md) |
- L84: - **Egress** : local-first ; sorties réseau limitées aux endpoints LLM configurés et, optionnellement, au remote git partagé (co-MJ).
