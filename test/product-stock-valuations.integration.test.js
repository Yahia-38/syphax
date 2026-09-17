import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { ObjectId } from 'mongodb';

const uri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
uri.pathname = `/syphax_product_val_${process.pid}_${randomUUID().replaceAll('-', '')}`;
process.env.MONGODB_URI = uri.toString();

const { closeMongoConnection, getDatabase, getMongoClient } = await import('../lib/mongodb.js');
const { PermissionDeniedError } = await import('../lib/access.js');
const { getProductById, listProducts } = await import('../lib/products.js');
const { listProductStockMovements } = await import('../lib/stock-movements.js');
const { readProductStockValuation } = await import('../lib/product-stock-valuations.js');
const { createReception } = await import('../lib/reception-records.js');
const { createValuationHistory, seedValuedStockReceipt, seedValuedTourLoading } = await import('./helpers/stock-valuation-fixtures.js');

let database;
let reader;
let hiddenReader;
const user = async (permissions) => {
  const id = new ObjectId();
  const roleId = new ObjectId();
  await database.collection('roles').insertOne({ _id: roleId, permissions });
  await database.collection('users').insertOne({ _id: id, username: `valuation-${id}`, active: true, roleIds: [roleId] });
  return { id: id.toHexString(), roleId };
};
before(async () => {
  database = await getDatabase();
  reader = await user(['products.read', 'stock.valuation.read']);
  hiddenReader = await user(['products.read', 'pricing.read', 'receptions.read']);
});
after(async () => {
  try {
    if (database) await database.dropDatabase();
  } finally {
    await closeMongoConnection();
  }
});

const product = async (baseUnit = 'PIECE') => {
  const id = new ObjectId();
  await database.collection('products').insertOne({
    _id: id, code: `VAL-${id}`, designation: 'Produit de valorisation', baseUnit,
  });
  return id;
};
const read = (id, options = {}) => getProductById(id.toHexString(), {
  includeValuation: true, includeStockMovements: true, userId: reader.id, ...options,
});
const history = async () => {
  const source = createValuationHistory();
  await database.collection('products').insertOne({
    _id: source.productId, code: `VAL-${source.productId}`, designation: 'Coûts affectés', baseUnit: source.baseUnit,
  });
  await database.collection('stockMovements').insertMany(source.movements);
  await database.collection('stockValuationEntries').insertMany(source.entries);
  await database.collection('stockValuations').insertOne(source.valuation);
  return source;
};
const receive = async (productId, quantity, amount) => {
  const supplierId = new ObjectId();
  await database.collection('suppliers').insertOne({ _id: supplierId, active: true, code: `SUP-${supplierId}`, name: 'Fournisseur' });
  const result = await createReception({
    createdBy: reader.id, supplierId: supplierId.toHexString(), submissionKey: randomUUID(),
    receptionDate: '2026-09-01', supplierReference: 'BL-VALUATION',
    lines: [{ productId: productId.toHexString(), baseUnit: 'PIECE', quantityMode: 'DIRECT', directQuantity: String(quantity), amount }],
  });
  assert.equal(result.replayed, false, JSON.stringify(result));
};

test('authorized product reads show reconciled warehouse costs and original assigned movement values', async () => {
  const source = await history();
  const before = await read(source.productId);
  assert.equal(before.stock.quantityInBaseUnits, 2);
  assert.deepEqual(before.stock.valuation, { complete: true, valueInCentimes: 67, averageUnitCostInCentimes: 33.5, currency: 'DZD', taxIncluded: true });
  const values = new Map(before.stock.movements.map((movement) => [movement.id, movement.valueDeltaInCentimes]));
  assert.deepEqual(source.movements.map((movement) => values.get(movement._id.toHexString())), [100, -67, 34]);
  assert.ok(before.stock.movements.every((movement) => movement.sourceTour === null && movement.sourceReception === null));
  assert.equal('entries' in before.stock.valuation, false);
  assert.equal('revision' in before.stock.valuation, false);
  await receive(source.productId, 1, '2');
  const later = await read(source.productId);
  assert.equal(later.stock.quantityInBaseUnits, 3);
  assert.equal(later.stock.valuation.valueInCentimes, 267);
  assert.equal(later.stock.valuation.averageUnitCostInCentimes, 89);
  for (const movement of before.stock.movements) {
    assert.equal(later.stock.movements.find(({ id }) => id === movement.id).valueDeltaInCentimes, movement.valueDeltaInCentimes);
  }
  assert.deepEqual(await database.collection('stockValuationEntries').find({ _id: { $in: source.entries.map((entry) => entry._id) } }).sort({ revision: 1 }).toArray(), source.entries);
});

test('the weighted average uses remaining warehouse stock and includes reserved quantities', async () => {
  const id = await product();
  await seedValuedStockReceipt({ database, productId: id, quantityInBaseUnits: 100, amountInCentimes: 500_000 });
  await seedValuedTourLoading({ database, productId: id, tourId: new ObjectId(), reservationId: new ObjectId(), quantityInBaseUnits: 40 });
  await receive(id, 40, '2800');
  await database.collection('tourReservations').insertOne({ productId: id, status: 'ACTIVE', quantityInBaseUnits: 90 });
  const result = await read(id);
  assert.equal(result.stock.quantityInBaseUnits, 100);
  assert.equal(result.stock.availableQuantityInBaseUnits, 10);
  assert.equal(result.stock.valuation.valueInCentimes, 580_000);
  assert.equal(result.stock.valuation.averageUnitCostInCentimes, 5800);
});

test('packaging products display purchase costs per base unit', async () => {
  const id = await product('BOUTEILLE');
  await seedValuedStockReceipt({ database, productId: id, baseUnit: 'BOUTEILLE', quantityInBaseUnits: 12, amountInCentimes: 1200 });
  assert.equal((await read(id)).stock.valuation.averageUnitCostInCentimes, 100);
});

test('zero purchase amounts are known while empty warehouse averages are not applicable', async () => {
  const id = await product();
  await seedValuedStockReceipt({ database, productId: id, amountInCentimes: 0 });
  const stocked = await read(id);
  assert.equal(stocked.stock.valuation.complete, true);
  assert.equal(stocked.stock.valuation.averageUnitCostInCentimes, 0);
  assert.equal(stocked.stock.movements[0].valueDeltaInCentimes, 0);
  await seedValuedTourLoading({ database, productId: id, tourId: new ObjectId(), reservationId: new ObjectId(), quantityInBaseUnits: 100 });
  const empty = await read(id);
  assert.equal(empty.stock.quantityInBaseUnits, 0);
  assert.equal(empty.stock.valuation.valueInCentimes, 0);
  assert.equal(empty.stock.valuation.averageUnitCostInCentimes, null);
});

test('pristine products show empty stock without writing valuation documents', async () => {
  const id = await product();
  const result = await read(id);
  assert.equal(result.stock.valuation.complete, true);
  assert.equal(result.stock.valuation.valueInCentimes, 0);
  assert.equal(result.stock.valuation.averageUnitCostInCentimes, null);
  assert.deepEqual(result.stock.movements, []);
  assert.equal(await database.collection('stockValuations').countDocuments({ productId: id }), 0);
});

test('missing, unknown, corrupt and incompatible history never exposes a partial stock value', async () => {
  for (const problem of ['missing', 'unknown', 'amount', 'unit', 'ledger', 'physical', 'return', 'source']) {
    const source = await history();
    if (problem === 'missing') await database.collection('stockValuations').deleteOne({ productId: source.productId });
    if (problem === 'unknown') await database.collection('stockValuations').updateOne({ productId: source.productId }, { $set: { status: 'UNVALUED', valueInCentimes: null } });
    if (problem === 'amount') await database.collection('stockValuations').updateOne({ productId: source.productId }, { $inc: { valueInCentimes: 1 } });
    if (problem === 'unit') await database.collection('products').updateOne({ _id: source.productId }, { $set: { baseUnit: 'BOITE' } });
    if (problem === 'ledger') await database.collection('stockValuationEntries').deleteOne({ _id: source.entries[0]._id });
    if (problem === 'physical') await database.collection('stockMovements').deleteOne({ _id: source.movements[0]._id });
    if (problem === 'return') await database.collection('stockValuationEntries').updateOne({ _id: source.entries[2]._id }, { $inc: { valueDeltaInCentimes: 1, 'after.valueInCentimes': 1 } });
    if (problem === 'source') await database.collection('stockValuationEntries').updateOne({ _id: source.entries[0]._id }, { $set: { sourceReceptionLineId: new ObjectId() } });
    const result = await read(source.productId);
    assert.equal(result.stock.valuation.complete, false, problem);
    assert.equal(result.stock.valuation.valueInCentimes, null, problem);
    assert.equal(result.stock.valuation.averageUnitCostInCentimes, null, problem);
    assert.ok(result.stock.movements.every((movement) => movement.valueDeltaInCentimes === null), problem);
  }
});

test('net-zero legacy movements and receptions without movements remain explicitly unvalued', async () => {
  const id = await product();
  await database.collection('stockMovements').insertMany([1, -1].map((quantityDeltaInBaseUnits) => ({
    productId: id, baseUnit: 'PIECE', kind: 'LEGACY', quantityDeltaInBaseUnits,
  })));
  const result = await read(id);
  assert.equal(result.stock.quantityInBaseUnits, 0);
  assert.equal(result.stock.valuation.complete, false);
  assert.equal(result.stock.valuation.valueInCentimes, null);
  const orphan = await product();
  await database.collection('receptions').insertOne({ lines: [{ productId: orphan, amountInCentimes: 100 }] });
  assert.equal((await read(orphan)).stock.valuation.complete, false);
});

test('pricing/reception access alone never exposes valuation or assigned costs', async () => {
  const source = await history();
  const hidden = await read(source.productId, { userId: hiddenReader.id, includePricing: true });
  assert.equal('valuation' in hidden.stock, false);
  assert.ok(hidden.stock.movements.every((movement) => !('valueDeltaInCentimes' in movement)));
  const ordinary = await getProductById(source.productId.toHexString(), { includeStockMovements: true, userId: reader.id });
  assert.equal('valuation' in ordinary.stock, false);
  assert.ok(ordinary.stock.movements.every((movement) => !('valueDeltaInCentimes' in movement)));
  assert.ok((await listProducts({ includePricing: true })).every((entry) => !('valuation' in entry)));
  assert.ok((await listProductStockMovements(source.productId)).every((movement) => !('valueDeltaInCentimes' in movement)));
});

test('permission revocation and inactive accounts are checked on every valuation read', async () => {
  const source = await history();
  const account = await user(['products.read', 'stock.valuation.read']);
  assert.equal((await read(source.productId, { userId: account.id })).stock.valuation.complete, true);
  await database.collection('roles').updateOne({ _id: account.roleId }, { $pull: { permissions: 'stock.valuation.read' } });
  assert.equal('valuation' in (await read(source.productId, { userId: account.id })).stock, false);
  await database.collection('users').updateOne({ _id: new ObjectId(account.id) }, { $set: { active: false } });
  await assert.rejects(read(source.productId, { userId: account.id }), PermissionDeniedError);
  const costsOnly = await user(['stock.valuation.read']);
  await assert.rejects(read(source.productId, { userId: costsOnly.id }), (error) => error.permission === 'products.read');
  await assert.rejects(read(source.productId, { userId: undefined }), PermissionDeniedError);
});

test('large safe integer purchase totals retain exact movement values', async () => {
  const id = await product();
  await seedValuedStockReceipt({ database, productId: id, quantityInBaseUnits: 1, amountInCentimes: Number.MAX_SAFE_INTEGER });
  const result = await read(id);
  assert.equal(result.stock.valuation.valueInCentimes, Number.MAX_SAFE_INTEGER);
  assert.equal(result.stock.movements[0].valueDeltaInCentimes, Number.MAX_SAFE_INTEGER);
});

test('snapshot reads reconcile the committed state even during a later reception', async () => {
  const source = await history();
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const before = await readProductStockValuation({ database, session, productId: source.productId, baseUnit: source.baseUnit });
      await receive(source.productId, 1, '2');
      const during = await readProductStockValuation({ database, session, productId: source.productId, baseUnit: source.baseUnit });
      assert.deepEqual(during, before);
      assert.equal(during.valuation.valueInCentimes, 67);
    }, { readConcern: { level: 'snapshot' } });
  } finally {
    await session.endSession();
  }
  assert.equal((await read(source.productId)).stock.valuation.valueInCentimes, 267);
});

test('invalid or missing products return null and internal valuation reads require a transaction', async () => {
  assert.equal(await getProductById('invalid', { includeValuation: true, userId: reader.id }), null);
  assert.equal(await read(new ObjectId()), null);
  await assert.rejects(readProductStockValuation({ database }), TypeError);
});
