import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterAndSortProducts,
  getProductStockCounts,
  paginateProducts,
  shouldFocusProductSearch,
} from '../app/(protected)/produits/product-table-utils.js';

const makeProduct = ({
  available = 0,
  baseUnit = 'PIECE',
  code,
  designation,
  price = null,
  reserved = 0,
  stock = 0,
}) => ({
  availableQuantityInBaseUnits: available,
  baseUnit,
  code,
  designation,
  id: code,
  reservedQuantityInBaseUnits: reserved,
  salePriceCentimes: price,
  stockQuantityInBaseUnits: stock,
});

const filterProducts = (products, overrides = {}) => filterAndSortProducts({
  onlyMissingPrice: false,
  products,
  query: '',
  sortDir: 'asc',
  sortKey: 'designation',
  stockStatus: 'ALL',
  unit: 'ALL',
  ...overrides,
});

const products = [
  makeProduct({
    available: 0,
    baseUnit: 'BOUTEILLE',
    code: 'EAU-100',
    designation: 'Eau 1 L',
    price: 3600,
    reserved: 12,
    stock: 12,
  }),
  makeProduct({
    available: 97,
    baseUnit: 'BOUTEILLE',
    code: 'SELECTO-100',
    designation: 'Selecto 1 L',
    price: 9400,
    stock: 97,
  }),
  makeProduct({
    available: -1,
    code: 'ANOMALIE-01',
    designation: 'Article à vérifier',
    reserved: 21,
    stock: 20,
  }),
  makeProduct({
    available: 8,
    baseUnit: 'BOITE',
    code: 'THE-020',
    designation: 'Thé vert',
    stock: 8,
  }),
];

test('compte les références sur tout le catalogue par disponibilité', () => {
  assert.deepEqual(getProductStockCounts(products), {
    all: 4,
    negative: 1,
    positive: 2,
    zero: 1,
  });
});

test('combine recherche, unité, disponibilité et prix manquant', () => {
  assert.deepEqual(
    filterProducts(products, {
      onlyMissingPrice: true,
      query: 'thé',
      stockStatus: 'POSITIVE',
      unit: 'BOITE',
    }).map((product) => product.code),
    ['THE-020'],
  );

  assert.deepEqual(
    filterProducts(products, { query: 'eau-100' }).map(
      (product) => product.designation,
    ),
    ['Eau 1 L'],
  );
});

test('distingue les stocks positif, nul et négatif sans seuil arbitraire', () => {
  assert.deepEqual(
    filterProducts(products, { stockStatus: 'ZERO' }).map(
      (product) => product.code,
    ),
    ['EAU-100'],
  );
  assert.deepEqual(
    filterProducts(products, { stockStatus: 'NEGATIVE' }).map(
      (product) => product.code,
    ),
    ['ANOMALIE-01'],
  );
});

test('trie initialement par désignation et trie les textes dans les deux sens', () => {
  assert.deepEqual(
    filterProducts(products).map((product) => product.designation),
    ['Article à vérifier', 'Eau 1 L', 'Selecto 1 L', 'Thé vert'],
  );
  assert.deepEqual(
    filterProducts(products, { sortDir: 'desc' }).map(
      (product) => product.designation,
    ),
    ['Thé vert', 'Selecto 1 L', 'Eau 1 L', 'Article à vérifier'],
  );
  assert.deepEqual(
    filterProducts(products, {
      sortDir: 'desc',
      sortKey: 'code',
    }).map((product) => product.code),
    ['THE-020', 'SELECTO-100', 'EAU-100', 'ANOMALIE-01'],
  );
  assert.deepEqual(
    filterProducts(products, { sortKey: 'baseUnit' }).map(
      (product) => product.baseUnit,
    ),
    ['BOITE', 'BOUTEILLE', 'BOUTEILLE', 'PIECE'],
  );
  assert.deepEqual(
    filterProducts(products, {
      sortDir: 'desc',
      sortKey: 'baseUnit',
    }).map((product) => product.baseUnit),
    ['PIECE', 'BOUTEILLE', 'BOUTEILLE', 'BOITE'],
  );
});

test('trie numériquement les trois quantités', () => {
  assert.deepEqual(
    filterProducts(products, {
      sortKey: 'stockQuantityInBaseUnits',
    }).map((product) => product.stockQuantityInBaseUnits),
    [8, 12, 20, 97],
  );
  assert.deepEqual(
    filterProducts(products, {
      sortDir: 'desc',
      sortKey: 'reservedQuantityInBaseUnits',
    }).map((product) => product.reservedQuantityInBaseUnits),
    [21, 12, 0, 0],
  );
  assert.deepEqual(
    filterProducts(products, {
      sortKey: 'availableQuantityInBaseUnits',
    }).map((product) => product.availableQuantityInBaseUnits),
    [-1, 0, 8, 97],
  );
});

test('place les prix absents après les prix renseignés dans les deux sens', () => {
  assert.deepEqual(
    filterProducts(products, { sortKey: 'salePriceCentimes' }).map(
      (product) => product.salePriceCentimes,
    ),
    [3600, 9400, null, null],
  );
  assert.deepEqual(
    filterProducts(products, {
      sortDir: 'desc',
      sortKey: 'salePriceCentimes',
    }).map((product) => product.salePriceCentimes),
    [9400, 3600, null, null],
  );
});

test('pagine dix produits et gère plus de vingt références', () => {
  const extendedProducts = Array.from({ length: 25 }, (_, index) => (
    makeProduct({
      code: `PRODUIT-${index + 1}`,
      designation: `Produit ${index + 1}`,
    })
  ));

  assert.equal(paginateProducts(extendedProducts, 1).pageProducts.length, 10);
  assert.equal(paginateProducts(extendedProducts, 2).pageProducts.length, 10);
  assert.equal(paginateProducts(extendedProducts, 3).pageProducts.length, 5);
  assert.equal(paginateProducts(extendedProducts, 3).totalPages, 3);
  assert.equal(paginateProducts(extendedProducts, 99).activePage, 3);
});

test('gère un catalogue vide et une recherche sans résultat', () => {
  assert.deepEqual(filterProducts([]), []);
  assert.deepEqual(filterProducts(products, { query: 'introuvable' }), []);
  assert.deepEqual(paginateProducts([], 1), {
    activePage: 1,
    firstProductIndex: 0,
    pageProducts: [],
    totalPages: 1,
  });
});

test('active le raccourci barre oblique hors des champs de saisie', () => {
  const shortcutEvent = {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: '/',
    metaKey: false,
    target: { isContentEditable: false, tagName: 'DIV' },
  };

  assert.equal(shouldFocusProductSearch(shortcutEvent), true);
  assert.equal(shouldFocusProductSearch({
    ...shortcutEvent,
    target: { isContentEditable: false, tagName: 'INPUT' },
  }), false);
  assert.equal(shouldFocusProductSearch({
    ...shortcutEvent,
    target: { isContentEditable: true, tagName: 'DIV' },
  }), false);
  assert.equal(shouldFocusProductSearch({
    ...shortcutEvent,
    ctrlKey: true,
  }), false);
});
