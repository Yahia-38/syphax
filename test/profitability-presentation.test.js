import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areProfitabilityTotalsComplete,
  describeProfitabilityTotal,
  formatProfitabilityCoverage,
  getProfitabilityMarginRate,
  getProfitabilityResultTone,
} from '../lib/profitability-presentation.js';

const total = (amountInCentimes, unknownCount = 0) => ({
  amountInCentimes,
  complete: amountInCentimes !== null && unknownCount === 0,
  unknownCount,
});

test('chaque total indique les tournées dont le montant est connu', () => {
  const complete = describeProfitabilityTotal(total(1_300_000), 13);
  const partial = describeProfitabilityTotal(total(1_000_000, 3), 13);

  assert.equal(complete.state, 'COMPLETE');
  assert.equal(formatProfitabilityCoverage(complete), '13 / 13 tournées · complet');
  assert.equal(partial.state, 'PARTIAL');
  assert.equal(partial.amountInCentimes, 1_000_000);
  assert.equal(formatProfitabilityCoverage(partial), '10 / 13 tournées · partiel');
  assert.equal(formatProfitabilityCoverage(describeProfitabilityTotal(total(0), 1)), '1 / 1 tournée · complet');
});

test('sans montant connu, le total n’est pas lu comme zéro', () => {
  const unknown = describeProfitabilityTotal(total(0, 4), 4);

  assert.equal(unknown.state, 'UNKNOWN');
  assert.equal(unknown.amountInCentimes, null);
  assert.equal(formatProfitabilityCoverage(unknown), '0 / 4 tournées · partiel');
  assert.equal(getProfitabilityResultTone(unknown), 'partial');
});

test('un zéro connu reste un montant, une sélection vide et un dépassement se distinguent', () => {
  const zero = describeProfitabilityTotal(total(0), 3);
  const empty = describeProfitabilityTotal(total(0), 0);
  const overflow = describeProfitabilityTotal({ amountInCentimes: null, complete: false, unknownCount: 0 }, 3);

  assert.equal(zero.state, 'COMPLETE');
  assert.equal(zero.amountInCentimes, 0);
  assert.equal(getProfitabilityResultTone(zero), 'positive');
  assert.equal(empty.state, 'EMPTY');
  assert.equal(formatProfitabilityCoverage(empty), 'Aucune tournée dans la sélection');
  assert.equal(getProfitabilityResultTone(empty), 'positive');
  assert.equal(overflow.state, 'OVERFLOW');
  assert.equal(overflow.amountInCentimes, null);
  assert.equal(formatProfitabilityCoverage(overflow), 'Total non calculable · capacité numérique dépassée');
  assert.equal(getProfitabilityResultTone(overflow), 'partial');
});

test('le résultat garde sa couleur : perte en rouge, partiel en ambre, sinon en vert', () => {
  assert.equal(getProfitabilityResultTone(describeProfitabilityTotal(total(-50_000), 2)), 'negative');
  assert.equal(getProfitabilityResultTone(describeProfitabilityTotal(total(-50_000, 1), 2)), 'negative');
  assert.equal(getProfitabilityResultTone(describeProfitabilityTotal(total(50_000, 1), 2)), 'partial');
  assert.equal(getProfitabilityResultTone(describeProfitabilityTotal(total(50_000), 2)), 'positive');
});

test('le taux de marge ne se calcule que sur des ventes et une marge complètes', () => {
  const totals = {
    costOfGoodsSold: total(600_000),
    expenses: total(100_000),
    margin: total(400_000),
    result: total(300_000),
    sales: total(1_000_000),
  };

  assert.equal(getProfitabilityMarginRate(totals), 40);
  assert.equal(areProfitabilityTotalsComplete(totals), true);
  assert.equal(getProfitabilityMarginRate({ ...totals, margin: total(400_000, 1) }), null);
  assert.equal(getProfitabilityMarginRate({ ...totals, sales: total(0) }), null);
  assert.equal(areProfitabilityTotalsComplete({ ...totals, expenses: total(0, 2) }), false);
});
