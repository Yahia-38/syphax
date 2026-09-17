import { open, readFile } from 'node:fs/promises';
import { BSON } from 'mongodb';

import { closeMongoConnection, getDatabase, getMongoClient } from '../lib/mongodb.js';
import { applyStockValuationMigration, previewStockValuationMigration } from '../lib/stock-valuation-migration.js';

const savePrivateFile = async (path, content) => {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
};
const cell = (value) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
const money = (centimes) => centimes === null ? 'Inconnue' : `${new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 }).format(centimes / 100)} DA`;
export const renderStockValuationMigrationPreview = (preview) => [
  '# Prévisualisation de la migration des coûts historiques', '',
  `Base : ${preview.database}. Généré le ${preview.generatedAt}.`, '',
  `Application : ${preview.canApply ? 'possible après revue' : 'bloquée par les anomalies'}.`,
  `${preview.products.length} produits ; ${preview.issues.length} anomalies.`,
  `Modifications proposées : ${preview.changes.valuations} valorisations, ${preview.changes.ledgerEntries} écritures de valeur, ${preview.changes.reservations} chargements, ${preview.changes.countings} comptages.`, '',
  '| Produit | État | Quantité en entrepôt | Valeur en entrepôt | Valeur détenue en tournée | Coût des marchandises vendues |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
  ...preview.products.map((product) => `| ${[
    product.code, product.complete ? 'Réconcilié' : 'À résoudre', product.quantityInBaseUnits,
    money(product.valueInCentimes), money(product.heldOnToursValueInCentimes), money(product.costOfGoodsSoldInCentimes),
  ].map(cell).join(' | ')} |`), '',
  '## Anomalies', '',
  ...(preview.issues.length ? preview.issues.map((issue) => `- ${issue.code} · produit ${issue.productId ?? 'inconnu'} · source ${issue.recordId ?? 'inconnue'}${issue.detail ? ` · ${cell(issue.detail)}` : ''}`) : ['Aucune anomalie détectée.']), '',
  '## Revue et application', '',
  'Aucune écriture en base pendant la prévisualisation. Le JSON contient les valeurs et allocations proposées, les anomalies et les empreintes des sources.',
  'La chronologie utilise les dates d’enregistrement des réceptions, chargements et comptages ; la date métier de réception ne réécrit pas les coûts antérieurs.',
  'Résoudre les anomalies dans les sources puis régénérer la prévisualisation. Ne pas modifier le rapport JSON.',
  'Après revue : npm run stock:valuation-migrate -- --apply <rapport.json> --backup <sauvegarde.ejson>',
  'La sauvegarde BSON complète est synchronisée sur disque avant toute modification de données. L’application est atomique, refuse les sources modifiées et conserve les coûts historiques connus.',
  'Le cutover partage les verrous produit/tournée des écritures de l’application. Suspendre les autres scripts de maintenance et toute écriture directe en base pendant l’application.',
  'La même prévisualisation peut être réappliquée sans doublon tant que les sources n’ont pas évolué. Après une nouvelle opération métier, générer une nouvelle prévisualisation.', '',
].join('\n');

const run = async () => {
  const [mode, path, backupOption, backupPath, ...extra] = process.argv.slice(2);
  if (!path || extra.length || !['--preview', '--apply'].includes(mode)
    || (mode === '--preview' && backupOption)
    || (mode === '--apply' && (backupOption !== '--backup' || !backupPath))) {
    throw new Error('Usage: --preview <prefix> OR --apply <preview.json> --backup <backup.ejson>');
  }
  const database = await getDatabase();
  const client = await getMongoClient();
  if (mode === '--preview') {
    const preview = await previewStockValuationMigration(database, client);
    await savePrivateFile(`${path}.json`, `${JSON.stringify(preview, null, 2)}\n`);
    await savePrivateFile(`${path}.md`, renderStockValuationMigrationPreview(preview));
    console.log(JSON.stringify({ database: preview.database, canApply: preview.canApply,
      products: preview.products.length, anomalies: preview.issues.length, changes: preview.changes,
      report: `${path}.md`, preview: `${path}.json`, writes: 0 }, null, 2));
  } else {
    const preview = JSON.parse(await readFile(path, 'utf8'));
    let backupFingerprint;
    const result = await applyStockValuationMigration(database, client, preview, async (backup) => {
      // Transaction retries must retain an exact backup of the reviewed snapshot.
      if (backupFingerprint) {
        if (backupFingerprint !== backup.sourceFingerprint) throw new Error('Backup sources changed during retry.');
        return;
      }
      await savePrivateFile(backupPath, BSON.EJSON.stringify(backup, { relaxed: false }));
      backupFingerprint = backup.sourceFingerprint;
    });
    console.log(JSON.stringify(result, null, 2));
  }
};

try { await run(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally { try { await closeMongoConnection(); } catch { process.exitCode = 1; } }
