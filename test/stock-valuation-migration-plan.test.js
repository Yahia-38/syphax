import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';

import { createStockMigrationFixture } from './helpers/stock-migration-fixtures.js';
import { fingerprintStockMigration, planStockValuationMigration } from '../lib/stock-valuation-migration-plan.js';
import { createStockValuationMigrationPreview } from '../lib/stock-valuation-migration.js';

const receiptAt = (snapshot, hour) => snapshot.receptions.find((reception) => reception.createdAt.getUTCHours() === hour);
const hydrate = (snapshot, plan) => {
  snapshot.stockValuationEntries = plan.proposals.flatMap((proposal) => proposal.newEntries ?? []);
  snapshot.stockValuations = plan.proposals.filter((proposal) => proposal.updateValuation).map((proposal) => proposal.valuation);
  for (const update of plan.reservationUpdates) snapshot.tourReservations.find((line) => line._id.equals(update._id)).purchaseCostAtLoading = update.purchaseCostAtLoading;
  for (const update of plan.countingUpdates) {
    const counting = snapshot.tourCountings.find((record) => record._id.equals(update._id));
    for (const [key, value] of Object.entries(update.fields)) {
      const match = /^lines\.(\d+)\.(\w+)$/u.exec(key);
      if (match) counting.lines[Number(match[1])][match[2]] = value;
      else counting[key] = value;
    }
  }
};

test('replays recording order, conserves purchase value and allocates returns at original cost', () => {
  const { snapshot } = createStockMigrationFixture();
  const before = fingerprintStockMigration(snapshot);
  const plan = planStockValuationMigration(snapshot);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.canApply, true);
  assert.equal(plan.products[0].quantityInBaseUnits, 110);
  assert.equal(plan.products[0].valueInCentimes, 630_000);
  assert.equal(plan.products[0].heldOnToursValueInCentimes, 0);
  assert.equal(plan.products[0].costOfGoodsSoldInCentimes, 150_000);
  assert.deepEqual(plan.proposals[0].newEntries.map((entry) => entry.valueDeltaInCentimes), [500_000, -200_000, 280_000, 50_000]);
  assert.equal(plan.countingUpdates[0].fields.totalPurchaseCostInCentimes, 200_000);
  assert.equal(plan.countingUpdates[0].fields.totalReturnedValueInCentimes, 50_000);
  assert.equal(plan.countingUpdates[0].fields.totalCostOfGoodsSoldInCentimes, 150_000);
  assert.equal(fingerprintStockMigration(snapshot), before);
  assert.equal(fingerprintStockMigration(planStockValuationMigration(snapshot)), fingerprintStockMigration(plan));
});

test('uncounted loadings remain held on tours, separately from warehouse and sold costs', () => {
  const { snapshot } = createStockMigrationFixture({ counted: false });
  const plan = planStockValuationMigration(snapshot);
  assert.equal(plan.canApply, true);
  assert.equal(plan.products[0].valueInCentimes, 580_000);
  assert.equal(plan.products[0].heldOnToursValueInCentimes, 200_000);
  assert.equal(plan.products[0].costOfGoodsSoldInCentimes, 0);
});

test('repeated product lines use combined loading allocation and stable reservation order with exact rounding', () => {
  const { snapshot, reservationId } = createStockMigrationFixture({ returnedQuantity: 1, amount: 100 });
  const firstReceipt = receiptAt(snapshot, 8);
  firstReceipt.lines[0].quantityInBaseUnits = 3;
  snapshot.stockMovements.find((movement) => movement.sourceReceptionId?.equals(firstReceipt._id)).quantityDeltaInBaseUnits = 3;
  const original = snapshot.tourReservations[0];
  original.quantityInBaseUnits = 1;
  const second = { ...original, _id: new ObjectId() };
  snapshot.tourReservations.push(second);
  const loading = snapshot.stockMovements.find((movement) => movement.kind === 'TOUR_LOADING_OUT');
  loading.quantityDeltaInBaseUnits = -1;
  snapshot.stockMovements.push({ ...loading, _id: new ObjectId(), sourceTourReservationId: second._id });
  const counting = snapshot.tourCountings[0];
  Object.assign(counting.lines[0], { quantityInBaseUnits: 1, soldQuantityInBaseUnits: 0, amountDueInCentimes: 0 });
  counting.lines.push({ ...counting.lines[0], sourceTourReservationId: second._id,
    returnedQuantityInBaseUnits: 0, soldQuantityInBaseUnits: 1, amountDueInCentimes: 10_000 });
  const plan = planStockValuationMigration(snapshot);
  assert.equal(plan.canApply, true, JSON.stringify(plan.issues));
  assert.deepEqual(plan.reservationUpdates.map((line) => line.purchaseCostAtLoading.valueInCentimes), [34, 33]);
  assert.equal(plan.reservationUpdates[0]._id.toHexString(), reservationId.toHexString());
  assert.equal(plan.countingUpdates[0].fields.totalPurchaseCostInCentimes, 67);
  assert.equal(plan.countingUpdates[0].fields.totalReturnedValueInCentimes, 34);
  assert.equal(plan.countingUpdates[0].fields.totalCostOfGoodsSoldInCentimes, 33);
});

test('packaging conversion is checked against historical snapshots without consulting current packs', () => {
  const { snapshot } = createStockMigrationFixture();
  for (const name of ['products', 'tourReservations', 'stockMovements']) for (const line of snapshot[name]) line.baseUnit = 'BOUTEILLE';
  for (const reception of snapshot.receptions) for (const line of reception.lines) {
    line.baseUnit = 'BOUTEILLE';
    line.packaging = { quantity: 10, count: line.quantityInBaseUnits / 10 };
  }
  for (const line of snapshot.tourCountings[0].lines) line.baseUnit = 'BOUTEILLE';
  snapshot.tourReservations[0].packaging = { quantity: 10, count: 4 };
  const plan = planStockValuationMigration(snapshot);
  assert.equal(plan.canApply, true);
  assert.equal(plan.reservationUpdates[0].purchaseCostAtLoading.baseUnit, 'BOUTEILLE');
  assert.equal(plan.products[0].valueInCentimes, 630_000);
});

test('reception lines retain their source order and missing movement timestamps use source recording time', () => {
  const { snapshot, productId } = createStockMigrationFixture();
  const receipt = receiptAt(snapshot, 8);
  const line = { ...receipt.lines[0], _id: new ObjectId(), quantityInBaseUnits: 1, amountInCentimes: 0 };
  receipt.lines.unshift(line);
  snapshot.stockMovements.push({ _id: new ObjectId(), productId, baseUnit: 'PIECE', kind: 'RECEPTION_IN',
    quantityDeltaInBaseUnits: 1, sourceReceptionId: receipt._id, sourceReceptionLineId: line._id });
  const plan = planStockValuationMigration(snapshot);
  assert.equal(plan.canApply, true);
  assert.equal(plan.proposals[0].newEntries[0].sourceReceptionLineId.toHexString(), line._id.toHexString());
  assert.equal(+plan.proposals[0].newEntries[0].recordedAt, +receipt.createdAt);
});

test('zero/full returns and zero purchase amounts preserve exact totals without zero movements', () => {
  for (const returnedQuantity of [0, 40]) {
    const { snapshot } = createStockMigrationFixture({ returnedQuantity, amount: 0 });
    const plan = planStockValuationMigration(snapshot);
    assert.equal(plan.canApply, true);
    assert.equal(plan.products[0].valueInCentimes, 280_000);
    assert.equal(plan.countingUpdates[0].fields.totalPurchaseCostInCentimes, 0);
    assert.equal(plan.countingUpdates[0].fields.totalCostOfGoodsSoldInCentimes, 0);
    assert.equal(plan.proposals[0].newEntries.filter((entry) => entry.kind === 'TOUR_RETURN_IN').length, returnedQuantity ? 1 : 0);
  }
});

test('pristine products require no writes and legacy net-zero movements remain blocked', () => {
  const { snapshot, productId } = createStockMigrationFixture();
  for (const name of Object.keys(snapshot)) if (name !== 'products') snapshot[name] = [];
  const plan = planStockValuationMigration(snapshot);
  assert.equal(plan.canApply, true);
  assert.equal(plan.proposals[0].updateValuation, false);
  assert.equal(plan.products[0].valueInCentimes, 0);
  snapshot.stockMovements = [1, -1].map((quantityDeltaInBaseUnits) => ({ _id: new ObjectId(), productId, baseUnit: 'PIECE', kind: 'LEGACY', quantityDeltaInBaseUnits }));
  assert.equal(planStockValuationMigration(snapshot).canApply, false);
});

test('missing amounts, invalid units, quantities, sources, packaging, dates and duplicate movements are reported', () => {
  const problems = {
    amount: (source) => { delete source.receptions[0].lines[0].amountInCentimes; },
    negativeAmount: (source) => { source.receptions[0].lines[0].amountInCentimes = -1; },
    currency: (source) => { source.receptions[0].currency = 'EUR'; },
    tax: (source) => { source.receptions[0].lines[0].taxIncluded = false; },
    unit: (source) => { source.receptions[0].lines[0].baseUnit = 'BOITE'; },
    quantity: (source) => { source.receptions[0].lines[0].quantityInBaseUnits = 3.5; },
    packaging: (source) => { source.receptions[0].lines[0].packaging = { quantity: 12, count: 2 }; },
    date: (source) => { delete source.receptions[0].createdAt; },
    movementDate: (source) => { source.stockMovements[0].recordedAt = new Date(0); },
    movement: (source) => { source.stockMovements.pop(); },
    duplicate: (source) => { source.stockMovements.push({ ...source.stockMovements[0], _id: new ObjectId() }); },
    source: (source) => { source.stockMovements[0].sourceReceptionLineId = new ObjectId(); },
    reservation: (source) => { source.tourCountings[0].lines[0].sourceTourReservationId = new ObjectId(); },
    countingQuantity: (source) => { source.tourCountings[0].lines[0].returnedQuantityInBaseUnits = 41; },
    soldQuantity: (source) => { source.tourCountings[0].lines[0].soldQuantityInBaseUnits = 0; },
    countingLines: (source) => { source.tourCountings[0].lines = 'corrupt'; },
    receptionLines: (source) => { source.receptions[0].lines = [null]; },
    tour: (source) => { source.tours = []; },
    product: (source) => { source.products = []; },
  };
  for (const [name, corrupt] of Object.entries(problems)) {
    const { snapshot } = createStockMigrationFixture();
    corrupt(snapshot);
    const plan = planStockValuationMigration(snapshot);
    assert.equal(plan.canApply, false, name);
    assert.ok(plan.issues.length, name);
  }
});

test('stock underflow and safe integer overflow block replay', () => {
  const { snapshot } = createStockMigrationFixture();
  receiptAt(snapshot, 8).lines[0].amountInCentimes = Number.MAX_SAFE_INTEGER;
  receiptAt(snapshot, 12).lines[0].amountInCentimes = Number.MAX_SAFE_INTEGER;
  assert.equal(planStockValuationMigration(snapshot).canApply, false);
  const source = createStockMigrationFixture().snapshot;
  receiptAt(source, 8).lines[0].quantityInBaseUnits = 1;
  source.stockMovements.find((movement) => movement.kind === 'RECEPTION_IN' && movement.quantityDeltaInBaseUnits === 100).quantityDeltaInBaseUnits = 1;
  assert.equal(planStockValuationMigration(source).canApply, false);
});

test('equal-time receipts use stable order while a cost-changing loading tie is flagged', () => {
  const { snapshot } = createStockMigrationFixture();
  const later = receiptAt(snapshot, 12);
  later.createdAt = receiptAt(snapshot, 8).createdAt;
  snapshot.stockMovements.find((movement) => movement.sourceReceptionId?.equals(later._id)).recordedAt = later.createdAt;
  assert.equal(planStockValuationMigration(snapshot).canApply, true);
  const source = createStockMigrationFixture().snapshot;
  const reception = receiptAt(source, 12);
  reception.createdAt = source.tours[0].loadedAt;
  source.stockMovements.find((movement) => movement.sourceReceptionId?.equals(reception._id)).recordedAt = reception.createdAt;
  assert.ok(planStockValuationMigration(source).issues.some((issue) => issue.code === 'AMBIGUOUS_ORDER'));
});

test('an equal-time receipt and loading with unchanged exact allocations can be replayed', () => {
  const { snapshot } = createStockMigrationFixture();
  const later = receiptAt(snapshot, 12);
  later.lines[0].amountInCentimes = 200_000;
  later.createdAt = snapshot.tours[0].loadedAt;
  snapshot.stockMovements.find((movement) => movement.sourceReceptionId?.equals(later._id)).recordedAt = later.createdAt;
  assert.equal(planStockValuationMigration(snapshot).canApply, true);
});

test('compatible existing costs and ledger entries are immutable and replay is idempotent', () => {
  const { snapshot } = createStockMigrationFixture();
  hydrate(snapshot, planStockValuationMigration(snapshot));
  const before = fingerprintStockMigration(snapshot);
  const plan = planStockValuationMigration(snapshot);
  assert.equal(plan.canApply, true);
  assert.equal(plan.proposals[0].updateValuation, false);
  assert.deepEqual(plan.proposals[0].newEntries, []);
  assert.deepEqual(plan.reservationUpdates, []);
  assert.deepEqual(plan.countingUpdates, []);
  assert.equal(fingerprintStockMigration(snapshot), before);
});

test('a compatible partial ledger and explicitly unvalued balance can be completed without rewriting its prefix', () => {
  const { snapshot } = createStockMigrationFixture();
  const original = planStockValuationMigration(snapshot);
  snapshot.stockValuationEntries = original.proposals[0].newEntries.slice(0, 1);
  snapshot.stockValuations = [{ ...original.proposals[0].valuation, status: 'UNVALUED', valueInCentimes: null,
    revision: 1, lastLedgerEntryId: snapshot.stockValuationEntries[0]._id }];
  const plan = planStockValuationMigration(snapshot);
  assert.equal(plan.canApply, true);
  assert.equal(plan.proposals[0].newEntries.length, 3);
  assert.equal(plan.proposals[0].updateValuation, true);
});

test('an existing immutable ledger proves order for a simultaneous loading and differently priced receipt', () => {
  const { snapshot } = createStockMigrationFixture();
  hydrate(snapshot, planStockValuationMigration(snapshot));
  const receipt = receiptAt(snapshot, 12);
  receipt.createdAt = snapshot.tours[0].loadedAt;
  snapshot.stockMovements.find((movement) => movement.sourceReceptionId?.equals(receipt._id)).recordedAt = receipt.createdAt;
  snapshot.stockValuationEntries.find((entry) => entry.sourceReceptionId?.equals(receipt._id)).recordedAt = receipt.createdAt;
  const plan = planStockValuationMigration(snapshot);
  assert.equal(plan.canApply, true, JSON.stringify(plan.issues));
  assert.deepEqual(plan.reservationUpdates, []);
  assert.deepEqual(plan.countingUpdates, []);
  assert.deepEqual(plan.proposals[0].newEntries, []);
});

test('existing conflicting purchase costs, totals and immutable ledger entries cannot be overwritten', () => {
  for (const problem of ['loading', 'counting', 'total', 'ledger', 'valuation']) {
    const { snapshot } = createStockMigrationFixture();
    hydrate(snapshot, planStockValuationMigration(snapshot));
    if (problem === 'loading') snapshot.tourReservations[0].purchaseCostAtLoading.valueInCentimes += 1;
    if (problem === 'counting') snapshot.tourCountings[0].lines[0].returnedValueInCentimes += 1;
    if (problem === 'total') snapshot.tourCountings[0].totalCostOfGoodsSoldInCentimes += 1;
    if (problem === 'ledger') snapshot.stockValuationEntries[0].valueDeltaInCentimes += 1;
    if (problem === 'valuation') snapshot.stockValuations[0].valueInCentimes += 1;
    assert.equal(planStockValuationMigration(snapshot).canApply, false, problem);
  }
});

test('explicitly unknown cost fields can be reconstructed but malformed known snapshots remain blocked', () => {
  const { snapshot } = createStockMigrationFixture();
  snapshot.tourReservations[0].purchaseCostAtLoading = null;
  snapshot.tourCountings[0].lines[0].returnedValueInCentimes = null;
  snapshot.tourCountings[0].totalPurchaseCostInCentimes = null;
  assert.equal(planStockValuationMigration(snapshot).canApply, true);
  snapshot.tourReservations[0].purchaseCostAtLoading = { version: 2 };
  assert.equal(planStockValuationMigration(snapshot).canApply, false);
});

test('preview includes source fingerprints, stock/tour/sold values and exact proposed assignments', () => {
  const { snapshot } = createStockMigrationFixture();
  const preview = createStockValuationMigrationPreview('test_database', snapshot);
  assert.equal(preview.canApply, true);
  assert.equal(preview.sourceFingerprint, fingerprintStockMigration(snapshot));
  assert.deepEqual(preview.changes, { valuations: 1, ledgerEntries: 4, reservations: 1, countings: 1 });
  assert.equal(preview.loadingCosts[0].purchaseCostAtLoading.valueInCentimes, 200_000);
  assert.equal(preview.movementValues.at(-1).valueDeltaInCentimes, 50_000);
  const { previewDigest, ...body } = JSON.parse(JSON.stringify(preview));
  assert.equal(previewDigest, fingerprintStockMigration(body));
});
