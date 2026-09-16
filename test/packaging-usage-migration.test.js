import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { BSON, MongoClient, ObjectId } from 'mongodb';

import {
  applyPackagingUsageInventory, createPackagingUsageInventory, HISTORY_COLLECTIONS,
  planPackagingUsageMigration, proposePackagingUsage, snapshotPackagingHistory,
} from '../lib/packaging-usage-migration.js';
import { closeMongoConnection } from '../lib/mongodb.js';
import { addAndReserveTourProduct, ensureTourReservationIndexes } from '../lib/tour-reservations.js';

const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax', {
  serverSelectionTimeoutMS: 5000,
});
const database = client.db(`syphax_test_packaging_usage_${randomUUID().replaceAll('-', '')}`);
before(async () => {
  const testUri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
  testUri.pathname = `/${database.databaseName}`;
  process.env.MONGODB_URI = testUri.toString();
  await client.connect();
  await ensureTourReservationIndexes(database);
});
after(async () => {
  try { await database.dropDatabase(); } finally {
    await closeMongoConnection();
    await client.close();
  }
});

const fixture = () => ({
  _id: new ObjectId(), code: `CLASSIFICATION-${new ObjectId()}`, baseUnit: 'BOUTEILLE',
  designation: 'Boisson', salePrice: { amountInCentimes: 9000 }, stockVersion: 4,
  packagings: [
    { _id: new ObjectId(), label: 'Palette de 240', quantity: 240, createdAt: new Date(),
      salePrice: { amountInCentimes: 200000 }, salePriceHistory: [{ oldAmountInCentimes: 190000 }] },
    { _id: new ObjectId(), label: 'Pack de 6 bouteilles', quantity: 6,
      salePrice: { amountInCentimes: 52000 }, salePriceHistory: [{ oldAmountInCentimes: 54000 }] },
    { _id: new ObjectId(), label: 'Carton', quantity: 24, usage: 'BOTH' },
  ],
});

test('propose palettes en réception et packs en vente sans deviner les autres libellés', () => {
  assert.equal(proposePackagingUsage('  PALETTES de 240 '), 'RECEPTION');
  assert.equal(proposePackagingUsage('Pack de 6 bouteilles'), 'SALE');
  for (const label of ['Carton', 'Packaging', 'PalettePack', '', null]) {
    assert.equal(proposePackagingUsage(label), null);
  }
});

test('refuse les mappings incomplets, invalides ou obsolètes avant toute écriture', () => {
  const product = fixture();
  const inventory = createPackagingUsageInventory(database.databaseName, [product], {});
  assert.equal(inventory.entries[2].proposedUsage, 'BOTH');
  const plan = (mapping, products = [product]) => planPackagingUsageMigration(mapping, database.databaseName, products);
  assert.equal(plan(inventory).length, 2);
  assert.throws(() => plan({ ...inventory, database: 'another_database' }));
  assert.throws(() => plan({ ...inventory, entries: inventory.entries.slice(1) }));
  assert.throws(() => plan({ ...inventory, entries: [...inventory.entries, inventory.entries[0]] }));
  assert.throws(() => plan({ ...inventory, entries: inventory.entries.map((entry) => ({ ...entry, proposedUsage: 'ALL' })) }));
  for (const field of ['quantity', 'label', 'salePrice']) {
    const modified = BSON.EJSON.parse(BSON.EJSON.stringify(product));
    modified.packagings[0][field] = field === 'quantity' ? 480 : 'changed';
    assert.throws(() => plan(inventory, [modified]), /modifié depuis l’inventaire/u);
  }
  const changedUsage = { ...product, packagings: product.packagings.map((item) => ({ ...item, usage: 'BOTH' })) };
  assert.throws(() => plan(inventory, [changedUsage]), /Usage modifié/u);
  const unknown = { ...product, packagings: [{ ...product.packagings[0], label: 'Caisse' }] };
  assert.throws(() => planPackagingUsageMigration(
    createPackagingUsageInventory(database.databaseName, [unknown], {}), database.databaseName, [unknown],
  ), /Mapping incomplet/u);
});

test('classe uniquement les usages, conserve les BSON historiques et les prix, puis devient sans effet', async () => {
  const product = fixture();
  await database.collection('products').insertOne(product);
  for (const name of HISTORY_COLLECTIONS) {
    await database.collection(name).insertOne({
      _id: new ObjectId(), productId: product._id, quantityInBaseUnits: 240,
      amountInCentimes: 52000, packaging: { packagingId: product.packagings[0]._id,
        label: 'Palette de 240', quantity: 240, count: 1 }, createdAt: new Date(),
    });
  }
  const history = await snapshotPackagingHistory(database);
  const inventory = createPackagingUsageInventory(database.databaseName, [product], history);
  let backup;
  const result = await applyPackagingUsageInventory(database, client, inventory, async (value) => { backup = value; });
  assert.equal(result.changed, 2);
  assert.deepEqual(backup.products, [product]);
  const expected = { ...product, packagings: product.packagings.map((item, index) => ({
    ...item, usage: ['RECEPTION', 'SALE', 'BOTH'][index],
  })) };
  assert.deepEqual(await database.collection('products').findOne({ _id: product._id }), expected);
  assert.deepEqual(await snapshotPackagingHistory(database), history);
  assert.equal((await applyPackagingUsageInventory(database, client, inventory, async () => {})).changed, 0);
  assert.deepEqual(await database.collection('products').findOne({ _id: product._id }), expected);
});

test('une sauvegarde échouée empêche les écritures et un inventaire périmé est refusé', async () => {
  const product = fixture();
  await database.collection('products').insertOne(product);
  const inventory = createPackagingUsageInventory(database.databaseName, [product], {});
  await assert.rejects(applyPackagingUsageInventory(database, client, inventory, async () => {
    throw new Error('Backup failed');
  }), /Backup failed/u);
  assert.deepEqual(await database.collection('products').findOne({ _id: product._id }), product);
  await database.collection('products').updateOne({ _id: product._id }, { $set: { 'packagings.0.quantity': 480 } });
  const before = await database.collection('products').findOne({ _id: product._id });
  await assert.rejects(applyPackagingUsageInventory(database, client, inventory, async () => {
    assert.fail('A stale inventory must not reach the backup step');
  }), /modifié depuis l’inventaire/u);
  assert.deepEqual(await database.collection('products').findOne({ _id: product._id }), before);
});

test('une erreur après une première affectation annule la transaction entière', async (context) => {
  const product = fixture();
  await database.collection('products').insertOne(product);
  const inventory = createPackagingUsageInventory(database.databaseName, [product], {});
  const collection = database.collection('products');
  const original = Object.getPrototypeOf(collection).updateOne;
  let calls = 0;
  const mock = context.mock.method(Object.getPrototypeOf(collection), 'updateOne', async (...args) => {
    calls += 1;
    if (calls === 2) throw new Error('Second update failed');
    return original.apply(collection, args);
  });
  try {
    await assert.rejects(applyPackagingUsageInventory(database, client, inventory, async () => {}), /Second update failed/u);
  } finally { mock.mock.restore(); }
  assert.deepEqual(await database.collection('products').findOne({ _id: product._id }), product);
});

const insertReservation = async (product, packaging, status = 'ACTIVE') => {
  const reservation = {
    _id: new ObjectId(), additionKey: randomUUID(), tourId: new ObjectId(), tourReference: 'TRN-USAGE',
    productId: product._id, status, quantityMode: packaging ? 'PACKAGING' : 'DIRECT',
    baseUnit: product.baseUnit, quantityInBaseUnits: packaging?.quantity ?? 30,
    ...(packaging ? { packaging: { packagingId: packaging._id, label: packaging.label,
      quantity: packaging.quantity, count: 1 } } : {}),
  };
  await database.collection('tourReservations').insertOne(reservation);
  return reservation;
};

const inventoryFor = async (product) => createPackagingUsageInventory(
  database.databaseName, [product], await snapshotPackagingHistory(database),
);

test('bloque la désactivation de vente pour une réservation active sans sauvegarde ni modification', async () => {
  const product = fixture();
  product.packagings[0].usage = 'SALE';
  await database.collection('products').insertOne(product);
  await insertReservation(product, product.packagings[0]);
  const inventory = await inventoryFor(product);
  inventory.entries[0].proposedUsage = 'RECEPTION';
  const history = await snapshotPackagingHistory(database);
  await assert.rejects(applyPackagingUsageInventory(database, client, inventory, async () => {
    assert.fail('A blocked mapping must not reach the backup step');
  }), /Palette de 240.*TRN-USAGE.*réservation active/u);
  assert.deepEqual(await database.collection('products').findOne({ _id: product._id }), product);
  assert.deepEqual(await snapshotPackagingHistory(database), history);
});

test('conserve les changements compatibles avec une réservation active : vente vers mixte puis mixte vers vente', async () => {
  const product = fixture();
  product.packagings[0].usage = 'SALE';
  await database.collection('products').insertOne(product);
  const reservation = await insertReservation(product, product.packagings[0]);
  for (const usage of ['BOTH', 'SALE']) {
    const current = await database.collection('products').findOne({ _id: product._id });
    const inventory = await inventoryFor(current);
    inventory.entries[0].proposedUsage = usage;
    await applyPackagingUsageInventory(database, client, inventory, async () => {});
    assert.equal((await database.collection('products').findOne({ _id: product._id })).packagings[0].usage, usage);
    assert.deepEqual(await database.collection('tourReservations').findOne({ _id: reservation._id }), reservation);
  }
});

test('autorise les changements sans invalider les réservations directes, d’autres conditionnements ou d’autres produits', async () => {
  const product = fixture();
  product.packagings[0].usage = 'SALE';
  product.packagings[1].usage = 'SALE';
  await database.collection('products').insertOne(product);
  await insertReservation(product, null);
  await insertReservation(product, product.packagings[1]);
  await insertReservation({ ...product, _id: new ObjectId() }, product.packagings[0]);
  const inventory = await inventoryFor(product);
  inventory.entries[0].proposedUsage = 'RECEPTION';
  assert.equal((await applyPackagingUsageInventory(database, client, inventory, async () => {})).changed, 1);
  assert.equal((await database.collection('products').findOne({ _id: product._id })).packagings[0].usage, 'RECEPTION');
});

test('garde l’usage bloqué jusqu’à résolution de toutes les réservations concernées, puis préserve leur historique', async () => {
  const product = fixture();
  product.packagings[0].usage = 'SALE';
  await database.collection('products').insertOne(product);
  const first = await insertReservation(product, product.packagings[0]);
  const last = await insertReservation(product, product.packagings[0]);
  const inventory = await inventoryFor(product);
  inventory.entries[0].proposedUsage = 'RECEPTION';
  await database.collection('tourReservations').updateOne({ _id: first._id }, { $set: { status: 'RELEASED' } });
  await assert.rejects(applyPackagingUsageInventory(database, client, inventory, async () => {}), /réservation active/u);
  await database.collection('tourReservations').updateOne({ _id: last._id }, { $set: {
    status: 'LOADED', salePriceAtLoading: { amountInCentimes: 9000, currency: 'DZD', unit: 'BOUTEILLE', taxIncluded: true },
  } });
  const history = await snapshotPackagingHistory(database);
  await applyPackagingUsageInventory(database, client, inventory, async () => {});
  assert.equal((await database.collection('products').findOne({ _id: product._id })).packagings[0].usage, 'RECEPTION');
  assert.deepEqual(await snapshotPackagingHistory(database), history);
});

test('un ajout concurrent après le contrôle empêche la migration d’invalider sa réservation', async (context) => {
  const product = fixture();
  product.packagings[0].usage = 'SALE';
  await database.collection('products').insertOne(product);
  const delivererId = new ObjectId();
  const tourId = new ObjectId();
  await database.collection('deliverers').insertOne({ _id: delivererId, active: true, code: 'LIV-CONCURRENT', name: 'Livreur' });
  await database.collection('tours').insertOne({ _id: tourId, delivererId, reference: 'TRN-CONCURRENT', status: 'PREPARATION' });
  await database.collection('stockMovements').insertOne({
    productId: product._id, baseUnit: 'BOUTEILLE', quantityDeltaInBaseUnits: 1000,
  });
  const inventory = await inventoryFor(product);
  inventory.entries[0].proposedUsage = 'RECEPTION';
  const additionKey = randomUUID();
  let signalReady;
  let resume;
  const ready = new Promise((resolve) => { signalReady = resolve; });
  const paused = new Promise((resolve) => { resume = resolve; });
  const prototype = Object.getPrototypeOf(database.collection('tourReservations'));
  const findOne = prototype.findOne;
  // Dynamic this preserves the collection and client used by each transaction.
  const mock = context.mock.method(prototype, 'findOne', async function (...args) {
    if (args[0]?.additionKey === additionKey && !args[1]?.session) {
      signalReady();
      await paused;
    }
    return findOne.apply(this, args);
  });
  const addition = addAndReserveTourProduct({
    additionKey, createdBy: new ObjectId().toString(), tourId: tourId.toString(),
    productId: product._id.toString(), quantityMode: 'PACKAGING',
    packagingId: product.packagings[0]._id.toString(), packagingCount: '1',
  });
  try {
    // Pause the addition after index maintenance, before it opens its transaction.
    await ready;
    await assert.rejects(applyPackagingUsageInventory(database, client, inventory, async () => {
      // The migration has checked reservations but has not written the product yet.
      resume();
      assert.ok((await addition).reservation.id);
    }), /modifié depuis l’inventaire|réservation active/u);
  } finally {
    resume();
    await addition;
    mock.mock.restore();
  }
  assert.equal((await database.collection('products').findOne({ _id: product._id })).packagings[0].usage, 'SALE');
  assert.equal(await database.collection('tourReservations').countDocuments({ tourId, status: 'ACTIVE' }), 1);
  assert.equal(await database.collection('stockMovements').countDocuments({ sourceTourId: tourId }), 0);
});
