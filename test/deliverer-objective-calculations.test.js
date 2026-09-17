import assert from 'node:assert/strict';
import test from 'node:test';

import { getObjectiveCurrentMonth, isObjectiveMonth, readObjectiveHistoryState } from '../lib/deliverer-objective-calculations.js';

test('le mois courant suit les limites de mois et d’année en Algérie', () => {
  assert.equal(getObjectiveCurrentMonth(new Date('2026-09-30T22:59:59Z')), '2026-09');
  assert.equal(getObjectiveCurrentMonth(new Date('2026-09-30T23:00:00Z')), '2026-10');
  assert.equal(getObjectiveCurrentMonth(new Date('2026-12-31T23:00:00Z')), '2027-01');
});

test('les paramètres d’historique sont normalisés et limités', () => {
  assert.equal(isObjectiveMonth('2026-12'), true);
  assert.equal(isObjectiveMonth('2026-13'), false);
  assert.deepEqual(readObjectiveHistoryState({ objectifPage: '-1', objectifMois: '2026-13', objectifRecherche: [' yahia ', 'autre'] }), {
    objectivePage: 1, objectiveMonth: '', objectiveQuery: 'yahia',
  });
  assert.equal(readObjectiveHistoryState({ objectifRecherche: 'a'.repeat(200) }).objectiveQuery.length, 100);
});
