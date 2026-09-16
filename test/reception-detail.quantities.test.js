import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatReceptionQuantity,
  getReceptionEntryDetail,
  getReceptionUnitLabel,
  hasReceptionQuantityMismatch,
  isKnownReceptionAmount,
  summarizeReceptionQuantities,
} from '../lib/reception-detail.js';

const units = new Map([['BOUTEILLE', 'Bouteille'], ['SACHET', 'Sachet']]);

test('les sous-totaux historiques séparent les unités et conservent zéro', () => {
  assert.deepEqual(summarizeReceptionQuantities([
    { quantityInBaseUnits: 12, baseUnit: 'BOUTEILLE' },
    { quantityInBaseUnits: 6, baseUnit: 'BOUTEILLE' },
    { quantityInBaseUnits: 2, baseUnit: 'SACHET' },
    { quantityInBaseUnits: 0, baseUnit: 'INCONNUE' },
    { quantityInBaseUnits: null, baseUnit: 'BOUTEILLE' },
    { quantityInBaseUnits: 4, baseUnit: null },
    { quantityInBaseUnits: -1, baseUnit: 'SACHET' },
  ]), { totals: [
    { baseUnit: 'BOUTEILLE', quantity: 18 },
    { baseUnit: 'SACHET', quantity: 2 },
    { baseUnit: 'INCONNUE', quantity: 0 },
  ], incompleteLineCount: 3 });
  assert.deepEqual(summarizeReceptionQuantities([]), { totals: [], incompleteLineCount: 0 });
});

test('une somme non sûre reste non calculable pour son unité', () => {
  assert.deepEqual(summarizeReceptionQuantities([
    { quantityInBaseUnits: Number.MAX_SAFE_INTEGER, baseUnit: 'SACHET' },
    { quantityInBaseUnits: 1, baseUnit: 'SACHET' },
    { quantityInBaseUnits: 0, baseUnit: 'SACHET' },
    { quantityInBaseUnits: 2, baseUnit: 'BOUTEILLE' },
  ]).totals, [{ baseUnit: 'SACHET', quantity: null }, { baseUnit: 'BOUTEILLE', quantity: 2 }]);
});

test('quantités et unités manquantes restent explicites', () => {
  assert.equal(formatReceptionQuantity(0, 'BOUTEILLE', units), '0 bouteille');
  assert.equal(formatReceptionQuantity(null, 'BOUTEILLE', units), 'Quantité non renseignée');
  assert.equal(formatReceptionQuantity(2, null, units), '2 unité non renseignée');
  assert.equal(getReceptionUnitLabel('LITRE', units), 'unité inconnue (LITRE)');
});

test('affiche la conversion historique et signale les différences sans modifier les faits', () => {
  const line = { quantityMode: 'PACKAGING', baseUnit: 'BOUTEILLE', quantityInBaseUnits: 119, packaging: { count: 20, quantity: 6, label: 'Ancien pack' } };
  assert.equal(getReceptionEntryDetail(line, units), '20 × Ancien pack (6 bouteilles) = 120 bouteilles.');
  assert.equal(hasReceptionQuantityMismatch(line), true);
  assert.equal(line.quantityInBaseUnits, 119);
  assert.equal(hasReceptionQuantityMismatch({ ...line, quantityInBaseUnits: 120 }), false);
  assert.equal(getReceptionEntryDetail({ ...line, packaging: null }, units), 'Détail du conditionnement non renseigné');
  assert.equal(getReceptionEntryDetail({}, units), 'Mode de saisie non renseigné');
  assert.equal(getReceptionEntryDetail({ quantityMode: 'DIRECT', directQuantity: null }, units), 'Quantité non renseignée');
  assert.equal(hasReceptionQuantityMismatch({ quantityMode: 'DIRECT', directQuantity: 2, quantityInBaseUnits: 3 }), true);
  assert.match(getReceptionEntryDetail({ ...line, packaging: { count: Number.MAX_SAFE_INTEGER, quantity: 2, label: 'Pack' } }, units), /Conversion non calculable/u);
});

test('le filtre de montant considère zéro renseigné et les valeurs invalides absentes', () => {
  assert.equal(isKnownReceptionAmount(0), true);
  for (const value of [null, undefined, -1, 1.5, '0', Number.MAX_SAFE_INTEGER + 1]) assert.equal(isKnownReceptionAmount(value), false);
});
