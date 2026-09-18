import assert from 'node:assert/strict';
import test from 'node:test';

import { getDelivererTabs, readDelivererTab } from '../lib/deliverer-detail-navigation.js';
import { buildDelivererToursHref, validateTourReturnHref } from '../lib/tours.js';

const id = '0123456789abcdef01234567';

test('onglets et choix initial suivent les lectures indépendantes', () => {
  for (const canReadCash of [false, true]) for (const canReadCreditLimit of [false, true]) for (const canReadTours of [false, true]) {
    const tabs = getDelivererTabs({ canReadCash, canReadCreditLimit, canReadTours });
    assert.equal(tabs.some(({ key }) => key === 'ensemble'), canReadCash || canReadCreditLimit);
    assert.equal(tabs.some(({ key }) => key === 'tournees'), canReadTours);
    assert.equal(readDelivererTab({}, tabs), canReadCash || canReadCreditLimit ? 'ensemble' : canReadTours ? 'tournees' : 'identification');
    assert.equal(readDelivererTab({ modifier: '1', onglet: 'ensemble' }, tabs), 'identification');
    assert.equal(readDelivererTab({ onglet: 'inconnue' }, tabs), tabs[0].key);
    for (const key of ['tourneeRecherche', 'tourneeDate', 'tourneePage']) {
      assert.equal(readDelivererTab({ [key]: '' }, tabs), canReadTours ? 'tournees' : tabs[0].key);
    }
    assert.equal(readDelivererTab({ onglet: 'identification', tourneePage: '2' }, tabs), 'identification');
  }
});

test('les retours de tournée conservent chaque onglet, les filtres et la liste validée', () => {
  for (const tab of ['ensemble', 'objectifs', 'tournees', 'identification']) {
    const href = buildDelivererToursHref({ delivererId: id, tab, query: 'TRN ABC', plannedDate: '2026-09-14', page: 3, returnHref: '/livreurs?q=Atlas&statut=all&page=2' });
    assert.equal(validateTourReturnHref(href, id), href);
    const url = new URL(href, 'http://syphax.local');
    assert.equal(url.searchParams.get('onglet'), tab);
    assert.equal(url.searchParams.get('tourneePage'), '3');
    assert.equal(url.searchParams.get('retour'), '/livreurs?q=Atlas&statut=all&page=2');
  }
});

test('l’onglet objectifs suit sa permission et conserve les filtres dans les retours', () => {
  assert.deepEqual(getDelivererTabs({ canReadObjectives: true }), [{ key: 'objectifs', label: 'Objectifs' }, { key: 'identification', label: 'Identification' }]);
  assert.equal(readDelivererTab({ onglet: 'objectifs' }, getDelivererTabs({})), 'identification');
  const href = buildDelivererToursHref({ delivererId: id, tab: 'objectifs', objectiveQuery: 'yahia', objectiveMonth: '2026-10', objectivePage: 2 });
  assert.equal(validateTourReturnHref(href, id), href);
  assert.equal(new URL(href, 'http://syphax.local').searchParams.get('objectifPage'), '2');
});

test('les retours restent fermés aux destinations et paramètres arbitraires', () => {
  const fallback = buildDelivererToursHref({ delivererId: id });
  for (const value of [
    'https://example.com', '//example.com/livreurs', '/produits',
    '/livreurs/ffffffffffffffffffffffff?onglet=ensemble',
    `/livreurs/${id}?onglet=autre`, `/livreurs/${id}?modifier=1`,
    `/livreurs/${id}?onglet=ensemble&onglet=tournees`,
    `/livreurs/${id}?tourneePage=2&tourneePage=3`,
  ]) assert.equal(validateTourReturnHref(value, id), fallback);
  assert.equal(new URL(validateTourReturnHref(`/livreurs/${id}?onglet=ensemble&retour=https%3A%2F%2Fexample.com`, id), 'http://syphax.local').searchParams.get('retour'), '/livreurs');
});

test('les retours conservent le mois consulté et les deux historiques indépendants', () => {
  const href = buildDelivererToursHref({
    delivererId: id, tab: 'objectifs', achievementMonth: '2025-12',
    historyYear: '2025', historyStatus: 'missed', historyQuery: 'décembre', historyPage: 2,
    objectiveMonth: '2026-10', objectiveQuery: 'yahia', objectivePage: 3,
    returnHref: '/livreurs?q=Atlas&statut=all&page=2',
  });
  assert.equal(validateTourReturnHref(href, id), href);
  const url = new URL(href, 'http://syphax.local');
  assert.equal(url.searchParams.get('bilanMois'), '2025-12');
  assert.equal(url.searchParams.get('bilanAnnee'), '2025');
  assert.equal(url.searchParams.get('bilanStatut'), 'missed');
  assert.equal(url.searchParams.get('bilanPage'), '2');
  assert.equal(url.searchParams.get('objectifPage'), '3');
  const fallback = buildDelivererToursHref({ delivererId: id });
  assert.equal(validateTourReturnHref(`/livreurs/${id}?bilanMois=2025-12&bilanMois=2026-09`, id), fallback);
});
