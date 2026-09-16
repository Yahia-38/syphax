import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectId } from 'mongodb';

import {
  createStockValuationEntry,
  createStockValuationRecord,
  doesStockValuationEntryMatchMovement,
  isValidStockValuationMovement,
  normalizeStoredStockValuation,
  normalizeStoredStockValuationEntry,
} from '../lib/stock-valuation-records.js';
import { reconcileStockValuation } from '../lib/stock-valuations.js';
import { createValuationHistory } from './helpers/stock-valuation-fixtures.js';

const issueCodes = (report) => report.issues.map((issue) => issue.code);

test('constructs a versioned empty record and represents unknown costs explicitly', () => {
  const input = { productId: new ObjectId(), baseUnit: 'BOUTEILLE' };
  const empty = createStockValuationRecord(input);
  const unknown = createStockValuationRecord({ ...input, status: 'UNVALUED', quantityInBaseUnits: 10, valueInCentimes: null });

  assert.equal(empty.method, 'MOVING_WEIGHTED_AVERAGE');
  assert.equal(empty.version, 1);
  assert.equal(empty.valueInCentimes, 0);
  assert.equal(empty.revision, 0);
  assert.equal(empty.lastLedgerEntryId, null);
  assert.equal(normalizeStoredStockValuation(empty), empty);
  assert.equal(normalizeStoredStockValuation(unknown), unknown);
  assert.throws(() => createStockValuationRecord({ ...input, status: 'UNVALUED' }), RangeError);
  assert.throws(() => createStockValuationRecord({ ...input, quantityInBaseUnits: 10 }), RangeError);
});

test('rejects invalid stored balances, identities, metadata and revision pointers', () => {
  const { valuation } = createValuationHistory();

  for (const change of [
    { _id: 'bad' }, { productId: 'bad' }, { baseUnit: '' }, { baseUnit: ' PIECE' },
    { method: 'LATEST_COST' }, { version: 2 }, { status: 'OTHER' },
    { quantityInBaseUnits: -1 }, { valueInCentimes: null }, { valueInCentimes: 0.5 },
    { quantityInBaseUnits: 0, valueInCentimes: 1 }, { revision: -1 },
    { revision: 1.5 }, { lastLedgerEntryId: null }, { revision: 0 },
    { updatedAt: new Date('invalid') },
  ]) {
    assert.equal(normalizeStoredStockValuation({ ...valuation, ...change }), null);
  }

  assert.equal(normalizeStoredStockValuation(null), null);
});

test('builds ledger entries for reception, loading and return with original source links', () => {
  const { entries, movements } = createValuationHistory();

  for (const [index, entry] of entries.entries()) {
    assert.equal(normalizeStoredStockValuationEntry(entry), entry);
    assert.equal(doesStockValuationEntryMatchMovement(entry, movements[index]), true);
    assert.equal(entry.revision, index + 1);
    assert.equal(entry.recordedBy.equals(movements[index].recordedBy), true);
  }

  assert.deepEqual(entries.map((entry) => entry.valueDeltaInCentimes), [100, -67, 34]);
  assert.equal(entries[2].sourceTourCountingId.equals(movements[2].sourceTourCountingId), true);
});

test('copies supplied balances so later caller changes cannot alter the entry', () => {
  const { entries, movements } = createValuationHistory();
  const before = { ...entries[0].before };
  const after = { ...entries[0].after };
  const entry = createStockValuationEntry({ movement: movements[0], before, after, revision: 1 });
  before.valueInCentimes = 999;
  after.quantityInBaseUnits = 999;

  assert.equal(entry.before.valueInCentimes, 0);
  assert.equal(entry.after.quantityInBaseUnits, 3);
});

test('rejects malformed or unsupported physical source movements', () => {
  const { entries, movements } = createValuationHistory();

  for (const change of [
    { kind: 'OTHER' }, { kind: 'toString' }, { kind: '__proto__' },
    { _id: null }, { productId: null }, { baseUnit: '' },
    { quantityDeltaInBaseUnits: 0 }, { quantityDeltaInBaseUnits: -3 },
    { quantityDeltaInBaseUnits: 0.5 }, { sourceReceptionId: null },
    { sourceReceptionLineId: undefined },
  ]) {
    const movement = { ...movements[0], ...change };
    assert.equal(isValidStockValuationMovement(movement), false);
    assert.throws(() => createStockValuationEntry({ movement, before: entries[0].before, after: entries[0].after, revision: 1 }), RangeError);
  }

  assert.equal(isValidStockValuationMovement(null), false);
});

test('rejects malformed ledger balances, signs, revisions and source IDs', () => {
  const { entries } = createValuationHistory();

  for (const change of [
    { sourceStockMovementId: null }, { revision: 0 }, { revision: 0.5 },
    { method: 'OTHER' }, { version: 2 }, { recordedAt: new Date('invalid') },
    { recordedBy: 'bad' }, { valueDeltaInCentimes: 99 }, { before: null },
    { after: { quantityInBaseUnits: 2, valueInCentimes: 100 } },
    { sourceReceptionLineId: null },
  ]) {
    assert.equal(normalizeStoredStockValuationEntry({ ...entries[0], ...change }), null);
  }

  assert.equal(normalizeStoredStockValuationEntry({
    ...entries[0], before: { quantityInBaseUnits: 1, valueInCentimes: 200 },
    after: { quantityInBaseUnits: 4, valueInCentimes: 100 }, valueDeltaInCentimes: -100,
  }), null);
  assert.equal(normalizeStoredStockValuationEntry({
    ...entries[1], before: { quantityInBaseUnits: 3, valueInCentimes: 50 },
    after: { quantityInBaseUnits: 1, valueInCentimes: 60 }, valueDeltaInCentimes: 10,
  }), null);
  assert.equal(normalizeStoredStockValuationEntry(null), null);
});

test('reconciles unordered physical movements and ledger entries against the final record', () => {
  const history = createValuationHistory();
  const movements = [...history.movements].reverse();
  const entries = [...history.entries].reverse();
  const report = reconcileStockValuation({ ...history, movements, entries });

  assert.equal(report.complete, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.physicalQuantityInBaseUnits, 2);
  assert.equal(report.valueInCentimes, 67);
  assert.equal(report.averageUnitCostInCentimes, 33.5);
  assert.equal(entries[0].revision, 3);
});

test('reconciles explicitly initialized empty stock without inferring a missing record', () => {
  const productId = new ObjectId();
  const baseUnit = 'PIECE';
  const input = { productId, baseUnit, movements: [], entries: [] };

  assert.equal(reconcileStockValuation({ ...input, valuation: createStockValuationRecord({ productId, baseUnit }) }).complete, true);
  assert.deepEqual(issueCodes(reconcileStockValuation(input)), ['MISSING_VALUATION']);
});

test('unknown or invalid records suppress the displayed average', () => {
  const history = createValuationHistory();
  const unknown = { ...history.valuation, status: 'UNVALUED', valueInCentimes: null };
  const report = reconcileStockValuation({ ...history, valuation: unknown });

  assert.equal(report.complete, false);
  assert.equal(report.valueInCentimes, null);
  assert.equal(report.averageUnitCostInCentimes, null);
  assert.ok(issueCodes(report).includes('UNKNOWN_COST'));
  assert.ok(issueCodes(reconcileStockValuation({ ...history, valuation: { ...history.valuation, version: 2 } })).includes('INVALID_VALUATION'));
});

test('detects missing, duplicated and broken physical sources', () => {
  const history = createValuationHistory();
  const withoutSource = reconcileStockValuation({ ...history, movements: history.movements.slice(0, 2) });
  const withoutCost = reconcileStockValuation({ ...history, entries: history.entries.slice(0, 2) });
  const duplicate = reconcileStockValuation({ ...history, entries: [...history.entries, history.entries[2]] });
  const broken = reconcileStockValuation({ ...history, movements: history.movements.map((movement, index) => index === 2 ? { ...movement, sourceTourReservationId: new ObjectId() } : movement) });

  assert.ok(issueCodes(withoutSource).includes('MISSING_PHYSICAL_SOURCE'));
  assert.ok(issueCodes(withoutCost).includes('UNVALUED_PHYSICAL_MOVEMENT'));
  assert.ok(issueCodes(duplicate).includes('DUPLICATE_VALUED_MOVEMENT'));
  assert.ok(issueCodes(duplicate).includes('LEDGER_REVISION_GAP_OR_DUPLICATE'));
  assert.ok(issueCodes(broken).includes('PHYSICAL_SOURCE_MISMATCH'));
  assert.ok([withoutSource, withoutCost, duplicate, broken].every((report) => !report.complete));
});

test('detects ledger revision gaps, broken continuity and stale final pointers', () => {
  const history = createValuationHistory();
  const revisionGap = reconcileStockValuation({ ...history, entries: history.entries.map((entry, index) => index === 1 ? { ...entry, revision: 4 } : entry) });
  const continuity = reconcileStockValuation({ ...history, entries: history.entries.map((entry, index) => index === 1 ? {
    ...entry, before: { quantityInBaseUnits: 4, valueInCentimes: 100 },
    after: { quantityInBaseUnits: 2, valueInCentimes: 33 },
  } : entry) });
  const stale = reconcileStockValuation({ ...history, valuation: { ...history.valuation, revision: 2, lastLedgerEntryId: history.entries[1]._id, valueInCentimes: 68 } });

  assert.ok(issueCodes(revisionGap).includes('LEDGER_REVISION_GAP_OR_DUPLICATE'));
  assert.ok(issueCodes(continuity).includes('LEDGER_BALANCE_DISCONTINUITY'));
  for (const code of ['VALUATION_REVISION_MISMATCH', 'VALUATION_LAST_ENTRY_MISMATCH', 'VALUATION_LEDGER_BALANCE_MISMATCH']) {
    assert.ok(issueCodes(stale).includes(code));
  }
});

test('detects mismatched physical quantity, units and product identities', () => {
  const history = createValuationHistory();
  const wrongQuantity = reconcileStockValuation({ ...history, valuation: { ...history.valuation, quantityInBaseUnits: 3 } });
  const wrongUnit = reconcileStockValuation({ ...history, movements: history.movements.map((movement) => ({ ...movement, baseUnit: 'BOITE' })) });
  const wrongProduct = reconcileStockValuation({ ...history, valuation: { ...history.valuation, productId: new ObjectId() } });

  assert.ok(issueCodes(wrongQuantity).includes('PHYSICAL_QUANTITY_MISMATCH'));
  assert.ok(issueCodes(wrongUnit).includes('INVALID_PHYSICAL_MOVEMENT'));
  assert.equal(wrongUnit.physicalQuantityInBaseUnits, null);
  assert.ok(issueCodes(wrongProduct).includes('VALUATION_PRODUCT_OR_UNIT_MISMATCH'));
});

test('rejects a balanced return ledger that does not restore the original assigned cost', () => {
  const history = createValuationHistory();
  const alteredReturn = { ...history.entries[2], valueDeltaInCentimes: 35, after: { quantityInBaseUnits: 2, valueInCentimes: 68 } };
  const report = reconcileStockValuation({
    ...history, entries: [...history.entries.slice(0, 2), alteredReturn],
    valuation: { ...history.valuation, valueInCentimes: 68 },
  });

  assert.equal(report.complete, false);
  assert.deepEqual(issueCodes(report), ['ORIGINAL_RETURN_COST_MISMATCH']);
});

test('rejects returns linked to missing loadings or quantities exceeding their original loading', () => {
  const history = createValuationHistory();
  const missing = reconcileStockValuation({ ...history, entries: history.entries.slice(2) });
  const excessiveMovement = { ...history.movements[2], quantityDeltaInBaseUnits: 3 };
  const excessiveEntry = createStockValuationEntry({
    movement: excessiveMovement, before: history.entries[2].before,
    after: { quantityInBaseUnits: 4, valueInCentimes: 100 }, revision: 3,
  });
  const excessive = reconcileStockValuation({
    ...history, movements: [...history.movements.slice(0, 2), excessiveMovement],
    entries: [...history.entries.slice(0, 2), excessiveEntry],
  });
  const mismatched = reconcileStockValuation({
    ...history, entries: history.entries.map((entry, index) => index === 2 ? { ...entry, sourceTourId: new ObjectId() } : entry),
  });

  assert.ok(issueCodes(missing).includes('MISSING_OR_MISMATCHED_RETURN_LOADING'));
  assert.ok(issueCodes(excessive).includes('RETURN_EXCEEDS_LOADED_QUANTITY'));
  assert.ok(issueCodes(mismatched).includes('MISSING_OR_MISMATCHED_RETURN_LOADING'));
});

test('detects duplicate return sources and a return ordered before its loading', () => {
  const history = createValuationHistory();
  const movement = { ...history.movements[2], _id: new ObjectId() };
  const entry = createStockValuationEntry({
    movement, before: history.entries[2].after,
    after: { quantityInBaseUnits: 3, valueInCentimes: 101 }, revision: 4,
  });
  const duplicate = reconcileStockValuation({ ...history, movements: [...history.movements, movement], entries: [...history.entries, entry] });
  const outOfOrder = reconcileStockValuation({ ...history, entries: history.entries.map((original, index) => index === 2 ? { ...original, revision: 1 } : original) });

  assert.ok(issueCodes(duplicate).includes('DUPLICATE_TOUR_RETURN_SOURCE'));
  assert.ok(issueCodes(outOfOrder).includes('RETURN_PRECEDES_LOADING'));
});

test('detects malformed arrays, entries, movements and physical quantity limits', () => {
  const history = createValuationHistory();
  assert.throws(() => reconcileStockValuation({ ...history, entries: null }), TypeError);
  assert.throws(() => reconcileStockValuation({ ...history, productId: 'bad' }), RangeError);
  const invalidEntries = reconcileStockValuation({ ...history, entries: [null, ...history.entries] });
  const invalidMovements = reconcileStockValuation({ ...history, movements: [null, ...history.movements] });
  const duplicatedMovement = reconcileStockValuation({ ...history, movements: [...history.movements, history.movements[0]] });
  const overflow = reconcileStockValuation({ ...history, movements: history.movements.map((movement, index) => ({ ...movement, quantityDeltaInBaseUnits: index === 1 ? -1 : Number.MAX_SAFE_INTEGER })) });
  const negative = reconcileStockValuation({ ...history, movements: [history.movements[1]] });

  assert.ok(issueCodes(invalidEntries).includes('INVALID_LEDGER_ENTRY'));
  assert.ok(issueCodes(invalidMovements).includes('INVALID_PHYSICAL_MOVEMENT'));
  assert.ok(issueCodes(duplicatedMovement).includes('DUPLICATE_PHYSICAL_MOVEMENT'));
  assert.ok(issueCodes(overflow).includes('PHYSICAL_QUANTITY_OUT_OF_RANGE'));
  assert.equal(overflow.physicalQuantityInBaseUnits, null);
  assert.ok(issueCodes(negative).includes('PHYSICAL_QUANTITY_OUT_OF_RANGE'));
});
