import { createHash } from 'node:crypto';
import { BSON, ObjectId } from 'mongodb';

import { isPackagingEnabledForSale, PACKAGING_USAGES } from './product-packaging.js';
import { ACTIVE_RESERVATION_STATUS } from './stock-movements.js';

export const HISTORY_COLLECTIONS = [
  'receptions', 'tours', 'tourReservations', 'tourCountings',
  'tourExpenses', 'stockMovements',
];

const fingerprint = (value) => createHash('sha256')
  .update(BSON.EJSON.stringify(value, { relaxed: false })).digest('hex');

const withoutUsages = (product) => ({
  ...product,
  ...(Array.isArray(product.packagings) ? {
    packagings: product.packagings.map((packaging) => {
      const copy = { ...packaging };
      delete copy.usage;
      return copy;
    }),
  } : {}),
});

export const proposePackagingUsage = (label) => {
  const normalized = typeof label === 'string' ? label.trim().toLocaleLowerCase('fr') : '';
  if (/^palettes?\b/u.test(normalized)) return 'RECEPTION';
  if (/^packs?\b/u.test(normalized)) return 'SALE';
  return null;
};

export const snapshotPackagingHistory = async (database, session) => {
  const result = {};
  for (const name of HISTORY_COLLECTIONS) {
    const hash = createHash('sha256');
    let count = 0;
    for await (const document of database.collection(name).find({}, { session }).sort({ _id: 1 })) {
      hash.update(BSON.EJSON.stringify(document, { relaxed: false }));
      hash.update('\n');
      count += 1;
    }
    result[name] = { count, sha256: hash.digest('hex') };
  }
  return result;
};

export const createPackagingUsageInventory = (databaseName, products, history) => ({
  version: 1,
  database: databaseName,
  generatedAt: new Date().toISOString(),
  history,
  products: products.map((product) => ({
    productId: product._id.toString(),
    fingerprint: fingerprint(withoutUsages(product)),
  })),
  entries: products.flatMap((product) => (product.packagings ?? []).map((packaging) => {
    const currentUsage = packaging.usage ?? null;
    const suggestedUsage = proposePackagingUsage(packaging.label);
    return {
      productId: product._id.toString(),
      productCode: product.code,
      designation: product.designation,
      baseUnit: product.baseUnit,
      packagingId: packaging._id.toString(),
      label: packaging.label,
      quantity: packaging.quantity,
      salePriceInCentimes: packaging.salePrice?.amountInCentimes ?? null,
      priceHistoryCount: packaging.salePriceHistory?.length ?? 0,
      currentUsage,
      proposedUsage: currentUsage ?? suggestedUsage,
      reviewNote: currentUsage !== null
        ? 'Usage existant conservé ; vérifier les éventuels conflits avec le libellé.'
        : suggestedUsage ? 'Proposition selon le libellé.' : 'Usage à décider manuellement.',
    };
  })),
});

export const planPackagingUsageMigration = (inventory, databaseName, products) => {
  if (inventory.version !== 1 || inventory.database !== databaseName
    || !Array.isArray(inventory.entries) || !Array.isArray(inventory.products)) {
    throw new Error('Inventaire invalide ou destiné à une autre base.');
  }
  const knownProducts = new Map(products.map((product) => [product._id.toString(), product]));
  const seenProducts = new Set();
  for (const record of inventory.products) {
    const product = knownProducts.get(record.productId);
    if (seenProducts.has(record.productId) || !product
      || fingerprint(withoutUsages(product)) !== record.fingerprint) {
      throw new Error(`Produit modifié depuis l’inventaire : ${record.productId}. Régénérez l’inventaire.`);
    }
    seenProducts.add(record.productId);
  }
  const seenPackagings = new Set();
  const updates = [];
  for (const entry of inventory.entries) {
    const key = `${entry.productId}/${entry.packagingId}`;
    const product = knownProducts.get(entry.productId);
    const packaging = product?.packagings?.find((item) => item._id.toString() === entry.packagingId);
    if (!seenProducts.has(entry.productId) || !packaging || seenPackagings.has(key)
      || !PACKAGING_USAGES.some(({ code }) => code === entry.proposedUsage)) {
      throw new Error(`Mapping incomplet ou invalide : ${key}.`);
    }
    seenPackagings.add(key);
    if ((packaging.usage ?? null) === entry.proposedUsage) continue;
    if ((packaging.usage ?? null) !== entry.currentUsage) {
      throw new Error(`Usage modifié depuis l’inventaire : ${key}.`);
    }
    updates.push({ productId: product._id, packagingId: packaging._id, usage: entry.proposedUsage });
  }
  for (const productId of seenProducts) {
    for (const packaging of knownProducts.get(productId).packagings ?? []) {
      if (!seenPackagings.has(`${productId}/${packaging._id}`)) {
        throw new Error(`Conditionnement absent du mapping : ${packaging._id}.`);
      }
    }
  }
  return updates;
};

export const applyPackagingUsageInventory = async (database, client, inventory, saveBackup) =>
  client.withSession(async (session) => session.withTransaction(async () => {
    const productIds = inventory.products?.map(({ productId }) => {
      if (!/^[a-f\d]{24}$/iu.test(productId)) throw new Error('Identifiant produit invalide.');
      return new ObjectId(productId);
    });
    const products = await database.collection('products').find(
      { _id: { $in: productIds ?? [] } }, { session },
    ).sort({ _id: 1 }).toArray();
    const updates = planPackagingUsageMigration(inventory, database.databaseName, products);
    for (const update of updates) {
      if (isPackagingEnabledForSale(update)) continue;
      const reservation = await database.collection('tourReservations').findOne({
        productId: update.productId,
        'packaging.packagingId': update.packagingId,
        status: ACTIVE_RESERVATION_STATUS,
      }, { projection: { packaging: 1, tourReference: 1 }, session });
      if (reservation) {
        throw new Error(
          `Le conditionnement ${reservation.packaging.label ?? update.packagingId}${reservation.tourReference ? ` de la tournée ${reservation.tourReference}` : ''} possède une réservation active. Libérez ou chargez les réservations de ce conditionnement avant de désactiver son usage pour la vente.`,
        );
      }
    }
    const historyBefore = await snapshotPackagingHistory(database, session);
    // Persist the exact pre-migration BSON documents before the first database write.
    await saveBackup({ database: database.databaseName, products, history: historyBefore });
    for (const update of updates) {
      // This product write conflicts with reservation creation, release and loading.
      // A concurrent reservation forces a retry and a new eligibility check.
      const result = await database.collection('products').updateOne(
        { _id: update.productId, 'packagings._id': update.packagingId },
        { $set: { 'packagings.$[packaging].usage': update.usage } },
        { session, arrayFilters: [{ 'packaging._id': update.packagingId }] },
      );
      if (result.modifiedCount !== 1) throw new Error('Le conditionnement n’a pas pu être classé.');
    }
    const after = await database.collection('products').find(
      { _id: { $in: productIds } }, { session },
    ).sort({ _id: 1 }).toArray();
    const expected = products.map((product) => ({
      ...product,
      ...(Array.isArray(product.packagings) ? {
        packagings: product.packagings.map((packaging) => {
          const update = updates.find((item) => item.productId.equals(product._id)
            && item.packagingId.equals(packaging._id));
          return update ? { ...packaging, usage: update.usage } : packaging;
        }),
      } : {}),
    }));
    if (fingerprint(after) !== fingerprint(expected)
      || fingerprint(await snapshotPackagingHistory(database, session)) !== fingerprint(historyBefore)) {
      throw new Error('Échec de la vérification de conservation ; transaction annulée.');
    }
    return { changed: updates.length, unchanged: inventory.entries.length - updates.length, history: historyBefore };
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }));
