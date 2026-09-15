# Refonte de la fiche produit

Les valeurs, validations et références du dépôt restent autoritatives. La maquette
sert uniquement à la présentation ; aucun contrôle de démonstration n’a été repris.
La section par défaut reste Identification & traçabilité.

## Fichiers modifiés ou ajoutés

- `app/(protected)/components/editable-card.module.css` : présentation commune, édition bleutée et pied de formulaire.
- `app/(protected)/produits/[id]/product-icon.js` : pictogrammes décoratifs de la fiche.
- `app/(protected)/components/editable-card.js` : carte commune, boutons et cycle de sauvegarde.
- `app/(protected)/components/editing-session.js` : protection des brouillons et liens internes.
- `app/(protected)/confirmation-dialog.js` : libellé d’annulation et type de bouton configurables, mouvement réduit.
- `app/(protected)/produits/[id]/page.js` : structure, résumé Disponible, résolution de la section avant lecture des mouvements, droits.
- `app/(protected)/produits/[id]/product-detail.module.css` : composition de la maquette, contraste, mobile et mouvement réduit.
- `app/(protected)/produits/[id]/product-tabs.js` : liens avec `aria-current`, sélection visible, grille mobile et navigation persistante.
- `app/(protected)/produits/[id]/product-edit-form.js` : identification éditable sur place.
- `app/(protected)/produits/[id]/product-actions.js` : résultat confirmé sans redirection hors section.
- `app/(protected)/produits/product-fields.js` : champs contrôlés facultatifs, contrat de création existant conservé.
- `app/(protected)/produits/delete-product-button.js` : garde facultative dans la fiche et dialogue non annulable pendant la requête.
- `app/(protected)/produits/[id]/pricing-form.js` : prix éditable sur place et confirmation sans écriture lors d’une annulation.
- `app/(protected)/produits/[id]/pricing-actions.js` : lecture tarifaire requise et actualisation de la liste des produits.
- `app/(protected)/produits/[id]/price-history.js` : premier prix distinct, variation sobre et état vide.
- `app/(protected)/produits/[id]/purchase-cost-card.js` : dernière ligne compatible, source et écart secondaire sans changement de calcul.
- `app/(protected)/produits/[id]/packaging-form.js` : ajout commun dans le flux, liste consultable et confirmations protégées.
- `app/(protected)/produits/[id]/packaging-actions.js` : lecture de la section requise pour créer ou supprimer.
- `app/(protected)/produits/[id]/stock-movement-history.js` : portée chargée explicite, sources autorisées et tableau sur bureau et lignes compactes sur mobile.
- `lib/product-pricing.js` : validation monétaire existante déplacée à l’identique, sans dépendance aux données.
- `lib/products.js` : réexport de cette validation et exclusion facultative des conditionnements lors de la lecture.
- `lib/stock-movements.js` : réception source disponible uniquement sur demande autorisée du module appelant.
- `test/product-actions.authorization.integration.test.js` : droits d’action et de lecture combinés.
- `test/products.integration.test.js` : exclusion des conditionnements sensibles.
- `test/stock-movements.integration.test.js` : sources réception et tournée indépendamment demandées.
- `docs/editable-card.md` : contrat réutilisable.
- `docs/product-detail-validation.md` : ce compte rendu.

## Présentation finalisée

En-tête avec pictogramme et résumé, navigation soulignée sur bureau et deux lignes
persistantes sur mobile, titres de section, trois cartes de stock, compteurs dans
l’historique physique, identification à valeurs alignées à gauche, chronologie des
événements disponibles et actions sensibles repliées. La tarification distingue les
deux cartes, leurs sources, le bandeau de comparaison et l’historique en colonnes.
L’ajout de conversion dispose de son propre bandeau éditable au-dessus de la liste.
Les pictogrammes ont une taille explicite, y compris l’horloge du dernier prix.

## Vérifications

Lint ciblé sur les composants, formulaires, actions, services et tests modifiés ;
`git diff --check` sans erreur. Compilation de production réussie avec
`npm run build -- --webpack`.

39 tests ciblés réussis :

```sh
node --env-file-if-exists=.env.local --test test/products.validation.test.js test/products.integration.test.js test/stock-movements.integration.test.js test/product-actions.authorization.integration.test.js
```

Deux vérifications supplémentaires réussies :

```sh
node --env-file-if-exists=.env.local --test --test-name-pattern='dernier coût|dernière ligne de coût' test/reception-actions.authorization.integration.test.js
```

Ces 41 contrôles couvrent notamment la normalisation et l’unicité du code,
l’interdiction de changer l’unité d’un produit utilisé même sans stock actuel,
les références interdisant la suppression, les règles monétaires, les sources
sensibles et la sélection déterministe du dernier coût compatible.

Les parcours intégrés ont été exercés sous Chrome via son protocole DevTools,
sur une instance Next de production avec une base MongoDB temporaire séparée :

- Section par défaut, liens directs de lecture et d’édition, section active et retour/avance navigateur.
- Annulation, réouverture sans brouillon ni erreurs, et retour du focus à Modifier.
- Garde uniquement après modification, conservation ou abandon explicite, et garde avant ouverture d’une action sensible ou d’une source.
- Erreurs d’unicité, d’unité et de réseau, conservation des saisies, focus d’erreur et nouvelle tentative.
- Champs et annulation désactivés pendant la requête ; soumission répétée bloquée immédiatement.
- Fin de sauvegarde synchronisée avec la transition serveur ; réouverture immédiate du prix préremplie avec la valeur confirmée.
- Confirmation du prix annulée sans écriture, sauvegarde confirmée en centimes et actualisation du résumé et de l’historique dans la même section.
- Ajout de conditionnement, aperçu de conversion, filtres, plusieurs pages et annulation d’une suppression.
- Suppression de produit refusée côté serveur lorsqu’il possède des références.
- Lecteurs de prix et d’achats indépendants ; entrées interdites sans formulaire ni source sensible.
- Recherche et états sans résultat ; auteurs absents, prix absent, stock nul/négatif et grands montants.
- Quatre sections à 1440 et 360 px, formulaires et dialogues à 360 px ; aucune liste à défilement interne.
- Composition finale confrontée aux captures de la maquette : pictogrammes, colonnes des historiques, sources, bandeau d’écart, chronologie, ajout séparé et navigation persistante.
- Focus du dialogue, Tab/Maj+Tab et Échap avec les confirmations natives `<dialog>` de l’application.

Captures disponibles dans `/tmp/syphax-product-*.png` ; scripts de vérification
isolés dans `/tmp/syphax-ui-*.mjs`. Les données de test n’appartiennent pas au
produit et les bases temporaires sont supprimées après vérification.

## Limites de validation

Turbopack échoue dans cet environnement sur l’ouverture d’un port local
(`Operation not permitted`), y compris après relance avec autorisation.
La compilation webpack réussit. Les parcours navigateur ont été vérifiés sous
Chrome ; aucun audit avec lecteur d’écran ou autre moteur navigateur n’a été effectué.
La fermeture d’un onglet ou une navigation externe ne fait pas partie de la garde
interne demandée.

Aucune suite complète, écriture de test dans les données réelles, migration,
nouvelle permission, modification de rôle réel, commit ou déploiement.
Les fichiers locaux initiaux `fiche-produit-apercu.html` et `syphax.zip` sont conservés.
