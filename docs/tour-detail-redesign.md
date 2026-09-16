# Fiche tournée

La route `/tournees/[id]` comporte les vues Opérations, Produits & chargement et
Traçabilité. Le retour livreur validé, sa section et ses filtres restent imbriqués
dans `retour`. La synthèse de tournée affiche les valeurs persistées de la
projection caisse ; les calculs de saisie sont explicitement des prévisualisations.

Les cartes utilisent l’enveloppe partagée EditableCard avec une session de
brouillon unique. Les formulaires, Server Actions, digests, clés, permissions et
services transactionnels existants sont conservés. Une projection d’action peut
disparaître lors d’un succès serveur : l’éditeur retient sa dernière projection
jusqu’au traitement du résultat, puis ferme la saisie et annonce le succès.

Fichiers concernés : page et formulaires de `app/(protected)/tournees/[id]`,
`tour-detail.js`, `tour-detail.module.css`, `tour-operation-card.js`,
`tour-operation-context.js`, enveloppe EditableCard, session d’édition et
CashPaymentForm. Navigation : `lib/tour-detail-navigation.js` et son test.
Les modifications livreur et la compatibilité de `lib/tours.js` étaient déjà
présentes ; elles sont conservées.

Vérifications exécutées :

- ESLint ciblé et `git diff --check` sans erreur.
- `npm run build -- --webpack` réussi. Turbopack rencontre EPERM lors de
  l’ouverture d’un port de traitement des styles dans cet environnement.
- Tests ciblés des calculs comptage/frais/versements, navigation imbriquée et
  autorisations des actions de tournée, de clôture et de versement.
- Sélection de tests MongoDB existants : comptage au-delà d’une page, limites,
  rollback comptage/frais, rejeux, digests périmés, frais/paiement concurrents,
  clôture avec reste, versement après clôture, conversion et réservations.
- Chrome, bureau 1440 px et mobile 390 px : retours vides et zéro explicite,
  huit lignes sérialisées malgré filtres/pagination, prochaine ligne et focus,
  erreurs réseau avec champs conservés, frais multiples et retrait médian,
  choix zéro frais, confirmation d’abandon, droits indépendants, absence
  historique et valeurs inconnues sans faux solde, absence de débordement mobile.
- Chrome sur base isolée : versement partiel avant frais, blocage du double envoi
  et de la navigation pending, frais périmés après changement des encaissements,
  relecture sans écriture et nouvelle confirmation, déclaration définitive,
  clôture avec reste sans versement supplémentaire, paiement exact après clôture,
  action masquée une fois soldée, réservation/libération et annulation motivée.

Les tests utilisent des bases temporaires, supprimées après vérification.
La tournée réelle fournie n’a pas été modifiée. Aucun commit, déploiement,
seed client ou migration n’a été effectué. La navigation et pagination des
historiques longs sont conservées ; leur couverture visuelle exhaustive n’a
pas été exécutée. Les conflits de production restent hors de cette vérification.
