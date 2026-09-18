import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAY_RECAP_FILTERS,
  buildDayAlerts,
  buildDayRecapHref,
  buildDaySegments,
  formatDayRecapDate,
  formatDayTourReference,
  normalizeDayRecapDate,
  readDayRecapState,
  readDayTourStages,
  shiftDayRecapDate,
  summarizeDayTour,
  todayInAlgiers,
  validateDayRecapHref,
} from '../lib/day-recap.js';

const today = '2026-09-17';

test('the day state defaults to today and only accepts known days, filters and pages', () => {
  const state = readDayRecapState({}, { today });
  assert.equal(state.date, today);
  assert.equal(state.filter, '');
  assert.equal(state.page, 1);
  assert.equal(state.query, '');
  assert.equal(readDayRecapState({ jour: '2026-02-30' }, { today }).date, today);
  assert.equal(readDayRecapState({ jour: '2026-02-28' }, { today }).date, '2026-02-28');
  assert.equal(readDayRecapState({ jour: ['2026-08-17', '2026-01-01'] }, { today }).date, '2026-08-17');
  assert.equal(readDayRecapState({ jourEtat: 'inconnu' }, { today }).filter, '');
  assert.equal(readDayRecapState({ jourEtat: 'impayes' }, { today }).filter, 'impayes');
  assert.equal(readDayRecapState({ jourPage: '-2' }, { today }).page, 1);
  assert.equal(readDayRecapState({ jourPage: '3' }, { today }).page, 3);
  assert.equal(readDayRecapState({ jourRecherche: `  ${'z'.repeat(140)}  ` }, { today }).query.length, 100);
});

test('day links stay local, drop defaults and survive a round trip', () => {
  assert.equal(buildDayRecapHref(), '/');
  assert.equal(buildDayRecapHref({ date: today, page: 1 }), '/?jour=2026-09-17');
  assert.equal(
    buildDayRecapHref({ date: today, filter: 'impayes', page: 3, query: 'brahim' }),
    '/?jour=2026-09-17&jourEtat=impayes&jourRecherche=brahim&jourPage=3',
  );
  assert.equal(buildDayRecapHref({ filter: 'inventé' }), '/');
  assert.equal(validateDayRecapHref('/?jour=2026-09-17&jourPage=2'), '/?jour=2026-09-17&jourPage=2');
  assert.equal(validateDayRecapHref('//outside.invalid/?jour=2026-09-17'), '/');
  assert.equal(validateDayRecapHref('/caisse?jour=2026-09-17'), '/');
  assert.equal(validateDayRecapHref('/?retour=https://outside.invalid'), '/');
});

test('days are normalized, shifted across months and named in Algiers time', () => {
  assert.equal(normalizeDayRecapDate('2026-13-01'), '');
  assert.equal(normalizeDayRecapDate(' 2026-09-17 '), '2026-09-17');
  assert.equal(shiftDayRecapDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDayRecapDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDayRecapDate('invalide', 1), '');
  assert.match(formatDayRecapDate('2026-09-17'), /jeudi/u);
  assert.equal(formatDayRecapDate('invalide'), 'Date non renseignée');
  assert.equal(todayInAlgiers(new Date('2026-09-17T23:30:00.000Z')), '2026-09-18');
  assert.equal(todayInAlgiers(new Date('2026-09-17T00:30:00.000Z')), '2026-09-17');
});

test('stages track loading, return, settlement and closing independently', () => {
  assert.deepEqual(readDayTourStages({ status: 'PREPARATION' }), [false, false, null, false]);
  assert.deepEqual(readDayTourStages({ status: 'LOADED' }), [true, false, null, false]);
  assert.deepEqual(
    readDayTourStages({ amountPaidInCentimes: 0, remainingDueInCentimes: 3_200, status: 'COUNTED' }),
    [true, true, false, false],
  );
  // A closed tour can still owe money: the settled stage stays open.
  assert.deepEqual(
    readDayTourStages({ amountPaidInCentimes: 100, remainingDueInCentimes: 3_200, status: 'CLOSED' }),
    [true, true, false, true],
  );
  assert.deepEqual(
    readDayTourStages({ amountPaidInCentimes: 3_300, remainingDueInCentimes: 0, status: 'CLOSED' }),
    [true, true, true, true],
  );
  assert.deepEqual(
    readDayTourStages({ amountPaidInCentimes: 3_300, financialsVisible: false, remainingDueInCentimes: 0, status: 'CLOSED' }),
    [true, true, null, true],
  );
});

test('each row shows the one number that matters at its stage', () => {
  assert.deepEqual(
    summarizeDayTour({ loadedValueInCentimes: 14_820_000, status: 'LOADED' }).headline,
    { amountInCentimes: 14_820_000, label: 'En tournée', suffix: 'de marchandise', tone: 'neutral' },
  );
  assert.deepEqual(
    summarizeDayTour({ amountPaidInCentimes: 100, remainingDueInCentimes: 3_216_300, status: 'COUNTED' }).headline,
    { amountInCentimes: 3_216_300, label: 'Reste à encaisser', tone: 'warning' },
  );
  assert.deepEqual(
    summarizeDayTour({ amountPaidInCentimes: 31_408_000, remainingDueInCentimes: 0, status: 'CLOSED' }).headline,
    { amountInCentimes: 31_408_000, label: 'Soldé', suffix: 'versés', tone: 'positive' },
  );
  assert.equal(summarizeDayTour({ amountPaidInCentimes: 10, remainingDueInCentimes: 0, status: 'COUNTED' }).headline.label, 'Réglé, à terminer');
  assert.equal(summarizeDayTour({ status: 'CANCELLED' }).headline.label, 'Annulée');
  assert.equal(summarizeDayTour({ status: 'PREPARATION' }).headline.label, 'Chargement à valider');
  assert.equal(summarizeDayTour({ anomaly: 'OVERPAID', status: 'CLOSED' }).headline.label, 'Données à vérifier');
  // Without the cash permissions the row falls back to what was sold.
  assert.deepEqual(
    summarizeDayTour({ financialsVisible: false, grossSalesInCentimes: 500, status: 'COUNTED' }).headline,
    { amountInCentimes: 500, label: 'Rentré', suffix: 'vendus', tone: 'neutral' },
  );
});

test('the bar decomposes the goods that went out, hiding empty parts', () => {
  const totals = {
    expensesInCentimes: 510_000,
    grossSalesInCentimes: 16_806_300,
    onTourValueInCentimes: 14_820_000,
    paidInCentimes: 13_080_000,
    remainingInCentimes: 3_216_300,
    returnsValueInCentimes: 9_603_700,
    sortieInCentimes: 41_230_000,
  };
  const segments = buildDaySegments(totals);
  assert.deepEqual(segments.map(({ key }) => key), ['paid', 'remaining', 'expenses', 'returns', 'onTour']);
  assert.equal(
    segments.reduce((sum, segment) => sum + segment.amountInCentimes, 0),
    totals.sortieInCentimes,
  );
  assert.equal(Math.round(segments[0].share), 32);
  assert.deepEqual(
    buildDaySegments({ ...totals, expensesInCentimes: 0, remainingInCentimes: 0 }).map(({ key }) => key),
    ['paid', 'returns', 'onTour'],
  );
  assert.deepEqual(
    buildDaySegments(totals, { financialsVisible: false }).map(({ key }) => key),
    ['sold', 'returns', 'onTour'],
  );
  assert.deepEqual(buildDaySegments({ sortieInCentimes: 0 }), []);
  assert.deepEqual(buildDaySegments({ sortieInCentimes: null }), []);
});

test('the attention list names what blocks the day, worst first', () => {
  const record = (overrides) => ({
    deliverer: { name: 'Brahim' },
    expenseDeclarationStatus: 'MISSING',
    id: '1',
    reference: 'TRN-1',
    remainingDueInCentimes: null,
    ...overrides,
  });
  const alerts = buildDayAlerts([
    record({ remainingDueInCentimes: 0, status: 'CLOSED' }),
    record({ reference: 'TRN-2', remainingDueInCentimes: 3_216_300, status: 'COUNTED' }),
    record({ reference: 'TRN-3', status: 'LOADED' }),
    record({ anomaly: 'OVERPAID', reference: 'TRN-4', status: 'CLOSED' }),
    record({ reference: 'TRN-5', status: 'CANCELLED' }),
    record({ expenseDeclarationStatus: 'DECLARED', reference: 'TRN-6', remainingDueInCentimes: 0, status: 'COUNTED' }),
  ], { date: '2026-09-16', returnHref: '/?jour=2026-09-16&jourEtat=impayes', today });
  assert.deepEqual(alerts.map(({ code }) => code), [
    'ANOMALY', 'NOT_RETURNED', 'REMAINING_DUE', 'MISSING_EXPENSES', 'TO_CLOSE',
  ]);
  assert.match(alerts[0].label, /versements supérieurs/u);
  const attention = new URL(alerts[0].href, 'https://syphax.invalid');
  assert.equal(attention.pathname, '/tournees/1');
  assert.equal(attention.searchParams.get('retour'), '/?jour=2026-09-16&jourEtat=impayes');
  // A tour still out on the current day is expected, not an alert.
  const runningDay = buildDayAlerts([record({ reference: 'TRN-3', status: 'LOADED' })], { date: today, today });
  assert.deepEqual(runningDay, []);
});

test('long tour references are shortened to their distinctive tail', () => {
  assert.equal(formatDayTourReference('TRN-6AAA3768542F593F7C689492'), 'TRN-…689492');
  assert.equal(formatDayTourReference('trn-6aaa3768542f593f7c689492'), 'TRN-…689492');
  assert.equal(formatDayTourReference('TRN-HISTORIQUE'), 'TRN-HISTORIQUE');
  assert.equal(formatDayTourReference(''), 'Référence indisponible');
  assert.equal(formatDayTourReference(null), 'Référence indisponible');
});

test('the financial filter is only offered with the cash permissions', () => {
  assert.deepEqual(Object.keys(DAY_RECAP_FILTERS), ['', 'tournee', 'rentres', 'impayes', 'terminees']);
});
