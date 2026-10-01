# ADR-0013 : Wikilinks & backlinks — vault Obsidian-compatible

**Statut :** Accepté
**Date :** 2026-07-24
**Tickets :** —
**Contexte source :** réflexion « modèle d'instance type Obsidian » (juillet 2026)

## Contexte

Le stockage d'instance de Quill est **déjà** un vault markdown : une entité =
un fichier `.md` (frontmatter YAML + corps), rangé par dossier de type, avec
tags/alias et recherche plein-texte. Le seul écart avec Obsidian portait sur les
**liens** : aujourd'hui les relations sont de la prose (`## Relations`), des
`participants: [semantic_id]` en frontmatter d'intrigue, ou une résolution par
nom au runtime. Ni `[[wikilink]]` inline, ni backlinks.

[ADR-0010](0010-rejected-technical-scope.md) a rejeté une base graphe
(Neo4j/Graphiti) comme disproportionnée, tout en actant la voie de sortie :
« les relations vivent en markdown ; si besoin → **graphe en mémoire depuis le
frontmatter** », condition de réouverture « besoin relationnel récurrent ». Cet
ADR acte ce besoin et tranche l'implémentation.

## Décision

### Interop réelle avec Obsidian.app, gratuite par alignement

L'objectif est que le dossier d'instance s'ouvre tel quel comme vault Obsidian
**et** que Quill rende les liens dans sa propre UI. L'alignement est gratuit :

- **Cible canonique d'un lien = `semantic_id` = nom de fichier.** Obsidian
  résout `[[sheriff_marcus]]` vers `sheriff_marcus.md` par nom de fichier ;
  Quill résout le même `semantic_id`. Les deux outils s'accordent sans
  divergence. Un nom d'affichage (`[[Sheriff Marcus]]`) est toléré en fallback
  (name/alias, exact uniquement).
- **`fiche.yaml` reste un sidecar.** Obsidian ignore les fichiers YAML ; Quill
  garde la fiche typée. On **ne fusionne pas** la fiche dans le frontmatter.

### Division du travail : écriture dans Obsidian, lecture dans Quill

Le corps des entités n'est pas éditable dans l'UI Quill (seuls les tags le
sont). On assume cette division : Obsidian fournit l'autocomplétion `[[`, le
graphe et les backlinks natifs à l'écriture ; **Quill rend, navigue et affiche
les backlinks à la lecture**. Pas d'éditeur de corps ni d'autocomplétion `[[`
côté Quill.

### Implémentation

- **Rendu** : comrak `wikilinks_title_after_pipe` → `<a href="<semantic_id>"
  data-wikilink="true">`. Le front intercepte `a[data-wikilink]`, résout la
  cible et navigue.
- **Résolution** (`entity::resolve::resolve_link`) : `semantic_id` exact
  d'abord, sinon name/alias exact ; prefix/substring **rejetés** (un lien doit
  être non ambigu, contrairement à la recherche). Lien non résolu = *dangling*,
  inerte, jamais une erreur.
- **Backlinks** (`entity::links`) : index **en mémoire, reconstruit à la
  demande** — une passe de lecture sur les `.md` d'instance, extraction des
  `[[…]]` du corps + `participants` des intrigues, inversion cible → sources.
  Pas de persistance : quelques dizaines de fichiers tiennent en RAM. C'est le
  « graphe en mémoire depuis le frontmatter » d'ADR-0010.

## Conséquences

### Positives

- Interop Obsidian sans format propriétaire ni divergence de résolution.
- Backlinks sans DB ni index persistant à invalider.
- Réutilise `resolve_entities` (recherche) et le parsing frontmatter existants.

### Négatives

- Ambiguïté possible si deux entités de types différents partagent un
  `semantic_id` : la résolution prend le meilleur score. Acceptable à l'échelle.
- L'index backlinks est recalculé à chaque appel. Trivial au volume visé ;
  à revoir seulement si le nombre de fichiers explose.

### Neutres

- Pas de graphe persistant ni de vue graphe côté Quill : Obsidian les fournit.
- N'ouvre pas la porte à une base graphe (ADR-0010 tient).
