import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const testUri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
testUri.pathname = `/syphax_reception_valuation_${process.pid}_${randomUUID().slice(0, 8)}`;
process.env.MONGODB_URI = testUri.toString();

const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const { createReception } = await import('../lib/reception-records.js');
const { applyReceptionStockValuations } = await import('../lib/reception-stock-valuations.js');
const { createStockValuationRecord } = await import('../lib/stock-valuation-records.js');
const { readStoredStockValuationReconciliation } = await import('../lib/stock-valuations.js');
const { createValuationHistory } = await import('./helpers/stock-valuation-fixtures.js');

let database;

before(async () => {
  database = await getDatabase();
});

after(async () => {
  if (database) await database.dropDatabase();
  await closeMongoConnection();
});

const createContext = async (productId = new ObjectId()) => {
  const supplierId = new ObjectId();
  const authorId = new ObjectId();
  const packagingId = new ObjectId();
  await database.collection('suppliers').insertOne({ _id: supplierId, name: 'Atlas', active: true });
  await database.collection('products').insertOne({
    _id: productId, code: productId.toHexString(), designation: 'Boisson', baseUnit: 'PIECE',
    packagings: [{ _id: packagingId, label: 'Carton', quantity: 12, usage: 'RECEPTION' }],
  });

  return { productId, supplierId, authorId, packagingId };
};

const receiptInput = (context, overrides = {}) => ({
  createdBy: context.authorId.toHexString(),
  supplierId: context.supplierId.toHexString(),
  receptionDate: '2026-09-17',
  supplierReference: 'BL-VALUATION',
  submissionKey: randomUUID(),
  lines: [{
    productId: context.productId.toHexString(), baseUnit: 'PIECE',
    quantityMode: 'DIRECT', directQuantity: '10', amount: '50',
  }],
  ...overrides,
});

const readReport = (productId) => readStoredStockValuationReconciliation({
  database, productId, baseUnit: 'PIECE',
});
const readValuation = (productId) => database.collection('stockValuations').findOne({ productId });
const readEntries = (productId) => database.collection('stockValuationEntries').find({ productId }).sort({ revision: 1 }).toArray();
const insertHistory = async (history) => {
  await database.collection('stockMovements').insertMany(history.movements);
  await database.collection('stockValuationEntries').insertMany(history.entries);
  await database.collection('stockValuations').insertOne(history.valuation);
};

test('first reception initializes a complete balance and a ledger linked to its physical movement', async () => {
  const context = await createContext();
  const result = await createReception(receiptInput(context));
  assert.equal(result.replayed, false);
  const valuation = await readValuation(context.productId);
  const [entry] = await readEntries(context.productId);
  const movement = await database.collection('stockMovements').findOne({ _id: entry.sourceStockMovementId });

  assert.equal(valuation.status, 'COMPLETE');
  assert.equal(valuation.quantityInBaseUnits, 10);
  assert.equal(valuation.valueInCentimes, 5_000);
  assert.equal(valuation.revision, 1);
  assert.ok(valuation.lastLedgerEntryId.equals(entry._id));
  assert.ok(entry.sourceReceptionId.equals(new ObjectId(result.reception.id)));
  assert.ok(entry.sourceReceptionLineId.equals(movement.sourceReceptionLineId));
  assert.ok(entry.recordedBy.equals(context.authorId));
  assert.deepEqual(entry.before, { quantityInBaseUnits: 0, valueInCentimes: 0 });
  assert.equal((await readReport(context.productId)).complete, true);
});

test('multiple receptions weight the remaining quantity and preserve previous ledger entries', async () => {
  const context = await createContext();
  await createReception(receiptInput(context));
  const originalEntries = await readEntries(context.productId);
  const input = receiptInput(context);
  input.lines[0] = { ...input.lines[0], directQuantity: '30', amount: '210' };
  await createReception(input);
  const report = await readReport(context.productId);

  assert.equal(report.complete, true);
  assert.equal(report.quantityInBaseUnits, 40);
  assert.equal(report.valueInCentimes, 26_000);
  assert.equal(report.averageUnitCostInCentimes, 650);
  assert.deepEqual((await readEntries(context.productId))[0], originalEntries[0]);
});

test('repeated product lines use base-unit packaging conversion and source line order', async () => {
  const context = await createContext();
  const input = receiptInput(context);
  input.lines = [
    { ...input.lines[0], directQuantity: '3', amount: '0' },
    { productId: context.productId.toHexString(), baseUnit: 'PIECE', quantityMode: 'PACKAGING',
      packagingId: context.packagingId.toHexString(), packagingCount: '2', amount: '120,50',
      quantityInBaseUnits: 999 },
    { ...input.lines[0], directQuantity: '1', amount: '1,25' },
  ];
  const result = await createReception(input);
  const reception = await database.collection('receptions').findOne({ _id: new ObjectId(result.reception.id) });
  const entries = await readEntries(context.productId);

  assert.deepEqual(entries.map((entry) => entry.quantityDeltaInBaseUnits), [3, 24, 1]);
  assert.deepEqual(entries.map((entry) => entry.valueDeltaInCentimes), [0, 12_050, 125]);
  assert.deepEqual(entries.map((entry) => entry.revision), [1, 2, 3]);
  assert.deepEqual(entries.map((entry) => entry.sourceReceptionLineId), reception.lines.map((line) => line._id));
  assert.equal((await readReport(context.productId)).valueInCentimes, 12_175);
  assert.equal((await readReport(context.productId)).complete, true);
});

test('a reception after valued loadings and returns uses the current balance', async () => {
  const history = createValuationHistory();
  const context = await createContext(history.productId);
  await insertHistory(history);
  await createReception(receiptInput(context));
  const entries = await readEntries(context.productId);
  const report = await readReport(context.productId);

  assert.equal(report.complete, true);
  assert.equal(report.quantityInBaseUnits, 12);
  assert.equal(report.valueInCentimes, 5_067);
  assert.deepEqual(entries.slice(0, 3), history.entries);
  assert.deepEqual(entries[3].before, history.entries[2].after);
});

test('an older reception date applies now without rewriting prior loading or return costs', async () => {
  const history = createValuationHistory();
  const context = await createContext(history.productId);
  await insertHistory(history);
  const result = await createReception(receiptInput(context, { receptionDate: '2026-01-01' }));
  const entries = await readEntries(context.productId);
  const movement = await database.collection('stockMovements').findOne({ sourceReceptionId: new ObjectId(result.reception.id) });

  assert.deepEqual(entries.slice(0, 3), history.entries);
  assert.equal(entries[3].revision, 4);
  assert.equal(entries[3].recordedAt.getTime(), movement.recordedAt.getTime());
  assert.equal(movement.occurredOn.toISOString().slice(0, 10), '2026-01-01');
  assert.equal((await readReport(context.productId)).complete, true);
});

test('concurrent submissions of the same reception apply quantity and value once', async () => {
  const context = await createContext();
  const input = receiptInput(context);
  const results = await Promise.all([createReception(input), createReception(input)]);
  assert.equal(results[0].reception.id, results[1].reception.id);
  assert.notEqual(results[0].replayed, results[1].replayed);
  assert.equal((await readEntries(context.productId)).length, 1);
  assert.equal((await readValuation(context.productId)).valueInCentimes, 5_000);
  assert.equal((await createReception(input)).replayed, true);
  const conflict = await createReception({ ...input, supplierReference: 'OTHER' });
  assert.ok(conflict.errors.form);
  assert.equal((await readEntries(context.productId)).length, 1);
});

test('concurrent receptions from different suppliers serialize on the product lock', async () => {
  const context = await createContext();
  // Install indexes before racing transactions, so this checks product locking.
  await createReception(receiptInput(context));
  const secondSupplierId = new ObjectId();
  await database.collection('suppliers').insertOne({ _id: secondSupplierId, name: 'Second supplier', active: true });
  const first = receiptInput(context);
  const second = receiptInput(context, { supplierId: secondSupplierId.toHexString() });
  second.lines[0] = { ...second.lines[0], directQuantity: '20', amount: '180' };
  const results = await Promise.all([createReception(first), createReception(second)]);
  assert.ok(results.every((result) => result.replayed === false));
  const report = await readReport(context.productId);
  assert.equal(report.complete, true);
  assert.equal(report.quantityInBaseUnits, 40);
  assert.equal(report.valueInCentimes, 28_000);
  assert.deepEqual((await readEntries(context.productId)).map((entry) => entry.revision), [1, 2, 3]);
});

test('unvalued physical history remains unknown across subsequent receptions', async () => {
  const context = await createContext();
  await database.collection('stockMovements').insertOne({
    productId: context.productId, baseUnit: 'PIECE', kind: 'RECEPTION_IN', quantityDeltaInBaseUnits: 7,
    sourceReceptionId: new ObjectId(), sourceReceptionLineId: new ObjectId(),
  });
  await createReception(receiptInput(context));
  await createReception(receiptInput(context));
  const valuation = await readValuation(context.productId);
  assert.equal(valuation.status, 'UNVALUED');
  assert.equal(valuation.quantityInBaseUnits, 27);
  assert.equal(valuation.valueInCentimes, null);
  assert.equal((await readEntries(context.productId)).length, 0);
  assert.equal((await readReport(context.productId)).averageUnitCostInCentimes, null);
});

test('net-zero historical movements and receptions lacking movements never initialize complete valuation', async () => {
  for (const missingMovements of [false, true]) {
    const context = await createContext();
    await database.collection('receptions').insertOne({
      lines: [{ _id: new ObjectId(), productId: context.productId, baseUnit: 'PIECE', quantityInBaseUnits: 7 }],
    });
    if (!missingMovements) {
      await database.collection('stockMovements').insertMany([
        { productId: context.productId, baseUnit: 'PIECE', kind: 'RECEPTION_IN', quantityDeltaInBaseUnits: 7,
          sourceReceptionId: new ObjectId(), sourceReceptionLineId: new ObjectId() },
        { productId: context.productId, baseUnit: 'PIECE', kind: 'TOUR_LOADING_OUT', quantityDeltaInBaseUnits: -7,
          sourceTourId: new ObjectId(), sourceTourReservationId: new ObjectId() },
      ]);
    }
    await createReception(receiptInput(context));
    assert.equal((await readValuation(context.productId)).status, 'UNVALUED');
    assert.equal((await readValuation(context.productId)).valueInCentimes, null);
  }
});

test('a physical loading without valuation downgrades the balance and preserves its ledger', async () => {
  const context = await createContext();
  await createReception(receiptInput(context));
  const entries = await readEntries(context.productId);
  await database.collection('stockMovements').insertOne({
    productId: context.productId, baseUnit: 'PIECE', kind: 'TOUR_LOADING_OUT', quantityDeltaInBaseUnits: -4,
    sourceTourId: new ObjectId(), sourceTourReservationId: new ObjectId(),
  });
  await createReception(receiptInput(context));
  const valuation = await readValuation(context.productId);
  assert.equal(valuation.status, 'UNVALUED');
  assert.equal(valuation.quantityInBaseUnits, 16);
  assert.equal(valuation.valueInCentimes, null);
  assert.equal(valuation.revision, 1);
  assert.ok(valuation.lastLedgerEntryId.equals(entries[0]._id));
  assert.deepEqual(await readEntries(context.productId), entries);
});

test('explicit unknown stock and mismatched complete balances are not repaired with invented costs', async () => {
  for (const unknown of [true, false]) {
    const context = await createContext();
    if (unknown) {
      await database.collection('stockValuations').insertOne(createStockValuationRecord({
        productId: context.productId, baseUnit: 'PIECE', status: 'UNVALUED', valueInCentimes: null,
      }));
    } else {
      await createReception(receiptInput(context));
      await database.collection('stockValuations').updateOne({ productId: context.productId }, { $inc: { valueInCentimes: 1 } });
    }
    await createReception(receiptInput(context));
    const valuation = await readValuation(context.productId);
    assert.equal(valuation.status, 'UNVALUED');
    assert.equal(valuation.valueInCentimes, null);
  }
});

test('incompatible units, negative physical stock and malformed valuation records reject atomically', async () => {
  for (const problem of ['unit', 'negative', 'record']) {
    const context = await createContext();
    if (problem === 'record') {
      await database.collection('stockValuations').insertOne({ productId: context.productId, valueInCentimes: 'bad' });
    } else {
      await database.collection('stockMovements').insertOne({
        productId: context.productId, baseUnit: problem === 'unit' ? 'BOITE' : 'PIECE',
        kind: 'OTHER', quantityDeltaInBaseUnits: problem === 'negative' ? -1 : 1,
      });
    }
    const input = receiptInput(context);
    const productBefore = await database.collection('products').findOne({ _id: context.productId });
    const valuationBefore = await readValuation(context.productId);
    const result = await createReception(input);
    assert.ok(result.errors.lines);
    assert.equal(await database.collection('receptions').countDocuments({ submissionKey: input.submissionKey }), 0);
    assert.deepEqual(await readValuation(context.productId), valuationBefore);
    assert.deepEqual(await database.collection('products').findOne({ _id: context.productId }), productBefore);
  }
});

test('overflow on a later product rolls back all valuation entries, balances and locks', async () => {
  const first = await createContext();
  const second = await createContext();
  const initial = receiptInput(second);
  initial.lines[0] = { ...initial.lines[0], amount: '90071992547409,91' };
  assert.equal((await createReception(initial)).replayed, false);
  const originalValuation = await readValuation(second.productId);
  const input = receiptInput(first);
  input.lines.push(receiptInput(second).lines[0]);
  const result = await createReception(input);

  assert.ok(result.errors.lines);
  assert.equal(await readValuation(first.productId), null);
  assert.equal((await readEntries(first.productId)).length, 0);
  assert.deepEqual(await readValuation(second.productId), originalValuation);
  assert.equal((await readEntries(second.productId)).length, 1);
  assert.equal(await database.collection('receptions').countDocuments({ submissionKey: input.submissionKey }), 0);
  assert.equal(await database.collection('stockMovements').countDocuments({ productId: first.productId }), 0);
  assert.equal((await database.collection('products').findOne({ _id: first.productId })).stockReferenceVersion, undefined);
});

test('a ledger insertion failure rolls back the reception transaction', async () => {
  const context = await createContext();
  await database.collection('stockValuationEntries').createIndex(
    { recordedBy: 1 }, { name: 'force_reception_valuation_failure', unique: true,
      partialFilterExpression: { recordedBy: context.authorId } },
  );
  const input = receiptInput(context);
  input.lines.push({ ...input.lines[0] });
  try {
    await assert.rejects(createReception(input), { code: 11000 });
    assert.equal(await readValuation(context.productId), null);
    assert.equal((await readEntries(context.productId)).length, 0);
    assert.equal(await database.collection('receptions').countDocuments({ submissionKey: input.submissionKey }), 0);
    assert.equal(await database.collection('stockMovements').countDocuments({ productId: context.productId }), 0);
    assert.equal((await database.collection('suppliers').findOne({ _id: context.supplierId })).receptionReferenceVersion, undefined);
  } finally {
    await database.collection('stockValuationEntries').dropIndex('force_reception_valuation_failure');
  }
});

test('the internal valuation writer cannot run outside a transaction', async () => {
  await assert.rejects(applyReceptionStockValuations({ database, lines: [], movements: [] }), TypeError);
});
