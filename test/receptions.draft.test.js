import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeReceptionDraft, validateReceptionDocument } from '../lib/reception-draft.js';
import { createEmptyReceptionLine } from '../lib/receptions.js';

const products = [
  { id: 'water', baseUnit: 'BOUTEILLE', packagings: [{ id: 'pack', quantity: 6, usage: 'BOTH' }] },
  { id: 'tea', baseUnit: 'SACHET', packagings: [] },
];
const line = (id, productId, quantity, amount) => ({ ...createEmptyReceptionLine(id), productId, directQuantity: quantity, amount });

test('le récapitulatif distingue absence, zéro explicite et unités différentes', () => {
  assert.deepEqual(summarizeReceptionDraft([], products), { amountInCentimes: null, complete: false, quantities: [] });
  assert.deepEqual(summarizeReceptionDraft([
    line('1', 'water', '10', '0'),
    line('2', 'tea', '20', '12,50'),
    { ...line('3', 'water', '', '0.50'), quantityMode: 'PACKAGING', packagingId: 'pack', packagingCount: '2' },
  ], products), {
    amountInCentimes: 1300, complete: true,
    quantities: [{ unit: 'BOUTEILLE', quantity: 22 }, { unit: 'SACHET', quantity: 20 }],
  });
  assert.equal(summarizeReceptionDraft([line('1', 'water', '1', '0')], products).amountInCentimes, 0);
  assert.equal(summarizeReceptionDraft([line('1', 'water', '1', '')], products).amountInCentimes, null);
});

test('les agrégats hors limites ou un produit absent ne deviennent pas un total complet', () => {
  const maximum = String(Number.MAX_SAFE_INTEGER);
  const quantities = summarizeReceptionDraft([line('1', 'water', maximum, '0'), line('2', 'water', '1', '0')], products);
  assert.equal(quantities.complete, false);
  assert.equal(quantities.quantities[0].quantity, null);
  const amounts = summarizeReceptionDraft([line('1', 'water', '1', '90071992547409.91'), line('2', 'water', '1', '0.01')], products);
  assert.equal(amounts.amountInCentimes, null);
  assert.equal(amounts.complete, false);
  assert.equal(summarizeReceptionDraft([line('1', 'missing', '1', '0')], products).complete, false);
});

test('la validation locale exige un fournisseur actif, une date réelle et une référence', () => {
  const suppliers = [{ id: 'active', active: true }, { id: 'inactive', active: false }];
  assert.deepEqual(validateReceptionDocument({ supplierId: 'active', receptionDate: '2024-02-29', supplierReference: 'BL-1' }, suppliers), {});
  const errors = validateReceptionDocument({ supplierId: 'inactive', receptionDate: '2026-02-29', supplierReference: '  ' }, suppliers);
  assert.deepEqual(Object.keys(errors), ['supplierId', 'receptionDate', 'supplierReference']);
  assert.ok(validateReceptionDocument({ supplierId: 'active', receptionDate: '', supplierReference: 'x'.repeat(101) }, suppliers).supplierReference);
});
