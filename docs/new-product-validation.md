# Création d’un produit

La page `/produits/nouveau` reprend la maquette locale sans données ni contrôles
de démonstration. Le formulaire utilise les champs, boutons, cycle de sauvegarde
et dialogue communs à la fiche produit.

## Comportement

- Désignation, code et unité obligatoire, avec quatre radios natifs sans sélection
  par défaut. Normalisation française du code à la sortie du champ ; les espaces
  intérieurs restent soumis au refus serveur.
- Conditionnement facultatif dépliable, focus au libellé, conversion selon l’unité.
  La désactivation vide les champs et retire uniquement leurs erreurs ; les champs
  démontés sont exclus de FormData. Une option active vide est validée et refusée.
- Aperçu explicitement marqué brouillon, sans persistance ni annonces à chaque
  frappe. Disposition formulaire/actions/aperçu sur mobile.
- Erreurs conservant les saisies, focus au premier champ invalide ou à l’alerte,
  verrou immédiat des doubles soumissions et état pending accessible.
- Dialogue applicatif avant d’abandonner un brouillon modifié, garde sur les liens
  internes de la page et de la barre de navigation. Aucun dialogue sur un brouillon
  vide ; navigation interne bloquée pendant la requête.
- Succès stable fondé sur les valeurs validées et l’ID du résultat serveur, ouverture
  de fiche uniquement avec products.read et nouveau formulaire entièrement vide.
  Un créateur sans lecture retourne au tableau de bord autorisé.

La page et l’action exigent products.create. Le conditionnement initial conserve
ce contrat, sans packaging.create supplémentaire. Le produit et ce conditionnement
restent insérés ensemble dans un document ; aucun prix, stock ou mouvement n’est
créé. Les vues de produits sont revalidées après succès.

## Fichiers

- `app/(protected)/produits/nouveau/page.js`, `product-form.js`,
  `product-form.module.css`, `actions.js` : intégration du parcours.
- `app/(protected)/produits/product-fields.js`, `product-fields.module.css` :
  champs partagés, variante de création et radios.
- `app/(protected)/components/editable-card.js`, `editing-session.js` : libellés
  configurables, résultat transmis au callback de succès, focus après réactivation
  et garde de création ; comportements d’édition par défaut conservés.
- `lib/products.js` : conditionnement validé dans le résultat de création,
  sans modification de l’opération de persistance.
- `test/product-actions.authorization.integration.test.js` : contrôles ciblés de
  création, validations, autorisation, doublon et panne de persistance/réessai.
- `docs/editable-card.md` : contrat des extensions communes.

## Vérifications

Lint ESLint ciblé sans avertissement, `git diff --check`, compilation de production
avec `npm run build -- --webpack`.

15 tests ciblés réussis, utilisant une base MongoDB temporaire pour l’intégration :

```sh
node --env-file-if-exists=.env.local --test test/products.validation.test.js
node --env-file-if-exists=.env.local --test --test-name-pattern='création refondue|création sans products.create' test/product-actions.authorization.integration.test.js
```

Parcours Chrome sur une instance locale de production et une base distincte :
champs obligatoires, radios au clavier, normalisation, conditionnement partiel et
désactivation, doublon, erreur réseau/réessai, requête retenue et double soumission,
valeurs réellement persistées et ID du lien, nouveau formulaire vide, annulation
vide/remplie, navigation générale, dialogue avec Tab/Maj+Tab/Échap et retour du
focus, création seule et refus sans droit, ainsi qu’édition d’identification avec
les composants partagés. Captures bureau et mobile à 360 px, noms longs et absence
de débordement, y compris le dialogue et le succès.

Scripts et captures : `/tmp/syphax-create-ui-*.mjs`, `/tmp/syphax-create-*.png`.
Les bases temporaires sont supprimées après la vérification.

## Limites

Validation effectuée sous Chrome, sans lecteur d’écran ni autre moteur navigateur.
La garde protège les liens internes ; fermeture d’onglet, navigation externe et
retour navigateur vers une entrée extérieure à la zone d’édition ne sont pas
interceptés. Un accès sans products.create conserve le refus serveur existant.
L’environnement impose une autorisation réseau pour MongoDB et les ports locaux.

Aucune suite complète, écriture de test dans les données réelles, nouvelle
permission, dépendance, migration, modification de rôle, commit ou déploiement.
Les fichiers locaux initiaux `nouveau-produit-apercu.html` et `syphax.zip` sont
conservés.
