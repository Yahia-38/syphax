import assert from 'node:assert/strict';
import test from 'node:test';

import { readTab, TAB_PARAMETER, withTab } from '../lib/tab-navigation.js';

const tabs = [
  { key: 'journal', label: 'Journal' },
  { key: 'restes', label: 'À encaisser' },
];

test('un seul paramètre adresse un onglet dans toute l’application', () => {
  assert.equal(TAB_PARAMETER, 'onglet');
});

test('l’onglet se lit de la même façon côté serveur et côté client', () => {
  for (const source of [
    { onglet: 'restes' },
    { onglet: ['restes'] },
    new URLSearchParams('onglet=restes'),
    new URLSearchParams('q=amine&onglet=restes&page=2'),
  ]) assert.equal(readTab(source, tabs), 'restes');
});

test('une adresse sans onglet lisible retombe sur le défaut de la page', () => {
  for (const source of [
    {},
    { onglet: 'inventé' },
    { onglet: '' },
    { onglet: ['restes', 'journal'] },
    new URLSearchParams('onglet=restes&onglet=journal'),
    new URLSearchParams('onglet=%2Fcaisse'),
  ]) assert.equal(readTab(source, tabs), 'journal');
});

test('un onglet que la page n’offre pas n’est jamais retenu', () => {
  const restricted = [{ key: 'identification', label: 'Identification' }];
  assert.equal(readTab({ onglet: 'ensemble' }, restricted), 'identification');
  assert.equal(readTab({}, restricted, 'ensemble'), 'identification');
  assert.equal(readTab({}, tabs, 'restes'), 'restes');
  assert.equal(readTab({}, []), '');
});

test('les clés seules sont acceptées comme liste d’onglets', () => {
  assert.equal(readTab({ onglet: 'produits' }, ['operations', 'produits']), 'produits');
});

test('changer d’onglet laisse le reste de l’adresse intact', () => {
  const parameters = withTab('q=amine&page=2&onglet=journal', 'restes');
  assert.equal(parameters.get('onglet'), 'restes');
  assert.equal(parameters.get('q'), 'amine');
  assert.equal(parameters.get('page'), '2');
  assert.equal(withTab('', 'journal').toString(), 'onglet=journal');
});
