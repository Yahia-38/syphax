import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateLoadedLineValue,
  calculateTourCounting,
  calculateTourCountingLine,
} from '../lib/tour-counting-calculations.js';

const createLine = ({
  amountInCentimes = 15_000,
  baseUnit = 'BOUTEILLE',
  id = 'line-1',
  quantityInBaseUnits = 60,
  salePriceAtLoading,
} = {}) => ({
  baseUnit,
  id,
  quantityInBaseUnits,
  salePriceAtLoading: salePriceAtLoading === undefined
    ? {
        amountInCentimes,
        currency: 'DZD',
        taxIncluded: true,
        unit: baseUnit,
      }
    : salePriceAtLoading,
});

test('valorise une ligne chargée uniquement avec son prix historique', () => {
  const line = {
    ...createLine({
      amountInCentimes: 15_000,
      quantityInBaseUnits: 60,
    }),
    currentSalePrice: {
      amountInCentimes: 99_999_999,
      currency: 'DZD',
      taxIncluded: true,
      unit: 'BOUTEILLE',
    },
  };

  assert.deepEqual(calculateLoadedLineValue(line), {
    error: null,
    priceAvailable: true,
    valueInCentimes: 900_000,
  });
  assert.deepEqual(calculateLoadedLineValue({
    ...line,
    salePriceAtLoading: null,
  }), {
    error: null,
    priceAvailable: false,
    valueInCentimes: null,
  });
});

test('refuse une quantité chargée invalide et un produit numérique trop élevé', () => {
  const invalidQuantity = calculateLoadedLineValue(createLine({
    quantityInBaseUnits: Number.MAX_SAFE_INTEGER + 1,
  }));
  const emptyQuantity = calculateLoadedLineValue(createLine({
    quantityInBaseUnits: 0,
  }));
  const overflow = calculateLoadedLineValue(createLine({
    amountInCentimes: 2,
    quantityInBaseUnits: Number.MAX_SAFE_INTEGER,
  }));

  assert.match(invalidQuantity.error, /quantité chargée historique/u);
  assert.equal(invalidQuantity.valueInCentimes, null);
  assert.match(emptyQuantity.error, /quantité chargée historique/u);
  assert.equal(emptyQuantity.valueInCentimes, null);
  assert.match(overflow.error, /limite numérique/u);
  assert.equal(overflow.valueInCentimes, null);
});

test('calcule 50 bouteilles vendues et 7 500 DA dus', () => {
  const calculation = calculateTourCountingLine(createLine(), '10');

  assert.deepEqual(calculation, {
    amountDueInCentimes: 750_000,
    error: null,
    inputComplete: true,
    priceAvailable: true,
    returnedQuantityInBaseUnits: 10,
    soldQuantityInBaseUnits: 50,
  });
});

test('traite explicitement zéro retour et le retour complet', () => {
  const line = createLine();
  const noReturn = calculateTourCountingLine(line, '0');
  const fullReturn = calculateTourCountingLine(line, '60');

  assert.equal(noReturn.soldQuantityInBaseUnits, 60);
  assert.equal(noReturn.amountDueInCentimes, 900_000);
  assert.equal(fullReturn.soldQuantityInBaseUnits, 0);
  assert.equal(fullReturn.amountDueInCentimes, 0);
});

test('distingue un retour inconnu des saisies invalides', () => {
  const line = createLine();
  const empty = calculateTourCountingLine(line, '');
  const negative = calculateTourCountingLine(line, '-1');
  const fractional = calculateTourCountingLine(line, '1,5');
  const excessive = calculateTourCountingLine(line, '61');

  assert.equal(empty.inputComplete, false);
  assert.equal(empty.error, null);
  assert.equal(empty.soldQuantityInBaseUnits, null);
  assert.match(negative.error, /négative/u);
  assert.match(fractional.error, /entier/u);
  assert.match(excessive.error, /dépasser la quantité chargée/u);

  for (const invalid of [empty, negative, fractional, excessive]) {
    assert.equal(invalid.amountDueInCentimes, null);
  }
});

test('additionne uniquement les montants de plusieurs produits', () => {
  const lines = [
    createLine({ id: 'bouteilles' }),
    createLine({
      amountInCentimes: 20_000,
      baseUnit: 'PIECE',
      id: 'pieces',
      quantityInBaseUnits: 10,
    }),
  ];
  const summary = calculateTourCounting(lines, {
    bouteilles: '10',
    pieces: '2',
  });

  assert.equal(summary.complete, true);
  assert.equal(summary.totalDueInCentimes, 910_000);
  assert.equal(summary.knownSubtotalInCentimes, 910_000);
});

test('une ligne vide garde seulement un sous-total clairement incomplet', () => {
  const lines = [
    createLine({ id: 'known' }),
    createLine({ id: 'unknown' }),
  ];
  const summary = calculateTourCounting(lines, { known: '10' });

  assert.equal(summary.complete, false);
  assert.equal(summary.incompleteLineCount, 1);
  assert.equal(summary.knownAmountLineCount, 1);
  assert.equal(summary.knownSubtotalInCentimes, 750_000);
  assert.equal(summary.totalDueInCentimes, null);
});

test('ne remplace jamais un prix historique absent par un autre tarif', () => {
  const line = {
    ...createLine({ salePriceAtLoading: null }),
    currentSalePrice: {
      amountInCentimes: 99_900,
      currency: 'DZD',
      taxIncluded: true,
      unit: 'BOUTEILLE',
    },
  };
  const calculation = calculateTourCountingLine(line, '10');
  const summary = calculateTourCounting([line], { 'line-1': '10' });

  assert.equal(calculation.soldQuantityInBaseUnits, 50);
  assert.equal(calculation.priceAvailable, false);
  assert.equal(calculation.amountDueInCentimes, null);
  assert.equal(summary.complete, false);
  assert.equal(summary.missingPriceLineCount, 1);
  assert.equal(summary.totalDueInCentimes, null);
});

test('refuse les dépassements de ligne et de sous-total', () => {
  const overflowingLine = createLine({
    amountInCentimes: 2,
    quantityInBaseUnits: Number.MAX_SAFE_INTEGER,
  });
  const lineCalculation = calculateTourCountingLine(overflowingLine, '0');
  const maximumAmountLines = [
    createLine({
      amountInCentimes: Number.MAX_SAFE_INTEGER,
      baseUnit: 'PIECE',
      id: 'maximum-1',
      quantityInBaseUnits: 1,
    }),
    createLine({
      amountInCentimes: Number.MAX_SAFE_INTEGER,
      baseUnit: 'PIECE',
      id: 'maximum-2',
      quantityInBaseUnits: 1,
    }),
  ];
  const summary = calculateTourCounting(maximumAmountLines, {
    'maximum-1': '0',
    'maximum-2': '0',
  });

  assert.match(lineCalculation.error, /montant dû.*limite/u);
  assert.equal(lineCalculation.amountDueInCentimes, null);
  assert.equal(summary.subtotalOverflow, true);
  assert.equal(summary.knownSubtotalInCentimes, null);
  assert.equal(summary.totalDueInCentimes, null);
});
