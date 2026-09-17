import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatQuantityInDisplayUnit,
  getDisplayUnitLabel,
  getDisplayUnitSalePrice,
  getProductDisplayUnit,
  getQuantityInDisplayUnit,
} from '../lib/product-display-unit.js';

const packagings = [
  { id: 'pack', label: 'Pack de 12', quantity: 12, usage: 'SALE', salePrice: { amountInCentimes: 110000 } },
  { id: 'carton', label: 'Carton', quantity: 24, usage: 'BOTH' },
  { id: 'palette', label: 'Palette', quantity: 240, usage: 'RECEPTION', salePrice: { amountInCentimes: 2000000 } },
];
const pack = { id: 'pack', label: 'Pack de 12', quantity: 12 };
const nbsp = (text) => text.replace(/\s/gu, ' ');

test('retient le conditionnement de vente par défaut ou l’unité de base', () => {
  assert.deepEqual(getProductDisplayUnit({ defaultSaleUnit: 'pack', packagings }), pack);
  assert.equal(getProductDisplayUnit({ defaultSaleUnit: null, packagings }), null);
  assert.equal(getProductDisplayUnit({ defaultSaleUnit: 'palette', packagings }), null);
  assert.equal(getProductDisplayUnit({ defaultSaleUnit: 'inconnu', packagings }), null);
  assert.equal(getProductDisplayUnit({ defaultSaleUnit: 'pack' }), null);
  assert.equal(getProductDisplayUnit(), null);
});

test('convertit une quantité en conditionnements complets plus le reste en unités', () => {
  const options = { baseUnitLabel: 'Bouteille', displayUnit: pack };
  assert.equal(formatQuantityInDisplayUnit(240, options), '20 packs de 12');
  assert.equal(formatQuantityInDisplayUnit(243, options), '20 packs de 12 + 3 bouteilles');
  assert.equal(formatQuantityInDisplayUnit(13, options), '1 pack de 12 + 1 bouteille');
  assert.equal(formatQuantityInDisplayUnit(5, options), '5 bouteilles');
  assert.equal(formatQuantityInDisplayUnit(0, options), '0 pack de 12');
  assert.equal(formatQuantityInDisplayUnit(-27, options), '−2 packs de 12 − 3 bouteilles');
  assert.equal(nbsp(formatQuantityInDisplayUnit(14400, options)), '1 200 packs de 12');
  assert.deepEqual(getQuantityInDisplayUnit(243, options), {
    negative: false,
    parts: [{ count: 20, label: 'packs de 12' }, { count: 3, label: 'bouteilles' }],
  });
});

test('reste en unités de base sans conditionnement par défaut', () => {
  const options = { baseUnitLabel: 'Bouteille', displayUnit: null };
  assert.equal(formatQuantityInDisplayUnit(240, options), '240 bouteilles');
  assert.equal(formatQuantityInDisplayUnit(1, options), '1 bouteille');
  assert.equal(formatQuantityInDisplayUnit(-4, options), '−4 bouteilles');
  assert.equal(formatQuantityInDisplayUnit(2, { baseUnitLabel: 'Plateau', displayUnit: null }), '2 plateaux');
  assert.equal(formatQuantityInDisplayUnit(3, { baseUnitLabel: 'Boîte', displayUnit: { id: 'lot', label: 'Lot', quantity: 1 } }), '3 lots');
});

test('retourne le prix du conditionnement par défaut ou le prix unitaire', () => {
  const salePrice = { amountInCentimes: 9500 };
  assert.equal(getDisplayUnitSalePrice({ displayUnit: pack, packagings, salePrice }), 110000);
  assert.equal(getDisplayUnitSalePrice({ displayUnit: null, packagings, salePrice }), 9500);
  assert.equal(getDisplayUnitSalePrice({ displayUnit: { id: 'carton', label: 'Carton', quantity: 24 }, packagings, salePrice }), null);
  assert.equal(getDisplayUnitSalePrice({ displayUnit: null, packagings, salePrice: null }), null);
  assert.equal(getDisplayUnitLabel({ baseUnitLabel: 'Bouteille', displayUnit: pack }), 'pack de 12');
  assert.equal(getDisplayUnitLabel({ baseUnitLabel: 'Bouteille', displayUnit: null }), 'bouteille');
});
