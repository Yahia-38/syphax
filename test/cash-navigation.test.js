import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCashFilterHref, buildCashViewHref, formatCashSignedAmount, readCashView } from '../lib/cash-navigation.js';
import { buildCashJournalHref, buildCashRemaindersHref, validateCashJournalHref } from '../lib/cash-payments.js';

const search = 'q=note&livreur=6aa73924f609544f68c37666&du=2026-09-01&au=2026-09-16&page=3&resteRecherche=amine&restePage=2&source=fiche';

test('whitelists the view and preserves both independent selections when switching', () => {
  assert.equal(readCashView('unknown'), 'journal');
  assert.equal(readCashView(['restes', 'journal']), 'restes');
  const result = new URL(buildCashViewHref(search, 'restes'), 'https://syphax.invalid');
  assert.equal(result.searchParams.get('vue'), 'restes');
  for (const [key, value] of new URLSearchParams(search)) assert.equal(result.searchParams.get(key), value);
});

test('journal apply/reset preserves remainder search, pagination and unrelated parameters', () => {
  const reset = new URL(buildCashFilterHref(search, 'journal'), 'https://syphax.invalid');
  assert.equal(reset.searchParams.has('q'), false);
  assert.equal(reset.searchParams.has('du'), false);
  assert.equal(reset.searchParams.has('page'), false);
  assert.equal(reset.searchParams.get('resteRecherche'), 'amine');
  assert.equal(reset.searchParams.get('restePage'), '2');
  assert.equal(reset.searchParams.get('source'), 'fiche');
  const applied = new URL(buildCashFilterHref(search, 'journal', [['q', 'versement'], ['resteRecherche', 'ignored']]), 'https://syphax.invalid');
  assert.equal(applied.searchParams.get('q'), 'versement');
  assert.equal(applied.searchParams.get('resteRecherche'), 'amine');
});

test('remainder apply/reset preserves journal filters and pagination', () => {
  const applied = new URL(buildCashFilterHref(search, 'restes', [['resteRecherche', 'salim']]), 'https://syphax.invalid');
  assert.equal(applied.searchParams.get('resteRecherche'), 'salim');
  assert.equal(applied.searchParams.has('restePage'), false);
  assert.equal(applied.searchParams.get('q'), 'note');
  assert.equal(applied.searchParams.get('page'), '3');
  assert.equal(applied.searchParams.get('au'), '2026-09-16');
});

test('legacy cash links stay compatible and validated view links remain local', () => {
  assert.equal(buildCashJournalHref(), '/caisse');
  assert.equal(buildCashRemaindersHref(), '/caisse');
  assert.equal(buildCashRemaindersHref({ view: 'restes', query: 'amine' }), '/caisse?resteRecherche=amine&vue=restes');
  assert.equal(validateCashJournalHref('/caisse?page=2&vue=restes'), '/caisse?page=2&vue=restes');
  assert.equal(validateCashJournalHref('/caisse?vue=https://outside.invalid'), '/caisse?vue=journal');
  assert.equal(validateCashJournalHref('//outside.invalid/caisse?vue=restes'), '/caisse');
  assert.equal(validateCashJournalHref('/caisse?retour=https://outside.invalid'), '/caisse');
});

test('negative journal variation is formatted as money, unknown values stay unknown', () => {
  assert.match(formatCashSignedAmount(-350000), /^−.*3.*500 DA$/u);
  assert.equal(formatCashSignedAmount(null), 'Non calculable');
  assert.equal(formatCashSignedAmount(0), '0 DA');
});
