import assert from 'node:assert/strict';
import test from 'node:test';

import { getSalePackagings, isPackagingEnabledForSale } from '../lib/product-packaging.js';

test('offre pour la vente seulement les usages explicites vente et mixtes', () => {
  const packagings = ['SALE', 'BOTH', 'RECEPTION', undefined, null, '', 'ALL']
    .map((usage, index) => ({ id: String(index), usage, quantity: 6 }));
  assert.deepEqual(getSalePackagings(packagings), packagings.slice(0, 2));
  for (const packaging of packagings) {
    assert.equal(isPackagingEnabledForSale(packaging), ['SALE', 'BOTH'].includes(packaging.usage));
  }
  assert.deepEqual(getSalePackagings(undefined), []);
  assert.deepEqual(getSalePackagings([]), []);
  assert.equal(isPackagingEnabledForSale(null), false);
});
