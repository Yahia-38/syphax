# Syphax

Application de gestion des achats, du stock et de la distribution.

## Développement local

La base MongoDB doit être démarrée avant l’application :

```bash
sudo docker compose up -d --wait mongodb
npm run dev
```

Le conteneur initialise automatiquement un replica set local à un membre nommé
`rs0`. Cette topologie permet les transactions MongoDB multi-documents ; elle ne
fournit pas de redondance.

L’application est ensuite accessible sur <http://localhost:3000>.

## Initialisation du stock historique

Après une mise à jour depuis une version antérieure aux mouvements de stock,
intégrez les lignes des anciennes réceptions avec :

```bash
npm run stock:backfill
```

La commande est idempotente : une ligne de réception déjà intégrée n’est jamais
dupliquée. Elle peut donc être relancée sans modifier le stock.

## Tests

MongoDB doit être démarrée. Les tests d’intégration créent une base temporaire
isolée, puis la suppriment automatiquement :

```bash
npm test
```
