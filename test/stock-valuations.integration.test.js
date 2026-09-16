import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const testUri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
testUri.pathname = `/syphax_valuation_${process.pid}_${randomUUID().slice(0, 8)}`;
process.env.MONGODB_URI = testUri.toString();

const { closeMongoConnection, getDatabase, getMongoClient } = await import('../lib/mongodb.js');
const { createStockValuationRecord } = await import('../lib/stock-valuation-records.js');
const {
  ensureStockValuationIndexes,
  readStoredStockValuationReconciliation,
} = await import('../lib/stock-valuations.js');
const { createValuationHistory } = await import('./helpers/stock-valuation-fixtures.js');

let database;

before(async () => {
  database = await getDatabase();
  await ensureStockValuationIndexes(database);
});

after(async () => {
  if (database) await database.dropDatabase();
  await closeMongoConnection();
});

const insertHistory = async (history) => {
  await database.collection('stockMovements').insertMany(history.movements);
  await database.collection('stockValuationEntries').insertMany(history.entries);
  await database.collection('stockValuations').insertOne(history.valuation);
};

test('creates idempotent unique product, movement/version and product/version/revision indexes', async () => {
  await ensureStockValuationIndexes(database);
  const indexes = await database.collection('stockValuationEntries').indexes();

  assert.ok(indexes.some((index) => index.name === 'unique_stock_valuation_movement_version' && index.unique));
  assert.ok(indexes.some((index) => index.name === 'unique_stock_valuation_product_version_revision' && index.unique));
  const history = createValuationHistory();
  await database.collection('stockValuations').insertOne(history.valuation);
  await assert.rejects(
    database.collection('stockValuations').insertOne({ ...history.valuation, _id: new ObjectId() }),
    { code: 11000 },
  );
});

test('rejects duplicated movement values and duplicated product revisions', async () => {
  const { entries } = createValuationHistory();
  await database.collection('stockValuationEntries').insertOne(entries[0]);

  await assert.rejects(database.collection('stockValuationEntries').insertOne({
    ...entries[0], _id: new ObjectId(), revision: 2,
  }), { code: 11000 });
  await assert.rejects(database.collection('stockValuationEntries').insertOne({
    ...entries[0], _id: new ObjectId(), sourceStockMovementId: new ObjectId(),
  }), { code: 11000 });
});

test('only one concurrent insertion can value the same movement', async () => {
  const { entries } = createValuationHistory();
  const results = await Promise.allSettled([
    database.collection('stockValuationEntries').insertOne(entries[0]),
    database.collection('stockValuationEntries').insertOne({ ...entries[0], _id: new ObjectId() }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 11000);
  assert.equal(await database.collection('stockValuationEntries').countDocuments({ sourceStockMovementId: entries[0].sourceStockMovementId }), 1);
});

test('reconciles persisted reception, loading and return data within a snapshot transaction', async () => {
  const history = createValuationHistory();
  await insertHistory(history);
  const client = await getMongoClient();
  const session = client.startSession();

  try {
    const report = await session.withTransaction(async () => readStoredStockValuationReconciliation({
      database, session, productId: history.productId, baseUnit: history.baseUnit,
    }), { readConcern: { level: 'snapshot' } });

    assert.equal(report.complete, true);
    assert.equal(report.physicalQuantityInBaseUnits, 2);
    assert.equal(report.valueInCentimes, 67);
    assert.equal(report.averageUnitCostInCentimes, 33.5);
  } finally {
    await session.endSession();
  }
});

test('flags missing costs and inconsistent stored values without changing source data', async () => {
  const history = createValuationHistory();
  await insertHistory(history);
  await database.collection('stockValuations').updateOne({ productId: history.productId }, { $set: { valueInCentimes: 68 } });
  const read = () => readStoredStockValuationReconciliation({ database, productId: history.productId, baseUnit: history.baseUnit });
  const beforeEntry = await database.collection('stockValuationEntries').findOne({ _id: history.entries[2]._id });
  const report = await read();

  assert.equal(report.complete, false);
  assert.ok(report.issues.some((issue) => issue.code === 'VALUATION_LEDGER_BALANCE_MISMATCH'));
  assert.equal(report.averageUnitCostInCentimes, null);
  assert.deepEqual(await read(), report);
  assert.deepEqual(await database.collection('stockValuationEntries').findOne({ _id: history.entries[2]._id }), beforeEntry);
  assert.equal((await database.collection('stockValuations').findOne({ productId: history.productId })).valueInCentimes, 68);

  await database.collection('stockValuationEntries').deleteOne({ _id: history.entries[2]._id });
  assert.ok((await read()).issues.some((issue) => issue.code === 'UNVALUED_PHYSICAL_MOVEMENT'));
});

test('does not convert missing or explicitly unvalued stock into zero-cost stock', async () => {
  const history = createValuationHistory();
  await database.collection('stockMovements').insertMany(history.movements);
  const read = () => readStoredStockValuationReconciliation({ database, productId: history.productId, baseUnit: history.baseUnit });
  const missing = await read();

  assert.equal(missing.complete, false);
  assert.equal(missing.valueInCentimes, null);
  assert.ok(missing.issues.some((issue) => issue.code === 'MISSING_VALUATION'));
  await database.collection('stockValuations').insertOne(createStockValuationRecord({
    productId: history.productId, baseUnit: history.baseUnit,
    status: 'UNVALUED', quantityInBaseUnits: 2, valueInCentimes: null,
  }));
  const unknown = await read();

  assert.equal(unknown.complete, false);
  assert.equal(unknown.valueInCentimes, null);
  assert.ok(unknown.issues.some((issue) => issue.code === 'UNKNOWN_COST'));
});
