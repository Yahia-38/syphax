# Syphax

Application de gestion des achats, du stock et de la distribution.

## Développement local

La base MongoDB doit être démarrée avant l’application :

```bash
sudo docker compose up -d
npm run dev
```

L’application est ensuite accessible sur <http://localhost:3000>.

## Tests

MongoDB doit être démarrée. Les tests d’intégration créent une base temporaire
isolée, puis la suppriment automatiquement :

```bash
npm test
```
