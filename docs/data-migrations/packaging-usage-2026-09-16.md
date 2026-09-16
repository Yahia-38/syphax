# Inventaire des conditionnements — mapping approuvé et appliqué

Base : syphax. Généré le 2026-09-16T18:26:01.971Z.

8 produits ; 8 conditionnements.
Les palettes sont proposées pour la réception, les packs pour la vente. Les autres libellés nécessitent une décision explicite.
Le tableau et le JSON conservent l’état observé avant migration. Les unités de base ne sont pas des conditionnements à reclasser.

## Résultat de la migration

Mapping approuvé par l’utilisateur et appliqué le 16 septembre 2026 à la base `syphax` : 8 packs classés `SALE`, aucun conditionnement déjà classé, aucune palette présente.
La lecture après validation de la transaction confirme les 8 usages `SALE`.
Seul `packagings[].usage` a changé. Les documents produits complets ont été vérifiés dans la transaction : identifiants, quantités, prix et historiques de prix conservés. Les empreintes des collections historiques ci-dessous sont inchangées.
Sauvegarde BSON complète avant migration : `.backups/packaging-usage-2026-09-16.ejson` (exclue de Git).

| Produit | Conditionnement | Quantité en unités de base | Usage actuel | Usage proposé | Prix (DZD) | Versions de prix |
| --- | --- | --- | --- | --- | --- | --- |
| HB-BLANCHE-1L | Pack de 6 bouteilles | 6 BOUTEILLE | Usage à définir | Vente uniquement | 520.00 | 2 |
| HB-BLANCHE-2L | Pack de 6 bouteilles | 6 BOUTEILLE | Usage à définir | Vente uniquement | 880.00 | 1 |
| HB-SELECTO-1L | Pack de 6 bouteilles | 6 BOUTEILLE | Usage à définir | Vente uniquement | 520.00 | 1 |
| HB-SELECTO-2L | Pack de 6 bouteilles | 6 BOUTEILLE | Usage à définir | Vente uniquement | 580.00 | 1 |
| HB-SLIM-CITRON-1L | Pack de 6 bouteilles | 6 BOUTEILLE | Usage à définir | Vente uniquement | 520.00 | 1 |
| HB-SLIM-CITRON-2L | Pack de 6 bouteilles | 6 BOUTEILLE | Usage à définir | Vente uniquement | 580.00 | 1 |
| HB-SLIM-ORANGE-1L | Pack de 6 bouteilles | 6 BOUTEILLE | Usage à définir | Vente uniquement | 520.00 | 1 |
| HB-SLIM-ORANGE-2L | Pack de 6 bouteilles | 6 BOUTEILLE | Usage à définir | Vente uniquement | 580.00 | 1 |

## Historique à conserver

- receptions : 0 documents ; SHA-256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
- tours : 1 documents ; SHA-256 c9904b8152b9cc6667c2596f709aed97c161e361f0df5e0f6b8149b7a9a65184.
- tourReservations : 0 documents ; SHA-256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
- tourCountings : 0 documents ; SHA-256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
- tourExpenses : 0 documents ; SHA-256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
- stockMovements : 0 documents ; SHA-256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.

## Procédure de migration

Revoir les lignes et corriger uniquement `proposedUsage` dans le JSON si nécessaire (`RECEPTION`, `SALE` ou `BOTH`).
Exécuter le script avec `--apply <inventaire.json> --backup <sauvegarde.ejson>` après validation du mapping.
La sauvegarde contient les produits complets avant migration. La transaction ne modifie que `packagings[].usage` et vérifie la conservation des produits et des historiques.
Un usage de vente ne peut pas être désactivé tant qu’une réservation active utilise ce conditionnement. Libérer ou charger toutes les réservations concernées avant de revoir le mapping.
Un inventaire devenu obsolète est refusé ; une deuxième application du même mapping est sans effet.
