import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCountingPurchaseCosts, normalizeLoadingPurchaseCost, readRecordedCountingPurchaseCosts } from '../lib/tour-counting-purchase-costs.js';
import { STOCK_VALUATION_METHOD, STOCK_VALUATION_VERSION } from '../lib/stock-valuation-calculations.js';

const line = (valueInCentimes = 100, quantityInBaseUnits = 3) => ({
  id: 'line', baseUnit: 'PIECE', quantityInBaseUnits,
  purchaseCostAtLoading: {
    method: STOCK_VALUATION_METHOD, version: STOCK_VALUATION_VERSION,
    baseUnit: 'PIECE', quantityInBaseUnits, valueInCentimes, currency: 'DZD', taxIncluded: true,
  },
});

test('original cost splits conserve centimes with half-up rounding and zero/full returns', () => {
  for (const [quantity, returnedValue, soldCost] of [[0, 0, 100], [1, 33, 67], [2, 67, 33], [3, 100, 0]]) {
    const result = calculateCountingPurchaseCosts([line()], [{ id: 'line', returnedQuantityInBaseUnits: quantity }]);
    assert.equal(result.complete, true);
    assert.equal(result.totalPurchaseCostInCentimes, 100);
    assert.equal(result.totalReturnedValueInCentimes, returnedValue);
    assert.equal(result.totalCostOfGoodsSoldInCentimes, soldCost);
  }
  assert.equal(calculateCountingPurchaseCosts([line(1, 2)], [{ id: 'line', returnedQuantityInBaseUnits: 1 }]).totalReturnedValueInCentimes, 1);
  assert.equal(calculateCountingPurchaseCosts([line(0)], [{ id: 'line', returnedQuantityInBaseUnits: 2 }]).complete, true);
});

test('unknown, incompatible and unsafe historical costs never become zero', () => {
  for (const change of [
    { valueInCentimes: null }, { valueInCentimes: -1 }, { valueInCentimes: Number.MAX_SAFE_INTEGER + 1 },
    { version: 2 }, { method: 'LATEST_PRICE' }, { baseUnit: 'BOITE' }, { quantityInBaseUnits: 2 },
    { currency: 'EUR' }, { taxIncluded: false },
  ]) {
    const invalid = line();
    Object.assign(invalid.purchaseCostAtLoading, change);
    assert.equal(normalizeLoadingPurchaseCost(invalid), null);
    assert.equal(calculateCountingPurchaseCosts([invalid], [{ id: 'line', returnedQuantityInBaseUnits: 1 }]).complete, false);
  }
  const source = line();
  source.purchaseCostAtLoading.internal = 'hidden';
  assert.equal('internal' in normalizeLoadingPurchaseCost(source), false);
});

test('partial or invalid input does not produce a complete cost total', () => {
  for (const calculation of [{ id: 'line' }, { id: 'line', returnedQuantityInBaseUnits: 4 }, { id: 'line', returnedQuantityInBaseUnits: 1, error: 'invalid' }]) {
    const result = calculateCountingPurchaseCosts([line()], [calculation]);
    assert.equal(result.complete, false);
    assert.equal(result.totalCostOfGoodsSoldInCentimes, undefined);
  }
});

test('safe integer allocations use exact products and combined costs reject overflow', () => {
  const source = line(Number.MAX_SAFE_INTEGER, 100);
  const result = calculateCountingPurchaseCosts([source], [{ id: 'line', returnedQuantityInBaseUnits: 1 }]);
  assert.equal(result.totalReturnedValueInCentimes, 90_071_992_547_410);
  assert.equal(result.totalReturnedValueInCentimes + result.totalCostOfGoodsSoldInCentimes, Number.MAX_SAFE_INTEGER);
  const second = { ...source, id: 'second' };
  const overflow = calculateCountingPurchaseCosts([source, second], [
    { id: 'line', returnedQuantityInBaseUnits: 0 }, { id: 'second', returnedQuantityInBaseUnits: 0 },
  ]);
  assert.equal(overflow.complete, false);
  assert.match(overflow.error, /limite/u);
});

test('partially migrated or inconsistent recorded costs remain explicitly incomplete', () => {
  const counting = {
    lines: [{ ...line(), returnedQuantityInBaseUnits: 1, soldQuantityInBaseUnits: 2, returnedValueInCentimes: 33, costOfGoodsSoldInCentimes: 67 }],
    totalPurchaseCostInCentimes: 100, totalReturnedValueInCentimes: 33, totalCostOfGoodsSoldInCentimes: 67,
  };
  assert.equal(readRecordedCountingPurchaseCosts(counting).totalCostOfGoodsSoldInCentimes, 67);
  counting.lines[0].returnedValueInCentimes = null;
  const partial = readRecordedCountingPurchaseCosts(counting);
  assert.equal(partial.lines[0].purchaseCostAtLoading.valueInCentimes, 100);
  assert.equal(partial.lines[0].returnedValueInCentimes, null);
  assert.equal(partial.totalCostOfGoodsSoldInCentimes, null);
  counting.lines[0].returnedValueInCentimes = 34;
  assert.equal(readRecordedCountingPurchaseCosts(counting).totalReturnedValueInCentimes, null);
  counting.lines[0].returnedValueInCentimes = 33;
  counting.totalReturnedValueInCentimes = 34;
  assert.equal(readRecordedCountingPurchaseCosts(counting).totalReturnedValueInCentimes, null);
});
