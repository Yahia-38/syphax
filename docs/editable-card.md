# Édition sur place

`app/(protected)/components/editable-card.js` fournit une présentation indépendante
des produits. `EditingSessionProvider` délimite la zone de navigation protégée.

## Contrat

- `title`, `description` : contexte stable du bloc.
- `titleIcon`, `className` : pictogramme et apparence fournis par le module.
- `creation` : bandeau de création en lecture, carte bleutée pendant la saisie.
- `editingLabel` : « Modification en cours » par défaut, configurable pour un ajout.
- `canEdit` : affichage de l’action (le module contrôle également ses droits serveur).
- `initiallyOpen` : entrée directe en édition, uniquement si `canEdit`.
- `children` : lecture des dernières valeurs serveur.
- `formComponent`, `formProps` : composant de formulaire propre au module.
- `editLabel` : « Modifier » par défaut, « Ajouter » pour une création.
- `keepReadContent` : conservation facultative du contenu de lecture. La fiche
  affiche la liste de conditionnements dans une carte distincte du bloc d’ajout.
- `onSaved` : effet local après succès, par exemple réinitialiser les filtres.

Le formulaire reçoit `onCancel`, `onSuccess(message)` et `onPending(boolean)`.
Il garde ses champs contrôlés, leurs validations, erreurs et confirmation métier.
`onSuccess` doit être appelé uniquement après la réponse serveur réussie et la
revalidation des données. La carte démonte le formulaire : annulation et succès
suppriment les saisies, erreurs et confirmations ; la prochaine ouverture utilise
les dernières propriétés serveur. Le focus revient à l’action textuelle.

`useInlineSave` est une aide facultative pour les actions existantes renvoyant
`{ errors, revision, values, message }`. Il conserve les champs lors d’un échec,
verrouille immédiatement les soumissions concurrentes, attend la fin de la transition
`useActionState` (réponse et valeurs serveur revalidées), transmet l’état en cours
à la session et focalise la première erreur de champ, sinon l’alerte générale
(`tabIndex={-1}`). Le module fournit le message d’échec réseau et les
`EditingButtons`, et désactive ses champs pendant la requête. Il reste responsable
de la revalidation côté serveur. Aucune règle métier ou monétaire n’appartient
à la carte.

Le hook transmet aussi le résultat complet à `onSuccess(message, result)` pour
un récapitulatif de création fondé sur les données serveur. `EditingButtons`
accepte `submitLabel`, `pendingLabel` et `note` ; ses valeurs par défaut restent
celles de l’édition. Capturer `FormData` avant d’appeler `save`, puis désactiver
les champs avec le `pending` renvoyé par le hook.

`EditingSessionProvider creation` emploie les libellés « Continuer la saisie »
et « Quitter sans créer ». Dans ce mode, il protège également les liens internes
de la navigation générale, sans changer son apparence. Le formulaire inscrit
son brouillon et son état en cours via `register`.

La session compare les valeurs nommées du formulaire à leur état à l’ouverture.
Un retour à cet état ne déclenche aucune confirmation. `EditingLink` utilise
`Link.onNavigate` pour les liens internes de la zone ; `session.request(callback)`
protège l’ouverture d’un autre bloc. Le dialogue applicatif permet de poursuivre
ou de quitter sans enregistrer. Les entrées d’historique internes sont repérées
pour restaurer un retour/avance bloqué sans créer une nouvelle entrée. La session
ne tente pas de bloquer une fermeture d’onglet ou une navigation externe.

Pour une confirmation métier, ouvrir `ConfirmationDialog` depuis le formulaire
et appeler `save` uniquement après confirmation. Une fermeture du dialogue ne
soumet rien et conserve les valeurs. Employer `confirmType='button'` pour une
soumission pilotée ; le comportement historique par défaut reste `submit`.

La validation du prix a été déplacée à l’identique dans `lib/product-pricing.js`,
module sans accès aux données, réexporté par `lib/products.js`. Le formulaire et
le service utilisent ainsi les mêmes règles de centimes et décimales.
