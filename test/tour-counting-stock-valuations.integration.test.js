import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after } from 'node:test';
import { ObjectId } from 'mongodb';

const uri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
uri.pathname = `/syphax_count_valuation_${process.pid}_${randomUUID().replaceAll('-', '')}`;
process.env.MONGODB_URI = uri.toString();

const { getDatabase, closeMongoConnection } = await import('../lib/mongodb.js');
const { PermissionDeniedError } = await import('../lib/access.js');
const { seedValuedStockReceipt, seedValuedTourLoading } = await import('./helpers/stock-valuation-fixtures.js');
const { addAndReserveTourProduct, listTourReservations } = await import('../lib/tour-reservations.js');
const { confirmTourLoading, getTourLoadingPreview } = await import('../lib/tour-loadings.js');
const { confirmTourCounting, getTourCountingSheet, createTourCountingSheetDigest } = await import('../lib/tour-countings.js');
const { prepareTourCountingStockValuations, applyTourCountingStockValuations } = await import('../lib/tour-counting-stock-valuations.js');
const { readStoredStockValuationReconciliation } = await import('../lib/stock-valuations.js');
const { createReception } = await import('../lib/reception-records.js');
const { getTourById } = await import('../lib/tours.js');

const permissions = ['tours.read', 'tours.load', 'pricing.read', 'tours.count.prepare', 'tours.count.confirm'];
let database;
let userId;
let costReaderId;
let costRoleId;
const createUser = async (grants) => {
  const id = new ObjectId();
  const roleId = new ObjectId();
  await database.collection('roles').insertOne({ _id: roleId, permissions: grants });
  await database.collection('users').insertOne({ _id: id, username: `count-cost-${id}`, active: true, roleIds: [roleId] });
  return { id, roleId };
};

before(async () => {
  database = await getDatabase();
  userId = (await createUser(permissions)).id;
  const reader = await createUser([...permissions, 'stock.valuation.read']);
  costReaderId = reader.id;
  costRoleId = reader.roleId;
});
after(async () => {
  if (database) await database.dropDatabase();
  await closeMongoConnection();
});

const fixture = async ({ productId, initialQuantity = 100, initialValue = 500_000, loadedQuantity = 40, baseUnit = 'PIECE', packaging = false } = {}) => {
  const tourId = new ObjectId();
  const delivererId = new ObjectId();
  const packagingId = new ObjectId();
  if (!productId) {
    productId = new ObjectId();
    await database.collection('products').insertOne({
      _id: productId, active: true, baseUnit, code: `COST-${productId}`, designation: 'Produit coût historique',
      salePrice: { amountInCentimes: 1, currency: 'DZD', taxIncluded: true, versionId: new ObjectId() },
      packagings: packaging ? [{ _id: packagingId, label: 'Pack', quantity: 12, usage: 'SALE' }] : [],
    });
    await seedValuedStockReceipt({ database, productId, baseUnit, quantityInBaseUnits: initialQuantity, amountInCentimes: initialValue, recordedBy: userId });
  }
  await database.collection('deliverers').insertOne({ _id: delivererId, active: true, code: `LIV-${delivererId}`, name: 'Livreur coûts' });
  await database.collection('tours').insertOne({ _id: tourId, delivererId, reference: `TRN-${tourId}`, status: 'PREPARATION' });
  const added = await addAndReserveTourProduct({
    additionKey: randomUUID(), createdBy: userId.toHexString(), tourId: tourId.toHexString(),
    productId: productId.toHexString(), quantityMode: packaging ? 'PACKAGING' : 'DIRECT',
    directQuantity: String(loadedQuantity), packagingId: packagingId.toHexString(), packagingCount: String(loadedQuantity / 12),
  });
  assert.ok(added.reservation, JSON.stringify(added));
  const reservationId = new ObjectId(added.reservation.id);
  const preview = await getTourLoadingPreview({ tourId: tourId.toHexString(), userId: userId.toHexString() });
  assert.ok(preview.digest, JSON.stringify(preview));
  assert.ok((await confirmTourLoading({ tourId: tourId.toHexString(), loadedBy: userId.toHexString(), expectedDigest: preview.digest })).tourId);
  return { tourId, productId, reservationId, delivererId };
};
const sheet = (tourId, reader = userId) => getTourCountingSheet({ tourId: tourId.toHexString(), userId: reader.toHexString() });
const request = async (source, returnedQuantity = 10, reader = userId) => ({
  tourId: source.tourId.toHexString(), countedBy: reader.toHexString(), confirmationKey: randomUUID(),
  expectedSheetDigest: (await sheet(source.tourId, reader)).digest,
  lines: [{ lineId: source.reservationId.toHexString(), returnedQuantity: String(returnedQuantity) }],
});
const report = async (productId) => {
  const product = await database.collection('products').findOne({ _id: productId });
  return readStoredStockValuationReconciliation({ database, productId, baseUnit: product.baseUnit });
};
const snapshot = async (source, productIds = [source.productId]) => ({
  tour: await database.collection('tours').findOne({ _id: source.tourId }),
  deliverer: await database.collection('deliverers').findOne({ _id: source.delivererId }),
  products: await database.collection('products').find({ _id: { $in: productIds } }).sort({ _id: 1 }).toArray(),
  reservations: await database.collection('tourReservations').find({ tourId: source.tourId }).sort({ _id: 1 }).toArray(),
  countings: await database.collection('tourCountings').find({ tourId: source.tourId }).toArray(),
  valuations: await database.collection('stockValuations').find({ productId: { $in: productIds } }).sort({ _id: 1 }).toArray(),
  entries: await database.collection('stockValuationEntries').find({ productId: { $in: productIds } }).sort({ _id: 1 }).toArray(),
  movements: await database.collection('stockMovements').find({ productId: { $in: productIds } }).sort({ _id: 1 }).toArray(),
});
const receive = async (productId, quantity = 40, amountInCentimes = 280_000) => {
  const supplierId = new ObjectId();
  await database.collection('suppliers').insertOne({ _id: supplierId, active: true, code: `SUP-${supplierId}`, name: 'Fournisseur coûts' });
  const amount = `${Math.floor(amountInCentimes / 100)}.${String(amountInCentimes % 100).padStart(2, '0')}`;
  const result = await createReception({
    createdBy: userId.toHexString(), submissionKey: randomUUID(), supplierId: supplierId.toHexString(),
    receptionDate: '2026-09-01', supplierReference: 'BL-COUNT', lines: [{ productId: productId.toHexString(), baseUnit: 'PIECE', quantityMode: 'DIRECT', directQuantity: String(quantity), amount }],
  });
  assert.equal(result.replayed, false, JSON.stringify(result));
  return result;
};

test('partial returns restore original costs after a differently priced receipt and preserve all loading history', async () => {
  const source = await fixture();
  const approval = await request(source);
  const reservation = await database.collection('tourReservations').findOne({ _id: source.reservationId });
  const loadingEntry = await database.collection('stockValuationEntries').findOne({ sourceTourReservationId: source.reservationId });
  await receive(source.productId);
  assert.equal((await sheet(source.tourId)).digest, approval.expectedSheetDigest);
  const result = await confirmTourCounting(approval);
  assert.ok(result.countingId);
  const counting = await database.collection('tourCountings').findOne({ tourId: source.tourId });
  assert.deepEqual(counting.lines[0].purchaseCostAtLoading, reservation.purchaseCostAtLoading);
  assert.equal(counting.lines[0].returnedValueInCentimes, 50_000);
  assert.equal(counting.lines[0].costOfGoodsSoldInCentimes, 150_000);
  assert.equal(counting.totalPurchaseCostInCentimes, 200_000);
  assert.equal(counting.totalReturnedValueInCentimes + counting.totalCostOfGoodsSoldInCentimes, 200_000);
  const reconciled = await report(source.productId);
  assert.equal(reconciled.complete, true);
  assert.equal(reconciled.quantityInBaseUnits, 110);
  assert.equal(reconciled.valueInCentimes, 630_000);
  assert.deepEqual(await database.collection('tourReservations').findOne({ _id: source.reservationId }), reservation);
  assert.deepEqual(await database.collection('stockValuationEntries').findOne({ _id: loadingEntry._id }), loadingEntry);
  const returned = await database.collection('stockValuationEntries').findOne({ kind: 'TOUR_RETURN_IN', sourceTourReservationId: source.reservationId });
  assert.equal(returned.valueDeltaInCentimes, 50_000);
  assert.equal(returned.sourceTourCountingId.toHexString(), result.countingId);
  const immutable = await database.collection('tourCountings').findOne({ tourId: source.tourId });
  await receive(source.productId, 1, 999);
  assert.deepEqual(await database.collection('tourCountings').findOne({ tourId: source.tourId }), immutable);
});

test('zero/full returns, zero-cost goods and centime rounding conserve original loading costs', async () => {
  for (const [value, quantity, returned, restored, sold] of [
    [100, 3, 0, 0, 100], [100, 3, 1, 33, 67], [100, 3, 3, 100, 0], [0, 3, 2, 0, 0], [1, 2, 1, 1, 0],
  ]) {
    const source = await fixture({ initialQuantity: quantity, initialValue: value, loadedQuantity: quantity });
    const before = await database.collection('stockValuations').findOne({ productId: source.productId });
    assert.ok((await confirmTourCounting(await request(source, returned))).countingId);
    const counting = await database.collection('tourCountings').findOne({ tourId: source.tourId });
    assert.equal(counting.totalReturnedValueInCentimes, restored);
    assert.equal(counting.totalCostOfGoodsSoldInCentimes, sold);
    const reconciled = await report(source.productId);
    assert.equal(reconciled.complete, true);
    assert.equal(reconciled.valueInCentimes, restored);
    assert.equal(reconciled.quantityInBaseUnits, returned);
    assert.equal(await database.collection('stockValuationEntries').countDocuments({ productId: source.productId, kind: 'TOUR_RETURN_IN' }), returned ? 1 : 0);
    if (!returned) assert.deepEqual(await database.collection('stockValuations').findOne({ productId: source.productId }), before);
  }
});

test('packaging returns allocate the original cost in base units', async () => {
  const source = await fixture({ initialQuantity: 120, loadedQuantity: 60, initialValue: 12_000, packaging: true, baseUnit: 'BOUTEILLE' });
  assert.ok((await confirmTourCounting(await request(source, 12))).countingId);
  const counting = await database.collection('tourCountings').findOne({ tourId: source.tourId });
  assert.equal(counting.totalReturnedValueInCentimes, 1_200);
  assert.equal(counting.totalCostOfGoodsSoldInCentimes, 4_800);
  assert.equal((await report(source.productId)).complete, true);
});

test('hidden readers can count but never receive purchase costs, including confirmation retries', async () => {
  const source = await fixture();
  const hidden = await sheet(source.tourId);
  const visible = await sheet(source.tourId, costReaderId);
  assert.equal(hidden.digest, visible.digest);
  assert.equal('purchaseCostAtLoading' in hidden.lines[0], false);
  assert.equal(visible.lines[0].purchaseCostAtLoading.valueInCentimes, 200_000);
  const approval = await request(source);
  const result = await confirmTourCounting(approval);
  assert.equal('totalPurchaseCostInCentimes' in result, false);
  const after = await snapshot(source);
  for (const key of [approval.confirmationKey, randomUUID()]) {
    assert.equal((await confirmTourCounting({ ...approval, confirmationKey: key })).replayed, true);
  }
  assert.equal(await database.collection('stockValuationEntries').countDocuments({ kind: 'TOUR_RETURN_IN', productId: source.productId }), 1);
  assert.deepEqual((await snapshot(source)).valuations, after.valuations);
  assert.deepEqual((await snapshot(source)).entries, after.entries);
  const storedHidden = await sheet(source.tourId);
  const storedVisible = await sheet(source.tourId, costReaderId);
  for (const key of ['purchaseCostAtLoading', 'returnedValueInCentimes', 'costOfGoodsSoldInCentimes']) assert.equal(key in storedHidden.lines[0], false);
  for (const key of ['totalPurchaseCostInCentimes', 'totalReturnedValueInCentimes', 'totalCostOfGoodsSoldInCentimes']) assert.equal(key in storedHidden, false);
  assert.equal(storedVisible.totalReturnedValueInCentimes, 50_000);
  assert.equal(storedVisible.lines[0].costOfGoodsSoldInCentimes, 150_000);
  const detail = await getTourById(source.tourId.toHexString(), { includePricing: true, userId: costReaderId.toHexString() });
  assert.equal('purchaseCostAtLoading' in detail.lines[0], false);
  assert.equal('purchaseCostAtLoading' in (await listTourReservations({ database, tourId: source.tourId.toHexString() }))[0], false);
  await database.collection('roles').updateOne({ _id: costRoleId }, { $pull: { permissions: 'stock.valuation.read' } });
  try {
    assert.equal('purchaseCostAtLoading' in (await sheet(source.tourId, costReaderId)).lines[0], false);
  } finally {
    await database.collection('roles').updateOne({ _id: costRoleId }, { $addToSet: { permissions: 'stock.valuation.read' } });
  }
});

test('legacy recorded costs remain explicitly unknown for authorized readers', async () => {
  const source = await fixture();
  assert.ok((await confirmTourCounting(await request(source))).countingId);
  await database.collection('tourCountings').updateOne({ tourId: source.tourId }, { $unset: {
    'lines.0.purchaseCostAtLoading': '', 'lines.0.returnedValueInCentimes': '', 'lines.0.costOfGoodsSoldInCentimes': '',
    totalPurchaseCostInCentimes: '', totalReturnedValueInCentimes: '', totalCostOfGoodsSoldInCentimes: '',
  } });
  await database.collection('tours').updateOne({ _id: source.tourId }, { $set: { status: 'CLOSED' } });
  const recorded = await sheet(source.tourId, costReaderId);
  assert.equal(recorded.recorded, true);
  assert.equal(recorded.lines[0].purchaseCostAtLoading, null);
  assert.equal(recorded.totalCostOfGoodsSoldInCentimes, null);
});

test('missing, unknown, corrupt, mismatched or unlinked costs block previews and confirmation without writes', async () => {
  for (const problem of ['snapshot', 'amount', 'version', 'unit', 'quantity', 'currency', 'tax', 'missing', 'unknown', 'ledger', 'physical', 'source', 'source-ledger', 'returned']) {
    const source = await fixture();
    const approval = await request(source, 0);
    if (problem === 'snapshot') await database.collection('tourReservations').updateOne({ _id: source.reservationId }, { $unset: { purchaseCostAtLoading: '' } });
    const changes = { amount: ['valueInCentimes', 123], version: ['version', 2], unit: ['baseUnit', 'BOITE'], quantity: ['quantityInBaseUnits', 39], currency: ['currency', 'EUR'], tax: ['taxIncluded', false] };
    if (changes[problem]) {
      const [key, value] = changes[problem];
      await database.collection('tourReservations').updateOne({ _id: source.reservationId }, { $set: { [`purchaseCostAtLoading.${key}`]: value } });
    }
    if (problem === 'missing') await database.collection('stockValuations').deleteOne({ productId: source.productId });
    if (problem === 'unknown') await database.collection('stockValuations').updateOne({ productId: source.productId }, { $set: { status: 'UNVALUED', valueInCentimes: null } });
    if (problem === 'ledger') await database.collection('stockValuations').updateOne({ productId: source.productId }, { $inc: { valueInCentimes: 1 } });
    if (problem === 'physical') await database.collection('stockMovements').insertOne({ productId: source.productId, baseUnit: 'PIECE', quantityDeltaInBaseUnits: 1 });
    if (problem === 'source') await database.collection('tourReservations').updateOne({ _id: source.reservationId }, { $set: { tourId: new ObjectId() } });
    if (problem === 'source-ledger') {
      const otherTourId = new ObjectId();
      for (const collection of ['stockMovements', 'stockValuationEntries']) {
        await database.collection(collection).updateOne({ sourceTourReservationId: source.reservationId }, { $set: { sourceTourId: otherTourId } });
      }
      assert.equal((await report(source.productId)).complete, true);
    }
    if (problem === 'returned') {
      assert.ok((await confirmTourCounting(await request(source))).countingId);
      await database.collection('tourCountings').deleteOne({ tourId: source.tourId });
      await database.collection('tours').updateOne({ _id: source.tourId }, { $set: { status: 'LOADED' } });
    }
    const before = await snapshot(source);
    const blocked = await sheet(source.tourId);
    assert.ok(blocked.errors.form, problem);
    assert.equal(blocked.digest, undefined);
    assert.deepEqual(blocked.lines, []);
    assert.ok((await confirmTourCounting(approval)).errors.form, problem);
    assert.deepEqual(await snapshot(source), before, problem);
  }
});

test('changing a valid original snapshot changes the sheet digest and rejects a stale confirmation', async () => {
  const source = await fixture();
  const approval = await request(source);
  const reservations = await database.collection('tourReservations').find({ tourId: source.tourId }).toArray();
  const original = createTourCountingSheetDigest(reservations);
  reservations[0].purchaseCostAtLoading.valueInCentimes += 1;
  assert.notEqual(createTourCountingSheetDigest(reservations), original);
  await database.collection('tourReservations').updateOne({ _id: source.reservationId }, { $inc: { 'purchaseCostAtLoading.valueInCentimes': 1 } });
  const before = await snapshot(source);
  assert.match((await confirmTourCounting(approval)).errors.form, /historiques ont changé/u);
  assert.deepEqual(await snapshot(source), before);
});

test('concurrent countings sharing one product and a concurrent receipt conserve the committed balance', async () => {
  const first = await fixture();
  const second = await fixture({ productId: first.productId, loadedQuantity: 20 });
  const [firstRequest, secondRequest] = await Promise.all([request(first, 10), request(second, 5)]);
  const results = await Promise.all([confirmTourCounting(firstRequest), confirmTourCounting(secondRequest), receive(first.productId)]);
  assert.ok(results[0].countingId);
  assert.ok(results[1].countingId);
  const reconciled = await report(first.productId);
  assert.equal(reconciled.complete, true);
  assert.equal(reconciled.quantityInBaseUnits, 95);
  assert.equal(reconciled.valueInCentimes, 555_000);
});

test('a return invalidates an existing loading approval and the refreshed loading uses the new warehouse balance', async () => {
  const first = await fixture();
  const tourId = new ObjectId();
  await database.collection('tours').insertOne({ _id: tourId, delivererId: first.delivererId, reference: `TRN-${tourId}`, status: 'PREPARATION' });
  assert.ok((await addAndReserveTourProduct({ additionKey: randomUUID(), createdBy: userId.toHexString(), tourId: tourId.toHexString(), productId: first.productId.toHexString(), quantityMode: 'DIRECT', directQuantity: '10' })).reservation);
  const approval = await getTourLoadingPreview({ tourId: tourId.toHexString(), userId: userId.toHexString() });
  assert.ok((await confirmTourCounting(await request(first))).countingId);
  assert.match((await confirmTourLoading({ tourId: tourId.toHexString(), loadedBy: userId.toHexString(), expectedDigest: approval.digest })).errors.form, /valorisation.*changé/u);
  const refreshed = await getTourLoadingPreview({ tourId: tourId.toHexString(), userId: userId.toHexString() });
  assert.ok((await confirmTourLoading({ tourId: tourId.toHexString(), loadedBy: userId.toHexString(), expectedDigest: refreshed.digest })).tourId);
  assert.equal((await report(first.productId)).complete, true);
});

test('revoked counting permission blocks a previously approved confirmation', async () => {
  const reader = await createUser(permissions);
  const source = await fixture();
  const approval = await request(source, 10, reader.id);
  await database.collection('roles').updateOne({ _id: reader.roleId }, { $pull: { permissions: 'tours.count.confirm' } });
  const before = await snapshot(source);
  await assert.rejects(confirmTourCounting(approval), (error) => error instanceof PermissionDeniedError && error.permission === 'tours.count.confirm');
  assert.deepEqual(await snapshot(source), before);
});

test('large original purchase values allocate exactly without unsafe products', async () => {
  const source = await fixture({ initialQuantity: 100, loadedQuantity: 100, initialValue: Number.MAX_SAFE_INTEGER });
  assert.ok((await confirmTourCounting(await request(source, 1))).countingId);
  const counting = await database.collection('tourCountings').findOne({ tourId: source.tourId });
  assert.equal(counting.totalReturnedValueInCentimes, 90_071_992_547_410);
  assert.equal(counting.totalReturnedValueInCentimes + counting.totalCostOfGoodsSoldInCentimes, Number.MAX_SAFE_INTEGER);
  assert.equal((await report(source.productId)).complete, true);
});

test('warehouse quantity/value overflow rejects the entire return transaction', async () => {
  for (const kind of ['quantity', 'value']) {
    const source = await fixture({ initialQuantity: kind === 'quantity' ? Number.MAX_SAFE_INTEGER : 1, initialValue: kind === 'quantity' ? 0 : Number.MAX_SAFE_INTEGER, loadedQuantity: 1 });
    const approval = await request(source, 1);
    await receive(source.productId, 1, kind === 'quantity' ? 0 : Number.MAX_SAFE_INTEGER);
    const before = await snapshot(source);
    assert.match((await confirmTourCounting(approval)).errors.form, /numeric range/u);
    assert.deepEqual(await snapshot(source), before);
  }
});

const addImportedLine = async (source, value = 100, quantity = 3) => {
  const productId = new ObjectId();
  const reservationId = new ObjectId();
  await database.collection('products').insertOne({ _id: productId, baseUnit: 'PIECE', code: `IMPORT-${productId}`, designation: 'Produit importé' });
  await seedValuedStockReceipt({ database, productId, quantityInBaseUnits: quantity, amountInCentimes: value, recordedBy: userId });
  await database.collection('tourReservations').insertOne({
    _id: reservationId, tourId: source.tourId, productId, baseUnit: 'PIECE', productCode: `IMPORT-${productId}`, productDesignation: 'Produit importé',
    status: 'LOADED', quantityInBaseUnits: quantity, salePriceAtLoading: { amountInCentimes: 1, currency: 'DZD', taxIncluded: true, unit: 'PIECE' },
  });
  await seedValuedTourLoading({ database, productId, tourId: source.tourId, reservationId, quantityInBaseUnits: quantity, recordedBy: userId });
  return { productId, reservationId };
};

test('combined cost overflow rejects preview and confirmation even when costs are hidden', async () => {
  const source = await fixture({ initialQuantity: 1, loadedQuantity: 1, initialValue: Number.MAX_SAFE_INTEGER });
  const second = await addImportedLine(source, Number.MAX_SAFE_INTEGER, 1);
  const reservations = await database.collection('tourReservations').find({ tourId: source.tourId }).toArray();
  const before = await snapshot(source, [source.productId, second.productId]);
  assert.match((await sheet(source.tourId)).errors.form, /coût d’achat total.*limite/u);
  const result = await confirmTourCounting({
    countedBy: userId.toHexString(), confirmationKey: randomUUID(), tourId: source.tourId.toHexString(), expectedSheetDigest: createTourCountingSheetDigest(reservations),
    lines: reservations.map((line) => ({ lineId: line._id.toHexString(), returnedQuantity: '0' })),
  });
  assert.match(result.errors.form, /coût d’achat total.*limite/u);
  assert.deepEqual(await snapshot(source, [source.productId, second.productId]), before);
});

test('ledger and physical movement failures roll back all valuation transfers and coordination locks', async () => {
  for (const collection of ['stockValuationEntries', 'stockMovements']) {
    const source = await fixture();
    const second = await addImportedLine(source);
    const approval = await request(source);
    approval.lines.push({ lineId: second.reservationId.toHexString(), returnedQuantity: '1' });
    const before = await snapshot(source, [source.productId, second.productId]);
    await database.collection(collection).createIndex({ sourceTourCountingId: 1 }, {
      name: 'force_return_failure', unique: true,
      partialFilterExpression: { sourceTourId: source.tourId, kind: 'TOUR_RETURN_IN' },
    });
    try {
      await assert.rejects(confirmTourCounting(approval), { code: 11000 });
      assert.deepEqual(await snapshot(source, [source.productId, second.productId]), before);
    } finally {
      await database.collection(collection).dropIndex('force_return_failure');
    }
  }
});

test('counting valuation services require a transaction', async () => {
  await assert.rejects(prepareTourCountingStockValuations({ database, lines: [] }), TypeError);
  await assert.rejects(applyTourCountingStockValuations({ database }), TypeError);
});

test('multiple source lines for the same product restore independently allocated original costs in ledger order', async () => {
  const source = await fixture({ initialQuantity: 3, initialValue: 100, loadedQuantity: 1 });
  const reservationId = new ObjectId();
  await database.collection('tourReservations').insertOne({
    _id: reservationId, tourId: source.tourId, productId: source.productId, baseUnit: 'PIECE',
    productCode: 'REPEATED', productDesignation: 'Autre ligne du même produit', status: 'LOADED', quantityInBaseUnits: 1,
    salePriceAtLoading: { amountInCentimes: 1, currency: 'DZD', taxIncluded: true, unit: 'PIECE' },
  });
  await seedValuedTourLoading({ database, productId: source.productId, tourId: source.tourId, reservationId, quantityInBaseUnits: 1, recordedBy: userId });
  const approval = await request(source, 1);
  approval.lines.push({ lineId: reservationId.toHexString(), returnedQuantity: '1' });
  assert.ok((await confirmTourCounting(approval)).countingId);
  const counting = await database.collection('tourCountings').findOne({ tourId: source.tourId });
  assert.deepEqual(counting.lines.map((line) => line.returnedValueInCentimes), [33, 34]);
  assert.equal(counting.totalReturnedValueInCentimes, 67);
  assert.equal(counting.totalCostOfGoodsSoldInCentimes, 0);
  const entries = await database.collection('stockValuationEntries').find({ productId: source.productId }).sort({ revision: 1 }).toArray();
  assert.deepEqual(entries.map((entry) => entry.valueDeltaInCentimes), [100, -33, -34, 33, 34]);
  const reconciled = await report(source.productId);
  assert.equal(reconciled.complete, true);
  assert.equal(reconciled.quantityInBaseUnits, 3);
  assert.equal(reconciled.valueInCentimes, 100);
});

test('a concurrent loading and counting serialize stock locks without changing the original sold cost', async () => {
  const source = await fixture();
  const tourId = new ObjectId();
  const delivererId = new ObjectId();
  await database.collection('deliverers').insertOne({ _id: delivererId, active: true, code: `LIV-${delivererId}`, name: 'Livreur concurrent' });
  await database.collection('tours').insertOne({ _id: tourId, delivererId, reference: `TRN-${tourId}`, status: 'PREPARATION' });
  assert.ok((await addAndReserveTourProduct({ additionKey: randomUUID(), createdBy: userId.toHexString(), tourId: tourId.toHexString(), productId: source.productId.toHexString(), quantityMode: 'DIRECT', directQuantity: '10' })).reservation);
  const preview = await getTourLoadingPreview({ tourId: tourId.toHexString(), userId: userId.toHexString() });
  const approval = await request(source);
  const [counted, loaded] = await Promise.all([
    confirmTourCounting(approval),
    confirmTourLoading({ tourId: tourId.toHexString(), loadedBy: userId.toHexString(), expectedDigest: preview.digest }),
  ]);
  assert.ok(counted.countingId);
  if (loaded.errors) {
    assert.match(loaded.errors.form, /valorisation.*changé/u);
    const refreshed = await getTourLoadingPreview({ tourId: tourId.toHexString(), userId: userId.toHexString() });
    assert.ok((await confirmTourLoading({ tourId: tourId.toHexString(), loadedBy: userId.toHexString(), expectedDigest: refreshed.digest })).tourId);
  }
  const reconciled = await report(source.productId);
  assert.equal(reconciled.complete, true);
  assert.equal(reconciled.quantityInBaseUnits, 60);
  assert.equal(reconciled.valueInCentimes, 300_000);
  const counting = await database.collection('tourCountings').findOne({ tourId: source.tourId });
  assert.equal(counting.totalCostOfGoodsSoldInCentimes, 150_000);
});
