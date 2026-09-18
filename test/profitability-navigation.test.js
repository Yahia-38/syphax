import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProfitabilityCountingHref,
  buildProfitabilityHref,
  getProfitabilityMonth,
  isProfitabilityHref,
  readProfitabilityState,
  toProfitabilityReportFilters,
  validateProfitabilityHref,
} from '../lib/profitability-navigation.js';
import { buildDelivererToursHref, describeTourReturn, validateTourReturnHref } from '../lib/tours.js';

const delivererId = '6aa73924f609544f68c37666';
const tourId = '6aa87bf1a6c1118e767192f0';

test('l’adresse de la rentabilité porte la période, le livreur, le statut, la recherche et la page', () => {
  const state = readProfitabilityState({
    au: '2026-09-30',
    du: '2026-09-01',
    livreur: delivererId,
    page: '3',
    q: '  TRN-42  ',
    statut: 'terminees',
  });

  assert.deepEqual(state, {
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    delivererId,
    page: 3,
    query: 'TRN-42',
    status: 'terminees',
  });
  assert.equal(
    buildProfitabilityHref(state),
    `/rentabilite?du=2026-09-01&au=2026-09-30&livreur=${delivererId}&statut=terminees&q=TRN-42&page=3`,
  );
  assert.deepEqual(toProfitabilityReportFilters(state), {
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    delivererId,
    page: 3,
    query: 'TRN-42',
    status: 'CLOSED',
  });
  assert.equal(toProfitabilityReportFilters(readProfitabilityState({ statut: 'comptees' })).status, 'COUNTED');
});

test('une valeur invalide est ignorée et une période inversée est remise dans l’ordre', () => {
  assert.deepEqual(readProfitabilityState({
    au: '2026-02-30',
    du: 'hier',
    livreur: 'inconnu',
    page: '-2',
    statut: 'CLOSED',
  }), {
    dateFrom: '',
    dateTo: '',
    delivererId: '',
    page: 1,
    query: '',
    status: '',
  });

  const reversed = readProfitabilityState({ au: '2026-09-01', du: '2026-09-30' });

  assert.equal(reversed.dateFrom, '2026-09-01');
  assert.equal(reversed.dateTo, '2026-09-30');
  assert.equal(buildProfitabilityHref(), '/rentabilite');
  assert.equal(buildProfitabilityHref({ page: 1, query: '   ' }), '/rentabilite');
});

test('sans période dans l’adresse, la rentabilité s’ouvre sur le mois en cours', () => {
  assert.deepEqual(getProfitabilityMonth('2026-09-18'), { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.deepEqual(getProfitabilityMonth('2028-02-10'), { dateFrom: '2028-02-01', dateTo: '2028-02-29' });
  assert.deepEqual(getProfitabilityMonth('2026-12-31'), { dateFrom: '2026-12-01', dateTo: '2026-12-31' });
  assert.deepEqual(getProfitabilityMonth(''), { dateFrom: '', dateTo: '' });

  const state = readProfitabilityState({ page: '2' }, { today: '2026-09-18' });

  assert.equal(state.dateFrom, '2026-09-01');
  assert.equal(state.dateTo, '2026-09-30');
  // The page keeps the month in the address it links back to.
  assert.equal(buildProfitabilityHref(state), '/rentabilite?du=2026-09-01&au=2026-09-30&page=2');

  // A period cleared in the form (du=&au=) covers every period, and stays so.
  const everyPeriod = readProfitabilityState({ au: '', du: '' }, { today: '2026-09-18' });

  assert.equal(everyPeriod.dateFrom, '');
  assert.equal(everyPeriod.dateTo, '');
  assert.equal(buildProfitabilityHref(everyPeriod), '/rentabilite?du=');
  assert.equal(readProfitabilityState({ du: '' }, { today: '2026-09-18' }).dateTo, '');

  // A single bound is kept as given, without the other bound of the month.
  assert.equal(readProfitabilityState({ du: '2026-08-15' }, { today: '2026-09-18' }).dateTo, '');
});

test('seule la page de rentabilité est reconnue, et sa requête est reconstruite', () => {
  assert.equal(isProfitabilityHref('/rentabilite?page=2'), true);

  for (const value of ['/', '/rentabilite/autre', '//example.com/rentabilite', 'https://example.com/rentabilite', '', null]) {
    assert.equal(isProfitabilityHref(value), false);
  }

  assert.equal(validateProfitabilityHref('/rentabilite?q=%20brahim%20&page=2'), '/rentabilite?q=brahim&page=2');
  assert.equal(validateProfitabilityHref('/rentabilite?du=&page=2'), '/rentabilite?du=&page=2');

  for (const value of ['/rentabilite?retour=https://example.com', '/rentabilite?page=2&page=3', '/rentabilite#comptage', '/caisse']) {
    assert.equal(validateProfitabilityHref(value), '/rentabilite');
  }
});

test('le lien vers le comptage ouvre les opérations de la tournée et garde la sélection', () => {
  const returnHref = `/rentabilite?du=2026-09-01&livreur=${delivererId}&page=2`;
  const href = new URL(buildProfitabilityCountingHref({ returnHref, tourId }), 'https://syphax.invalid');

  assert.equal(href.pathname, `/tournees/${tourId}`);
  assert.equal(href.hash, '#comptage');
  assert.equal(href.searchParams.get('onglet'), 'operations');
  assert.equal(href.searchParams.get('retour'), returnHref);

  const foreign = new URL(buildProfitabilityCountingHref({ returnHref: '//example.com/', tourId }), 'https://syphax.invalid');

  assert.equal(foreign.searchParams.get('retour'), '/rentabilite');
});

test('la fiche tournée ramène à la rentabilité et l’annonce', () => {
  const returnHref = '/rentabilite?statut=comptees&page=2';

  assert.equal(validateTourReturnHref(returnHref, delivererId), returnHref);
  assert.equal(validateTourReturnHref('/rentabilite?inconnu=1', delivererId), '/rentabilite');
  assert.equal(validateTourReturnHref('/rentabilites', delivererId), buildDelivererToursHref({ delivererId }));
  assert.deepEqual(describeTourReturn(returnHref), {
    label: '← Retour à la rentabilité',
    target: 'profitability',
  });
  assert.equal(describeTourReturn('/?jour=2026-09-17').target, 'dayRecap');
});
