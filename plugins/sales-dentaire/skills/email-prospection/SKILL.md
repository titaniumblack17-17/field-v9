---
name: email-prospection
description: Rédige des e-mails de prospection à froid pour du matériel dentaire, adaptés à la marque du portefeuille la plus pertinente pour le cabinet ciblé (18 marques représentées pour Bailleul et So Dental). À activer une fois un prospect qualifié (voir prospect-research) pour produire le premier contact écrit. Réservé à la vente d'équipement dentaire, Île-de-France.
---

# Email Prospection

## When to Activate

Activer pour rédiger un e-mail de prospection à froid vers un cabinet
dentaire, une fois le prospect qualifié et l'angle d'approche identifié
(voir `prospect-research`).

**Ne pas activer** pour : une relance sur un dossier déjà engagé dans le
pipeline (voir `relance-pipeline`) ; qualifier le prospect avant de savoir
quoi lui écrire (voir `prospect-research`) ; choisir l'argumentaire ou
répondre à une objection déjà reçue (voir `sales-strategy`, plugin
`sales-strategy`).

## Core Concepts

Un praticien lit son e-mail entre deux patients — la contrainte de forme
prime sur le contenu commercial classique :

- **Objet court et concret**, jamais générique ("Équipement dentaire" ne
  se distingue pas d'un spam ; "Autoclave plus rapide pour [cabinet]" se
  lit).
- **Accroche personnalisée**, appuyée sur un signal réel trouvé via
  `prospect-research` (pas une formule passe-partout).
- **Une seule marque, un seul besoin** par e-mail — un catalogue de 18
  marques envoyé d'un coup se lit comme un e-mail générique, pas comme une
  offre pensée pour ce cabinet précis.
- **CTA simple et à faible engagement** — un échange de 15 minutes, pas un
  rendez-vous d'une heure ni un devis à ce stade.
- **Crédibilité** — mention de Bailleul/So Dental et de l'ancrage
  Île-de-France plutôt qu'un argumentaire produit développé.

## Practical Guidance

1. Partir de la qualification produite par `prospect-research` — angle
   d'approche, spécialité(s) du praticien, signal repéré.
2. Choisir UNE marque du portefeuille pertinente pour ce signal (voir
   `references/marques.md`) plutôt que de lister l'ensemble du
   portefeuille.
3. Structurer : objet → accroche personnalisée (le signal) → proposition de
   valeur ciblée sur cette marque/ce besoin → CTA court.
4. Relire pour la longueur — si l'e-mail dépasse cinq phrases courtes, le
   couper.

## Gotchas

- Envoyer un e-mail générique parce que la qualification manque
  d'information plutôt que de l'activer trop tôt (voir
  `prospect-research`).
- Multiplier les marques dans le même e-mail — ça dilue le message et
  donne l'impression d'un envoi de masse.
- Ton trop commercial ou trop long — un praticien pressé abandonne à la
  deuxième phrase si elle ne parle pas directement de son cabinet.

## Integration

En aval de `prospect-research` (qui fournit l'angle et le signal). En amont
de `sales-strategy` une fois une réponse reçue (choix du cadre pour la
suite de l'échange) et de `relance-pipeline` si le dossier entre dans le
pipeline Field V9 sans réponse immédiate.

## References

- `references/marques.md` — les 18 marques du portefeuille, avec leur
  positionnement quand disponible. **Incomplet à ce stade** : la majorité
  des entrées attendent le positionnement de Bruce (voir la note en tête du
  fichier) — ne pas improviser un argumentaire de marque non confirmé.
