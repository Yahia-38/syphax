import { readFile, writeFile } from 'node:fs/promises';
import { BSON } from 'mongodb';

import { closeMongoConnection, getDatabase, getMongoClient } from '../lib/mongodb.js';
import {
  applyPackagingUsageInventory, createPackagingUsageInventory, snapshotPackagingHistory,
} from '../lib/packaging-usage-migration.js';
import { getPackagingUsageLabel } from '../lib/product-packaging.js';

const cell = (value) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
const renderInventory = (inventory) => [
  '# Inventaire des conditionnements — à revoir',
  '',
  `Base : ${inventory.database}. Généré le ${inventory.generatedAt}.`,
  '',
  `${inventory.products.length} produits ; ${inventory.entries.length} conditionnements.`,
  'Les palettes sont proposées pour la réception, les packs pour la vente. Les autres libellés nécessitent une décision explicite.',
  'Aucun usage n’a encore été modifié. Les unités de base ne sont pas des conditionnements à reclasser.',
  '',
  '| Produit | Conditionnement | Quantité en unités de base | Usage actuel | Usage proposé | Prix (DZD) | Versions de prix |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...inventory.entries.map((entry) => `| ${[
    entry.productCode, entry.label, `${entry.quantity} ${entry.baseUnit}`,
    getPackagingUsageLabel(entry.currentUsage), getPackagingUsageLabel(entry.proposedUsage),
    entry.salePriceInCentimes === null ? '—' : (entry.salePriceInCentimes / 100).toFixed(2),
    entry.priceHistoryCount,
  ].map(cell).join(' | ')} |`),
  '',
  '## Historique à conserver',
  '',
  ...Object.entries(inventory.history).map(([name, { count, sha256 }]) => `- ${name} : ${count} documents ; SHA-256 ${sha256}.`),
  '',
  '## Application après revue',
  '',
  'Revoir les lignes et corriger uniquement `proposedUsage` dans le JSON si nécessaire (`RECEPTION`, `SALE` ou `BOTH`).',
  'Exécuter le script avec `--apply <inventaire.json> --backup <sauvegarde.ejson>` après validation du mapping.',
  'La sauvegarde contient les produits complets avant migration. La transaction ne modifie que `packagings[].usage`, remet à l’unité de base le conditionnement par défaut qui n’est plus vendu, et vérifie la conservation des produits et des historiques.',
  'Un usage de vente ne peut pas être désactivé tant qu’une réservation active utilise ce conditionnement. Libérer ou charger toutes les réservations concernées avant de revoir le mapping.',
  'Un inventaire devenu obsolète est refusé ; une deuxième application du même mapping est sans effet.',
  '',
].join('\n');

try {
  const [mode, path, backupOption, backupPath, ...extra] = process.argv.slice(2);
  if (!path || extra.length || !['--inventory', '--apply'].includes(mode)
    || (mode === '--inventory' && backupOption)
    || (mode === '--apply' && (backupOption !== '--backup' || !backupPath))) {
    throw new Error('Usage : --inventory <préfixe> OU --apply <inventaire.json> --backup <sauvegarde.ejson>');
  }
  const database = await getDatabase();
  if (mode === '--inventory') {
    const inventory = await (await getMongoClient()).withSession(async (session) =>
      session.withTransaction(async () => createPackagingUsageInventory(
        database.databaseName,
        await database.collection('products').find({}, { session }).sort({ code: 1, _id: 1 }).toArray(),
        await snapshotPackagingHistory(database, session),
      ), { readConcern: { level: 'snapshot' } }));
    await writeFile(`${path}.json`, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
    await writeFile(`${path}.md`, renderInventory(inventory), { flag: 'wx' });
    console.log(`${inventory.entries.length} conditionnements inventoriés. Revue : ${path}.md ; mapping : ${path}.json. Aucune écriture en base.`);
  } else {
    const inventory = JSON.parse(await readFile(path, 'utf8'));
    let backupSaved = false;
    const result = await applyPackagingUsageInventory(database, await getMongoClient(), inventory, async (backup) => {
      // withTransaction may retry. Keep the original backup rather than overwrite it.
      if (backupSaved) return;
      await writeFile(backupPath, BSON.EJSON.stringify(backup, { relaxed: false }), { flag: 'wx', mode: 0o600 });
      backupSaved = true;
    });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try { await closeMongoConnection(); } catch { process.exitCode = 1; }
}
