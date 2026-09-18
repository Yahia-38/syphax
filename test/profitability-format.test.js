import assert from 'node:assert/strict';
import test from 'node:test';

import { formatProfitabilityAmount, formatProfitabilityExactAmount } from '../lib/profitability-format.js';

// Intl separates thousands with a narrow no-break space.
const plain = (value) => value?.replace(/[  ]/gu, ' ');

test('sous 10 000 DA, le montant reste en dinars', () => {
  assert.equal(plain(formatProfitabilityAmount(0)), '0 DA');
  assert.equal(plain(formatProfitabilityAmount(250_050)), '2 500,5 DA');
  assert.equal(plain(formatProfitabilityAmount(999_999)), '9 999,99 DA');
  assert.equal(plain(formatProfitabilityAmount(-450_000)), '−4 500 DA');
});

test('à partir de 10 000 DA, le montant est en millions : 1 million = 10 000 DA', () => {
  assert.equal(formatProfitabilityAmount(1_000_000), '1 million');
  assert.equal(formatProfitabilityAmount(1_500_000), '1,5 million');
  assert.equal(formatProfitabilityAmount(1_999_999), '2 millions');
  assert.equal(formatProfitabilityAmount(12_345_678), '12,35 millions');
  assert.equal(plain(formatProfitabilityAmount(2_500_000_000)), '2 500 millions');
  assert.equal(formatProfitabilityAmount(-3_000_000), '−3 millions');
});

test('un montant inconnu n’est pas mis en forme, et le montant exact reste en dinars', () => {
  assert.equal(formatProfitabilityAmount(null), null);
  assert.equal(formatProfitabilityAmount(1.5), null);
  assert.equal(plain(formatProfitabilityExactAmount(12_345_678)), '123 456,78 DA');
  assert.equal(plain(formatProfitabilityExactAmount(-3_000_000)), '−30 000 DA');
});
