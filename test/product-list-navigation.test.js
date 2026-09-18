import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNewProductHref,
  buildProductDeletionHref,
  buildProductHref,
  buildProductListHref,
  readProductListState,
  validateProductListHref,
} from '../lib/product-list-navigation.js';

const productId = '6aa87bf1a6c1118e767192f0';

test('la liste ne s’adresse que par ses critères connus', () => {
  const state = readProductListState({
    page: '3',
    q: '  lait  ',
    sansPrix: '1',
    sens: 'desc',
    stock: 'NEGATIVE',
    tri: 'availableQuantityInBaseUnits',
    unite: 'BOUTEILLE',
  });
  assert.deepEqual(state, {
    missingPrice: true,
    page: 3,
    query: 'lait',
    sortDir: 'desc',
    sortKey: 'availableQuantityInBaseUnits',
    stock: 'NEGATIVE',
    unit: 'BOUTEILLE',
  });
  assert.deepEqual(readProductListState({ page: '-2', sens: 'haut', stock: 'inventé', tri: 'motDePasse', unite: 'boîte ;' }), {
    missingPrice: false,
    page: 1,
    query: '',
    sortDir: 'asc',
    sortKey: 'designation',
    stock: 'ALL',
    unit: 'ALL',
  });
});

test('les valeurs par défaut restent hors de l’adresse', () => {
  assert.equal(buildProductListHref(), '/produits');
  assert.equal(buildProductListHref({ page: 1, query: '   ', sortDir: 'asc', sortKey: 'designation', stock: 'ALL', unit: 'ALL' }), '/produits');
  assert.equal(
    buildProductListHref({ missingPrice: true, page: 2, query: 'lait', sortDir: 'desc', sortKey: 'code', stock: 'ZERO', unit: 'PIECE' }),
    '/produits?q=lait&stock=ZERO&unite=PIECE&sansPrix=1&tri=code&sens=desc&page=2',
  );
});

test('la liste filtrée survit à un aller-retour par la fiche', () => {
  const listHref = buildProductListHref({ page: 2, query: 'lait', sortDir: 'desc', sortKey: 'salePriceCentimes', stock: 'POSITIVE' });
  const href = new URL(buildProductHref({ productId, returnHref: listHref, section: 'stock' }), 'https://syphax.invalid');
  assert.equal(href.pathname, `/produits/${productId}`);
  assert.equal(href.searchParams.get('section'), 'stock');
  assert.equal(validateProductListHref(href.searchParams.get('retour')), listHref);
  assert.equal(new URL(buildNewProductHref(listHref), 'https://syphax.invalid').searchParams.get('retour'), listHref);
});

test('un retour étranger à la liste ramène au catalogue complet', () => {
  for (const value of [
    'https://example.com', '//example.com/produits', '/caisse?q=lait', '/produits#ancre',
    '/produits?deleted=1', '/produits?retour=%2Fcaisse', '/produits?q=lait&q=sucre',
  ]) assert.equal(validateProductListHref(value), '/produits');
});

test('la suppression annonce son message sans le laisser dans l’état de la liste', () => {
  const deleted = new URL(buildProductDeletionHref('/produits?q=lait&page=2'), 'https://syphax.invalid');
  assert.equal(deleted.searchParams.get('deleted'), '1');
  assert.equal(deleted.searchParams.get('q'), 'lait');
  assert.equal(validateProductListHref(`${deleted.pathname}${deleted.search}`), '/produits');
  assert.equal(buildProductDeletionHref('/caisse'), '/produits?deleted=1');
});
