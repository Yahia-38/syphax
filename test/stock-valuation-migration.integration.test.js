import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import test, { after, before, beforeEach } from 'node:test';
import { BSON, ObjectId } from 'mongodb';

const uri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
uri.pathname = `/syphax_mig_${process.pid}_${randomUUID().slice(0, 8)}`;
process.env.MONGODB_URI = uri.toString();
const { closeMongoConnection, getDatabase, getMongoClient } = await import('../lib/mongodb.js');
const { applyStockValuationMigration, previewStockValuationMigration, snapshotStockValuationMigration } = await import('../lib/stock-valuation-migration.js');
const { fingerprintStockMigration, STOCK_MIGRATION_COLLECTIONS } = await import('../lib/stock-valuation-migration-plan.js');
const { readStoredStockValuationReconciliation } = await import('../lib/stock-valuations.js');
const { createReception } = await import('../lib/reception-records.js');
const { confirmTourCounting, getTourCountingSheet } = await import('../lib/tour-countings.js');
const { createStockMigrationFixture } = await import('./helpers/stock-migration-fixtures.js');

let database;
let client;
before(async () => { database = await getDatabase(); client = await getMongoClient(); });
beforeEach(async () => { await database.dropDatabase(); });
after(async () => { try { if (database) await database.dropDatabase(); } finally { await closeMongoConnection(); } });
const fixture = async (options = {}) => {
  const source = createStockMigrationFixture(options);
  for (const name of STOCK_MIGRATION_COLLECTIONS) if (source.snapshot[name].length) await database.collection(name).insertMany(source.snapshot[name]);
  return source;
};
const snapshot = () => client.withSession(async (session) => session.withTransaction(
  () => snapshotStockValuationMigration(database, session), { readConcern: { level: 'snapshot' } },
));
const preview = () => previewStockValuationMigration(database, client);
const apply = (report, backup = async () => {}) => applyStockValuationMigration(database, client, report, backup);
const receipt = async (source, amount = '100') => {
  const supplierId = new ObjectId();
  await database.collection('suppliers').insertOne({ _id: supplierId, code: `SUP-${supplierId}`, name: 'Fournisseur migration', active: true });
  return createReception({ createdBy: source.authorId.toHexString(), supplierId: supplierId.toHexString(),
    submissionKey: randomUUID(), receptionDate: '2026-09-01', supplierReference: 'BL-APRES-MIGRATION',
    lines: [{ productId: source.productId.toHexString(), baseUnit: 'PIECE', quantityMode: 'DIRECT', directQuantity: '1', amount }],
  });
};
const countingAccount = async (source) => {
  const roleId = new ObjectId();
  const delivererId = new ObjectId();
  await database.collection('roles').insertOne({ _id: roleId, permissions: ['tours.read', 'pricing.read', 'tours.count.prepare', 'tours.count.confirm'] });
  await database.collection('users').insertOne({ _id: source.authorId, username: 'migration-counter', active: true, roleIds: [roleId] });
  await database.collection('deliverers').insertOne({ _id: delivererId, name: 'Livreur historique', active: true });
  await database.collection('tours').updateOne({ _id: source.tourId }, { $set: { delivererId } });
};

test('preview reads complete sources consistently and performs no database writes', async () => {
  await fixture();
  const before = await snapshot();
  const collectionsBefore = await database.listCollections().toArray();
  const report = await preview();
  assert.equal(report.canApply, true);
  assert.equal(report.products[0].valueInCentimes, 630_000);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await database.listCollections().toArray(), collectionsBefore);
});

test('apply saves exact BSON sources before changing data and verifies warehouse/tour/sold conservation', async () => {
  const source = await fixture();
  const before = await snapshot();
  let backup;
  const result = await apply(await preview(), async (data) => {
    assert.deepEqual(await snapshot(), before);
    backup = BSON.EJSON.parse(BSON.EJSON.stringify(data, { relaxed: false }));
  });
  assert.equal(result.replayed, false);
  assert.deepEqual(result.changes, { valuations: 1, ledgerEntries: 4, reservations: 1, countings: 1 });
  assert.deepEqual(backup.snapshot, before);
  assert.equal(backup.sourceFingerprint, fingerprintStockMigration(before));
  const report = await readStoredStockValuationReconciliation({ database, productId: source.productId, baseUnit: 'PIECE' });
  assert.equal(report.complete, true);
  assert.equal(report.quantityInBaseUnits, 110);
  assert.equal(report.valueInCentimes, 630_000);
  const counting = await database.collection('tourCountings').findOne({ _id: source.countingId });
  assert.equal(counting.totalPurchaseCostInCentimes, 200_000);
  assert.equal(counting.totalReturnedValueInCentimes, 50_000);
  assert.equal(counting.totalCostOfGoodsSoldInCentimes, 150_000);
  assert.deepEqual(await database.collection('stockMovements').find({}).sort({ _id: 1 }).toArray(), before.stockMovements);
  assert.deepEqual(await database.collection('receptions').find({}).sort({ _id: 1 }).toArray(), before.receptions);
  assert.equal(await database.collection('stockValuationMigrations').countDocuments({}), 1);
});

test('payments, expenses, prices and unrelated source metadata survive migration unchanged', async () => {
  const source = await fixture();
  await database.collection('tourExpenses').insertOne({ tourId: source.tourId, amountInCentimes: 123, custom: 'preserve' });
  await database.collection('cashPayments').insertOne({ tourId: source.tourId, amountInCentimes: 456 });
  await database.collection('tourCountings').updateOne({ _id: source.countingId }, { $set: { custom: 'historical-metadata' } });
  const payments = await database.collection('cashPayments').find({}).toArray();
  const expenses = await database.collection('tourExpenses').find({}).toArray();
  const product = await database.collection('products').findOne({ _id: source.productId });
  await apply(await preview());
  assert.deepEqual(await database.collection('cashPayments').find({}).toArray(), payments);
  assert.deepEqual(await database.collection('tourExpenses').find({}).toArray(), expenses);
  assert.deepEqual((await database.collection('products').findOne({ _id: source.productId })).salePrice, product.salePrice);
  const counting = await database.collection('tourCountings').findOne({ _id: source.countingId });
  assert.equal(counting.custom, 'historical-metadata');
  assert.equal(counting.totalDueInCentimes, 300_000);
  assert.deepEqual(counting.confirmationKeys, ['historical-key']);
});

test('same-preview reruns and fresh previews of migrated records never duplicate value or rewrite history', async () => {
  await fixture();
  const report = await preview();
  await apply(report);
  const after = await snapshot();
  const replayed = await apply(report, async () => assert.fail('A replay must not write another backup.'));
  assert.equal(replayed.replayed, true);
  assert.deepEqual(await snapshot(), after);
  const fresh = await preview();
  assert.equal(fresh.canApply, true);
  assert.deepEqual(fresh.changes, { valuations: 0, ledgerEntries: 0, reservations: 0, countings: 0 });
  assert.equal((await apply(fresh)).unchanged, true);
  assert.deepEqual(await snapshot(), after);
});

test('missing history and conflicting existing costs block apply without partial data changes', async () => {
  const source = await fixture();
  await database.collection('receptions').updateOne({ _id: source.snapshot.receptions[0]._id }, { $unset: { 'lines.0.amountInCentimes': '' } });
  const report = await preview();
  assert.equal(report.canApply, false);
  const before = await snapshot();
  await assert.rejects(apply(report), /unresolved anomalies/u);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await database.collection('stockValuationMigrations').countDocuments({}), 0);
});

test('changed amounts, added movements and tampered or cross-database reports are rejected', async () => {
  const source = await fixture();
  const report = await preview();
  await assert.rejects(apply({ ...report, products: [] }), /altered report/u);
  await assert.rejects(applyStockValuationMigration(client.db('other_database'), client, report, async () => {}), /different database/u);
  await database.collection('receptions').updateOne({ _id: source.snapshot.receptions[0]._id }, { $inc: { 'lines.0.amountInCentimes': 1 } });
  const before = await snapshot();
  await assert.rejects(apply(report), /Sources changed since preview/u);
  assert.deepEqual(await snapshot(), before);
});

test('backup persistence failure rolls back every balance, ledger, source and coordination counter', async () => {
  await fixture();
  const report = await preview();
  const before = await snapshot();
  await assert.rejects(apply(report, async () => { throw new Error('Backup disk unavailable'); }), /Backup disk unavailable/u);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await database.collection('stockValuationMigrations').countDocuments({}), 0);
});

test('ledger insertion failure rolls back all writes and stock locks', async () => {
  await fixture();
  const report = await preview();
  await database.collection('stockValuationEntries').createIndex({ kind: 1 }, { unique: true, name: 'force_ledger_failure' });
  const before = await snapshot();
  await assert.rejects(apply(report), { code: 11000 });
  assert.deepEqual(await snapshot(), before);
  assert.equal(await database.collection('stockValuationMigrations').countDocuments({}), 0);
});

test('concurrent applications of the same preview commit exactly once', async () => {
  await fixture();
  const report = await preview();
  const results = await Promise.all([apply(report), apply(report)]);
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal(await database.collection('stockValuationEntries').countDocuments({}), 4);
  assert.equal(await database.collection('stockValuationMigrations').countDocuments({}), 1);
});

test('a reception committed after backup forces a stale-source retry and cannot be missed', async () => {
  const source = await fixture();
  // Install the normal reception indexes before opening the migration snapshot.
  // An index build inside the backup callback would wait for its reader lock.
  assert.equal((await receipt(source, '0')).replayed, false);
  const report = await preview();
  let received = false;
  await assert.rejects(apply(report, async () => {
    if (!received) {
      const result = await receipt(source);
      assert.equal(result.replayed, false);
      received = true;
    }
  }), /Sources changed since preview/u);
  assert.equal(await database.collection('stockValuationMigrations').countDocuments({}), 0);
  assert.equal(await database.collection('stockValuationEntries').countDocuments({}), 0);
  const updated = await preview();
  assert.equal(updated.canApply, true);
  await apply(updated);
  const reconciled = await readStoredStockValuationReconciliation({ database, productId: source.productId, baseUnit: 'PIECE' });
  assert.equal(reconciled.complete, true);
  assert.equal(reconciled.quantityInBaseUnits, 112);
  assert.equal(reconciled.valueInCentimes, 640_000);
});

test('new receptions and counting after cutover use migrated balances and original costs', async () => {
  const source = await fixture({ counted: false });
  await countingAccount(source);
  await apply(await preview());
  assert.equal((await receipt(source)).replayed, false);
  const sheet = await getTourCountingSheet({ tourId: source.tourId.toHexString(), userId: source.authorId.toHexString() });
  assert.ok(sheet.digest, JSON.stringify(sheet));
  const result = await confirmTourCounting({ tourId: source.tourId.toHexString(), countedBy: source.authorId.toHexString(),
    confirmationKey: randomUUID(), expectedSheetDigest: sheet.digest,
    lines: [{ lineId: source.reservationId.toHexString(), returnedQuantity: '10' }],
  });
  assert.ok(result.countingId, JSON.stringify(result));
  const counting = await database.collection('tourCountings').findOne({ tourId: source.tourId });
  assert.equal(counting.totalReturnedValueInCentimes, 50_000);
  assert.equal(counting.totalCostOfGoodsSoldInCentimes, 150_000);
  const reconciled = await readStoredStockValuationReconciliation({ database, productId: source.productId, baseUnit: 'PIECE' });
  assert.equal(reconciled.complete, true);
  assert.equal(reconciled.quantityInBaseUnits, 111);
  assert.equal(reconciled.valueInCentimes, 640_000);
});

test('new operations after an application require a fresh preview instead of replaying an old report', async () => {
  const source = await fixture();
  const report = await preview();
  await apply(report);
  await receipt(source);
  await assert.rejects(apply(report), /Sources changed after migration/u);
  assert.equal((await preview()).canApply, true);
});

test('CLI preview/apply writes private reports and durable BSON backup; file reuse and invalid modes fail', async () => {
  await fixture();
  const directory = await mkdtemp('/tmp/syphax-migration-cli-');
  const run = promisify(execFile);
  const script = 'scripts/migrate-stock-valuations.js';
  const prefix = `${directory}/preview`;
  const backupPath = `${directory}/backup.ejson`;
  try {
    const result = await run(process.execPath, [script, '--preview', prefix]);
    assert.equal(JSON.parse(result.stdout).writes, 0);
    assert.equal((await stat(`${prefix}.json`)).mode & 0o777, 0o600);
    assert.equal((await stat(`${prefix}.md`)).mode & 0o777, 0o600);
    await assert.rejects(run(process.execPath, [script, '--preview', prefix]), /Command failed/u);
    const applied = await run(process.execPath, [script, '--apply', `${prefix}.json`, '--backup', backupPath]);
    assert.equal(JSON.parse(applied.stdout).replayed, false);
    assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
    const backup = BSON.EJSON.parse(await readFile(backupPath, 'utf8'));
    assert.ok(backup.snapshot.products[0]._id instanceof ObjectId);
    assert.equal(backup.sourceFingerprint, fingerprintStockMigration(backup.snapshot));
    await assert.rejects(run(process.execPath, [script, '--apply', `${prefix}.json`]), /Command failed/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
