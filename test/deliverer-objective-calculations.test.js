import assert from 'node:assert/strict';
import test from 'node:test';

import { buildObjectiveMonthlyHistory, getObjectiveAchievementStatus, getObjectiveCurrentMonth, isObjectiveMonth, readObjectiveAchievementState, readObjectiveHistoryState } from '../lib/deliverer-objective-calculations.js';

test('le mois courant suit les limites de mois et d’année en Algérie', () => {
  assert.equal(getObjectiveCurrentMonth(new Date('2026-09-30T22:59:59Z')), '2026-09');
  assert.equal(getObjectiveCurrentMonth(new Date('2026-09-30T23:00:00Z')), '2026-10');
  assert.equal(getObjectiveCurrentMonth(new Date('2026-12-31T23:00:00Z')), '2027-01');
});

test('un objectif manqué ne devient non atteint qu’après la fin du mois en Algérie', () => {
  const achievement = { month: '2026-09', complete: true, targetInCentimes: 1000, reached: false };
  assert.equal(getObjectiveAchievementStatus(achievement, getObjectiveCurrentMonth(new Date('2026-09-30T22:59:59Z'))), 'ongoing');
  assert.equal(getObjectiveAchievementStatus(achievement, getObjectiveCurrentMonth(new Date('2026-09-30T23:00:00Z'))), 'missed');
  assert.equal(getObjectiveAchievementStatus({ ...achievement, reached: true }, '2026-09'), 'reached');
  assert.equal(getObjectiveAchievementStatus({ ...achievement, reached: true }, '2026-10'), 'reached');
  assert.equal(getObjectiveAchievementStatus({ ...achievement, month: '2026-11' }, '2026-10'), 'ongoing');
  assert.equal(getObjectiveAchievementStatus({ ...achievement, targetInCentimes: null }, '2026-10'), 'undefined');
  assert.equal(getObjectiveAchievementStatus({ ...achievement, complete: false, reached: null }, '2026-10'), 'incomplete');
});

test('la sélection mensuelle et les filtres de bilan normalisent les paramètres', () => {
  assert.deepEqual(readObjectiveAchievementState({}, '2026-09'), {
    achievementMonth: '2026-09', historyYear: '2026', historyStatus: '', historyQuery: '', historyPage: 1,
  });
  assert.deepEqual(readObjectiveAchievementState({
    bilanMois: ['2025-12', '2026-09'], bilanAnnee: '2025', bilanStatut: 'missed', bilanRecherche: ' décembre ', bilanPage: '2',
  }, '2026-09'), {
    achievementMonth: '2025-12', historyYear: '2025', historyStatus: 'missed', historyQuery: 'décembre', historyPage: 2,
  });
  const invalid = readObjectiveAchievementState({ bilanMois: '2026-13', bilanAnnee: 'abc', bilanStatut: 'toString', bilanPage: '9007199254740992', bilanRecherche: 'a'.repeat(200) }, '2026-09');
  assert.equal(invalid.achievementMonth, '2026-09');
  assert.equal(invalid.historyYear, '2026');
  assert.equal(invalid.historyStatus, '');
  assert.equal(invalid.historyPage, 1);
  assert.equal(invalid.historyQuery.length, 100);
});

test('l’historique mensuel couvre les mois sans ventes et filtre avant pagination', () => {
  const readMonth = (month) => ({ month, status: month === '2026-09' ? 'ongoing' : month === '2026-08' ? 'reached' : 'missed' });
  const read = (params = {}) => buildObjectiveMonthlyHistory({
    firstMonth: '2025-11', currentMonth: '2026-09', state: readObjectiveAchievementState(params, '2026-09'), readMonth,
  });
  const first = read();
  assert.deepEqual(first.years, ['2026', '2025']);
  assert.equal(first.totalItems, 9);
  assert.equal(first.totalPages, 2);
  assert.deepEqual(first.rows.map(({ month }) => month), ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05']);
  assert.deepEqual(read({ bilanPage: '999' }).rows.map(({ month }) => month), ['2026-04', '2026-03', '2026-02', '2026-01']);
  assert.equal(read({ bilanStatut: 'missed' }).totalItems, 7);
  assert.equal(read({ bilanStatut: 'reached' }).rows[0].month, '2026-08');
  assert.equal(read({ bilanRecherche: 'février' }).rows[0].month, '2026-02');
  assert.equal(read({ bilanRecherche: 'inconnu' }).rows.length, 0);
  assert.deepEqual(read({ bilanAnnee: '2025' }).rows.map(({ month }) => month), ['2025-12', '2025-11']);
  assert.equal(read({ bilanAnnee: '9999' }).historyYear, '2026');
});

test('les paramètres d’historique sont normalisés et limités', () => {
  assert.equal(isObjectiveMonth('2026-12'), true);
  assert.equal(isObjectiveMonth('2026-13'), false);
  assert.deepEqual(readObjectiveHistoryState({ objectifPage: '-1', objectifMois: '2026-13', objectifRecherche: [' yahia ', 'autre'] }), {
    objectivePage: 1, objectiveMonth: '', objectiveQuery: 'yahia',
  });
  assert.equal(readObjectiveHistoryState({ objectifRecherche: 'a'.repeat(200) }).objectiveQuery.length, 100);
});
