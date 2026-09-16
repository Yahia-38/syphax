import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocateStockValueInCentimes,
  calculateLoadedStockCostSplit,
  calculateStockLoading,
  calculateStockReceipt,
  calculateStockReturn,
  getStockAverageUnitCostInCentimes,
  validateStockValuationBalance,
} from '../lib/stock-valuation-calculations.js';

const balance = (quantityInBaseUnits, valueInCentimes) => ({ quantityInBaseUnits, valueInCentimes });
const load = (currentBalance, quantities) => calculateStockLoading({
  balance: currentBalance,
  lines: quantities.map((quantityInBaseUnits, index) => ({ id: `line-${index}`, quantityInBaseUnits })),
});

test('weights reception costs by quantities remaining after previous loadings', () => {
  const first = calculateStockReceipt({ balance: balance(0, 0), quantityInBaseUnits: 100, amountInCentimes: 500_000 });
  const second = calculateStockReceipt({ balance: first.after, quantityInBaseUnits: 100, amountInCentimes: 600_000 });
  const loading = load(second.after, [40]);
  const third = calculateStockReceipt({ balance: loading.after, quantityInBaseUnits: 40, amountInCentimes: 280_000 });

  assert.deepEqual(second.after, balance(200, 1_100_000));
  assert.equal(getStockAverageUnitCostInCentimes(second.after), 5_500);
  assert.equal(loading.loadedValueInCentimes, 220_000);
  assert.deepEqual(third.after, balance(200, 1_160_000));
  assert.equal(getStockAverageUnitCostInCentimes(third.after), 5_800);

  const unequal = calculateStockReceipt({ balance: balance(2, 100), quantityInBaseUnits: 8, amountInCentimes: 800 });
  assert.equal(getStockAverageUnitCostInCentimes(unequal.after), 90);
});

test('returns original assigned value after the warehouse purchase cost changes', () => {
  const returned = calculateStockReturn({
    balance: balance(200, 1_160_000),
    loadedQuantityInBaseUnits: 40,
    loadedValueInCentimes: 220_000,
    returnedQuantityInBaseUnits: 10,
  });

  assert.deepEqual(returned.after, balance(210, 1_215_000));
  assert.equal(returned.returnedValueInCentimes, 55_000);
  assert.equal(returned.costOfGoodsSoldInCentimes, 165_000);
  assert.equal(returned.soldQuantityInBaseUnits, 30);
});

test('rounds half up and empties all remaining value on a full loading', () => {
  assert.equal(allocateStockValueInCentimes({ valueInCentimes: 1, quantityInBaseUnits: 2, allocatedQuantityInBaseUnits: 1 }), 1);
  assert.equal(allocateStockValueInCentimes({ valueInCentimes: 1, quantityInBaseUnits: 3, allocatedQuantityInBaseUnits: 1 }), 0);

  const partial = load(balance(3, 100), [1]);
  const final = load(partial.after, [2]);

  assert.equal(partial.loadedValueInCentimes, 33);
  assert.equal(final.loadedValueInCentimes, 67);
  assert.deepEqual(final.after, balance(0, 0));
  assert.equal(getStockAverageUnitCostInCentimes(final.after), null);
});

test('allocates combined withdrawal before distributing deterministic cumulative line shares', () => {
  const result = load(balance(5, 3), [1, 1, 1]);

  assert.equal(result.loadedValueInCentimes, 2);
  assert.deepEqual(result.lines.map((line) => line.loadedValueInCentimes), [1, 0, 1]);
  assert.deepEqual(result.after, balance(2, 1));
  assert.deepEqual(load(balance(5, 3), [1, 1, 1]), result);
});

test('splits all-sold, all-returned and fractional line values without losing centimes', () => {
  const line = { loadedQuantityInBaseUnits: 3, loadedValueInCentimes: 100 };
  const partial = calculateLoadedStockCostSplit({ ...line, returnedQuantityInBaseUnits: 1 });
  const allSold = calculateLoadedStockCostSplit({ ...line, returnedQuantityInBaseUnits: 0 });
  const allReturned = calculateStockReturn({ balance: balance(0, 0), ...line, returnedQuantityInBaseUnits: 3 });

  assert.equal(partial.returnedValueInCentimes, 33);
  assert.equal(partial.costOfGoodsSoldInCentimes, 67);
  assert.equal(allSold.costOfGoodsSoldInCentimes, 100);
  assert.equal(allSold.returnedValueInCentimes, 0);
  assert.equal(allReturned.costOfGoodsSoldInCentimes, 0);
  assert.deepEqual(allReturned.after, balance(3, 100));
});

test('accepts explicit zero costs and zero returns, while never treating unknown costs as zero', () => {
  const receipt = calculateStockReceipt({ balance: balance(0, 0), quantityInBaseUnits: 10, amountInCentimes: 0 });
  const loading = load(receipt.after, [5]);
  const returned = calculateStockReturn({
    balance: loading.after,
    loadedQuantityInBaseUnits: 5,
    loadedValueInCentimes: 0,
    returnedQuantityInBaseUnits: 0,
  });

  assert.equal(getStockAverageUnitCostInCentimes(receipt.after), 0);
  assert.deepEqual(returned.after, loading.after);

  for (const unknown of [null, undefined, Number.NaN, '', '0']) {
    assert.throws(() => calculateStockReceipt({ balance: balance(0, 0), quantityInBaseUnits: 1, amountInCentimes: unknown }), RangeError);
    assert.throws(() => load(balance(1, unknown), [1]), RangeError);
  }
});

test('uses exact products at the maximum safe integer limit', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const halfQuantity = 4_503_599_627_370_495;
  const allocation = allocateStockValueInCentimes({
    valueInCentimes: maximum,
    quantityInBaseUnits: maximum,
    allocatedQuantityInBaseUnits: halfQuantity,
  });
  const result = load(balance(maximum, maximum), [halfQuantity, maximum - halfQuantity]);

  assert.equal(allocation, halfQuantity);
  assert.equal(result.lines[0].loadedValueInCentimes, halfQuantity);
  assert.equal(result.lines[1].loadedValueInCentimes, maximum - halfQuantity);
  assert.deepEqual(result.after, balance(0, 0));
});

test('rejects additions and loading sums outside the safe integer range', () => {
  const maximum = Number.MAX_SAFE_INTEGER;

  assert.throws(() => calculateStockReceipt({ balance: balance(maximum, 0), quantityInBaseUnits: 1, amountInCentimes: 0 }), RangeError);
  assert.throws(() => calculateStockReceipt({ balance: balance(1, maximum), quantityInBaseUnits: 1, amountInCentimes: 1 }), RangeError);
  assert.throws(() => load(balance(maximum, 0), [maximum, 1]), RangeError);
  assert.throws(() => calculateStockReturn({
    balance: balance(maximum, maximum),
    loadedQuantityInBaseUnits: 1,
    loadedValueInCentimes: 1,
    returnedQuantityInBaseUnits: 1,
  }), RangeError);
  assert.throws(() => calculateStockReturn({
    balance: balance(1, maximum),
    loadedQuantityInBaseUnits: 1,
    loadedValueInCentimes: 1,
    returnedQuantityInBaseUnits: 1,
  }), RangeError);
});

test('rejects invalid balances, quantities and over-allocation', () => {
  for (const invalid of [balance(0, 1), balance(-1, 0), balance(1, -1), balance(1.5, 1), balance(1, 0.5)]) {
    assert.throws(() => validateStockValuationBalance(invalid), RangeError);
  }

  for (const quantity of [-1, 0, 1.5, null, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateStockReceipt({ balance: balance(1, 0), quantityInBaseUnits: quantity, amountInCentimes: 0 }), RangeError);
    assert.throws(() => load(balance(2, 0), [quantity]), RangeError);
  }

  assert.throws(() => load(balance(1, 1), [2]), RangeError);
  assert.throws(() => load(balance(0, 0), [1]), RangeError);
  assert.throws(() => calculateLoadedStockCostSplit({ loadedQuantityInBaseUnits: 1, loadedValueInCentimes: 1, returnedQuantityInBaseUnits: 2 }), RangeError);
  assert.throws(() => calculateLoadedStockCostSplit({ loadedQuantityInBaseUnits: 1, loadedValueInCentimes: 1, returnedQuantityInBaseUnits: -1 }), RangeError);
});

test('rejects missing or duplicate loading identities and does not mutate callers', () => {
  for (const lines of [[], null, [{ quantityInBaseUnits: 1 }], [{ id: ' ', quantityInBaseUnits: 1 }], [{ id: 'same', quantityInBaseUnits: 1 }, { id: 'same', quantityInBaseUnits: 1 }]]) {
    assert.throws(() => calculateStockLoading({ balance: balance(2, 2), lines }), RangeError);
  }

  const original = Object.freeze(balance(3, 100));
  const lines = Object.freeze([Object.freeze({ id: 'one', quantityInBaseUnits: 1 })]);
  calculateStockLoading({ balance: original, lines });
  assert.deepEqual(original, balance(3, 100));
  assert.deepEqual(lines, [{ id: 'one', quantityInBaseUnits: 1 }]);
});

test('conserves warehouse and tour values across many small rounded allocations', () => {
  for (let quantity = 1; quantity <= 20; quantity += 1) {
    for (let value = 0; value <= 30; value += 1) {
      for (let loadedQuantity = 1; loadedQuantity <= quantity; loadedQuantity += 1) {
        const result = load(balance(quantity, value), Array.from({ length: loadedQuantity }, () => 1));
        const lineValue = result.lines.reduce((sum, line) => sum + line.loadedValueInCentimes, 0);

        assert.equal(lineValue, result.loadedValueInCentimes);
        assert.equal(result.after.valueInCentimes + lineValue, value);
        assert.ok(result.lines.every((line) => line.loadedValueInCentimes >= 0));

        for (let returnedQuantity = 0; returnedQuantity <= loadedQuantity; returnedQuantity += 1) {
          const split = calculateLoadedStockCostSplit({
            loadedQuantityInBaseUnits: loadedQuantity,
            loadedValueInCentimes: lineValue,
            returnedQuantityInBaseUnits: returnedQuantity,
          });
          assert.equal(split.returnedValueInCentimes + split.costOfGoodsSoldInCentimes, lineValue);
        }
      }
    }
  }
});
