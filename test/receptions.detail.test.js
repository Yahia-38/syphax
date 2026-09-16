import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReceptionHistoryHref,
  calculateReceptionUnitCostInCentimes,
  formatReceptionDate,
  formatReceptionDifference,
  formatReceptionMoney,
  formatReceptionRecordedAt,
  formatReceptionUnitCost,
  readReceptionHistoryState,
  summarizeReceptionAmounts,
  validateReceptionHistoryHref,
} from '../lib/receptions.js';

test('distingue la date métier de l’instant enregistré à Alger', () => {
  assert.equal(formatReceptionDate('2026-09-13'), '13 septembre 2026');
  assert.match(
    formatReceptionRecordedAt('2026-09-12T23:30:00.000Z'),
    /13 septembre 2026.*00:30/u,
  );
});

test('distingue un montant absent de zéro et calcule le coût unitaire', () => {
  assert.equal(formatReceptionMoney(null), 'Non renseigné');
  assert.equal(formatReceptionMoney(0), '0 DA');
  assert.equal(formatReceptionUnitCost({
    amountInCentimes: null,
    quantityInBaseUnits: 10,
  }), 'Non calculable');
  assert.equal(calculateReceptionUnitCostInCentimes({
    amountInCentimes: 12_000,
    quantityInBaseUnits: 60,
  }), 200);
  assert.equal(formatReceptionUnitCost({
    amountInCentimes: 12_000,
    quantityInBaseUnits: 60,
  }), '2 DA');
});

test('présente un total complet uniquement lorsque toutes les lignes le sont', () => {
  assert.deepEqual(summarizeReceptionAmounts([
    { amountInCentimes: 0 },
    { amountInCentimes: 12_000 },
  ], 12_500), {
    complete: true,
    documentTotalInCentimes: 12_500,
    gapInCentimes: 500,
    incompleteLineCount: 0,
    knownSubtotalInCentimes: 12_000,
  });
  assert.equal(formatReceptionDifference(-500), '−5 DA');

  assert.deepEqual(summarizeReceptionAmounts([
    { amountInCentimes: 0 },
    { amountInCentimes: null },
  ], 12_500), {
    complete: false,
    documentTotalInCentimes: 12_500,
    gapInCentimes: null,
    incompleteLineCount: 1,
    knownSubtotalInCentimes: 0,
  });
  assert.equal(
    summarizeReceptionAmounts([
      { amountInCentimes: null },
    ]).knownSubtotalInCentimes,
    null,
  );
});

test('conserve et relit le contexte de l’historique', () => {
  const supplierId = '64f000000000000000000001';
  const href = buildReceptionHistoryHref({
    page: 3,
    query: 'eau 1 L',
    supplierId,
  });

  assert.equal(
    href,
    `/receptions?recherche=eau+1+L&fournisseur=${supplierId}&page=3`,
  );
  assert.deepEqual(readReceptionHistoryState({
    fournisseur: supplierId,
    page: '3',
    recherche: 'eau 1 L',
  }), {
    page: 3,
    query: 'eau 1 L',
    supplierId,
  });
  assert.equal(validateReceptionHistoryHref(href), href);
});

test('refuse une destination de retour externe ou étrangère à l’historique', () => {
  assert.equal(
    validateReceptionHistoryHref('https://example.com/receptions'),
    '/receptions',
  );
  assert.equal(validateReceptionHistoryHref('//example.com/receptions'), '/receptions');
  assert.equal(validateReceptionHistoryHref('/produits'), '/receptions');
  assert.equal(
    validateReceptionHistoryHref('/receptions?destination=/administration'),
    '/receptions',
  );
});

test('préserve les quatre décimales du coût et refuse les quantités nulles', () => {
  assert.equal(formatReceptionUnitCost({ amountInCentimes: 100, quantityInBaseUnits: 3 }), '0,3333 DA');
  assert.equal(formatReceptionUnitCost({ amountInCentimes: 0, quantityInBaseUnits: 0 }), 'Non calculable');
  assert.equal(formatReceptionUnitCost({ amountInCentimes: 0, quantityInBaseUnits: 3 }), '0 DA');
});

test('distingue total absent, réception vide et écarts signés', () => {
  const lines = [{ amountInCentimes: 100 }];
  assert.equal(summarizeReceptionAmounts(lines, 100).gapInCentimes, 0);
  assert.equal(summarizeReceptionAmounts(lines, 50).gapInCentimes, -50);
  assert.equal(summarizeReceptionAmounts(lines, 150).gapInCentimes, 50);
  assert.equal(summarizeReceptionAmounts(lines).gapInCentimes, null);
  assert.equal(summarizeReceptionAmounts([], 0).knownSubtotalInCentimes, null);
  assert.equal(summarizeReceptionAmounts([], 0).gapInCentimes, null);
  assert.equal(formatReceptionMoney(Number.MAX_SAFE_INTEGER + 1), 'Non renseigné');
});

test('canonise l’onglet réceptions et rejette fragments et onglets étrangers', () => {
  assert.equal(validateReceptionHistoryHref('/receptions?onglet=receptions&page=2&recherche=eau'), '/receptions?recherche=eau&page=2');
  assert.equal(validateReceptionHistoryHref('/receptions#lignes'), '/receptions');
  assert.equal(validateReceptionHistoryHref('/receptions?onglet=fournisseurs'), '/receptions');
});
