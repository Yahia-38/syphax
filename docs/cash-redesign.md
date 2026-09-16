# Refonte de la caisse

La page `/caisse` reprend les cartes et l’édition sur place des fiches produit,
livreur et tournée. Les vues `vue=journal|restes` gardent leurs critères et pages
indépendants. Les filtres GET, les changements de cible et la navigation passent
par la session d’édition commune : un brouillon nécessite un abandon explicite ;
une demande en cours ou incertaine bloque la navigation.

Le solde suivi reste global. Les entrées, sorties et la variation concernent
l’ensemble de la sélection du journal. Le total des restes correspond à toute
la recherche de livreur, avec anomalies et totaux partiels visibles. Les montants
inconnus ne deviennent pas zéro ; une variation négative est affichée en DA.
Les jours restent interprétés par le serveur selon Africa/Algiers.

Le retrait transforme la carte de solde en formulaire. L’encaissement du livreur
transforme sa carte ; le paiement ciblé transforme son bloc tournée. La
confirmation finale reste un dialogue applicatif distinct. Les formulaires
spécialisés gardent leurs demandes figées, clés, protections de concurrence,
résumés stale et rejeux. Le paiement ciblé signale désormais explicitement une
exception serveur comme résultat incertain, sans modifier le service financier.

Le journal reste paginé à dix mouvements et les restes à dix livreurs. Les
listes de tournées et d’affectations disposent d’une recherche et de pages de
cinq lignes. Une répartition globale confirme toujours toutes ses affectations.

Fichiers concernés :

- `app/(protected)/caisse/page.js`, `cash-journal.js`, `cash-remainders.js`.
- `cash-workspace.js`, `cash-form-context.js`, `cash.module.css`.
- `cash-withdrawal-preview.js`, `deliverer-cash-allocation-preview.js`,
  `cash-tour-payment.js`, `cash-journal-allocations.js`.
- `app/(protected)/cash-payment-form.js`, `cash-payment-actions.js`.
- `app/(protected)/components/editable-card.js` : identifiant et notification
  d’ouverture/fermeture facultatifs, permettant de maintenir une saisie dont
  la ligne quitte les résultats serveur.
- `lib/cash-navigation.js`, `lib/cash-payments.js` : navigation locale,
  conservation des paramètres et prise en charge de la vue dans les liens sûrs.
- `test/cash-navigation.test.js`, `test/cash-withdrawals.integration.test.js` :
  navigation ciblée et nom de base temporaire raccourci pour respecter la limite
  MongoDB de 63 caractères avec les PID actuels.

Vérifications exécutées le 16 septembre 2026 :

- 68 tests ciblés : `cash-navigation`, `cash-payment-calculations`,
  `cash-withdrawal-calculations`, `cash-payments.integration`,
  `cash-withdrawals.integration`. Les tests d’intégration utilisent des bases
  MongoDB temporaires et vérifient les transactions, le rejeu et les opérations
  concurrentes des services existants.
- ESLint sur les fichiers JavaScript modifiés ; build `npm run build -- --webpack`.
- Chrome sur une base temporaire : deux vues et filtres indépendants ; total
  du journal sur toutes les pages ; répartition de sept tournées avec une seule
  ligne affichée par recherche et sept affectations confirmées ; blocage de
  navigation pendant l’envoi ; fermeture et référence après succès.
- Paiement d’une tournée terminée, réponse introuvable et réessai figé ; retrait
  inline, montants invalides/trop élevés, motif, focus sur première erreur,
  conflit sans écriture, champs conservés et nouvelle confirmation.
- Encaissement global stale sans écriture ; réponse perdue après une écriture
  effective, résumé/clé figés et rejeu résolu sans doublon.
- Règlement concurrent retirant une tournée des restes sans perdre sa saisie ;
  choix continuer/abandonner ; fonds initial absent autorisant encore le choix
  d’encaissement ; plusieurs caisses actives rendant les actions indisponibles.
- Captures bureau et mobile sans débordement horizontal ; lecteur caisse et
  encaisseur sans liens vers les fiches non autorisées.

Limites de la vérification initiale : `caisse-apercu.html` n’était pas présent dans le dépôt. L’apparence
suit le prompt fourni et le système de cartes existant ; aucune comparaison
visuelle directe avec cette maquette n’a été possible. La couverture clavier
n’est pas exhaustive. Les projections financières et services transactionnels
n’ont pas été refondus. Aucune écriture de vérification n’a été effectuée dans
la caisse réelle. Aucun commit, déploiement, migration ou nouvelle permission.

## Comparaison avec la maquette disponible

La comparaison du 16 septembre 2026 utilise désormais `caisse-apercu.html`,
ouvert dans Chrome à côté de l’application sur une base MongoDB temporaire.
Les vues journal et restes, le formulaire d’encaissement du livreur et le retrait
sont comparés à 1440 et 390 pixels, avec captures et contrôle du débordement.

Corrections : fond et typographie, solde vert et montant dans l’en-tête,
carte de choix et onglets, titre du journal au-dessus de la carte, bandeau de
sélection et totaux sur une ligne, badges des mouvements, date et heure sur
deux lignes, noms des livreurs au-dessus des codes, recherche des restes et
total sur toute la largeur, avatars et restes dans l’en-tête des livreurs,
statut des frais, champs et aperçus compacts, répartition à quatre colonnes.
Le retrait occupe toute la largeur et la carte de choix est masquée sur mobile.
Les actions autorisées mais indisponibles restent visibles et désactivées.
La mise en forme de la navigation principale est limitée à `/caisse`.

Les données affichées proviennent de l’application ; les outils de scénarios
fictifs de la maquette ne sont pas intégrés. La déconnexion reste accessible.
Les listes de tournées et d’affectations conservent recherche et pagination.

Validation : 16 tests ciblés de navigation et calculs, ESLint sur les composants
modifiés, build de production Webpack et parcours Chrome isolés : encaissement
de sept tournées malgré une recherche ne montrant qu’une affectation,
paiement ciblé, retrait, erreurs de saisie et focus, conflits sans écriture,
réponses perdues et rejeu sans doublon, protection de navigation et brouillons,
règlement concurrent retirant une ligne des résultats, profils de lecture et
d’encaissement, fonds initial absent et plusieurs caisses actives.
