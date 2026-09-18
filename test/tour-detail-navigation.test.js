import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTourTabHref, readTourTab } from '../lib/tour-detail-navigation.js';
import { validateTourReturnHref } from '../lib/tours.js';

const tourId = '6aa87bf1a6c1118e767192f0';
const delivererId = '6aa73924f609544f68c37666';

test('l’onglet respecte la liste blanche et l’état de préparation', () => {
  assert.equal(readTourTab(undefined, 'PREPARATION'), 'produits');
  for (const status of ['LOADED', 'COUNTED', 'CLOSED', 'CANCELLED']) assert.equal(readTourTab(undefined, status), 'operations');
  assert.equal(readTourTab('historique', 'PREPARATION'), 'historique');
  assert.equal(readTourTab(['produits'], 'LOADED'), 'produits');
  assert.equal(readTourTab(['produits', 'historique'], 'LOADED'), 'operations');
  assert.equal(readTourTab('inconnue', 'LOADED'), 'operations');
});

test('les trois onglets conservent le retour imbriqué et les filtres livreur', () => {
  const listHref = '/livreurs?q=amine&page=2';
  const params = new URLSearchParams({ retour: listHref, onglet: 'tournees', tourneeRecherche: 'TRN', tourneeDate: '2026-09-16', tourneePage: '2' });
  const returnHref = validateTourReturnHref(`/livreurs/${delivererId}?${params}`, delivererId);
  for (const tab of ['operations', 'produits', 'historique']) {
    const href = new URL(buildTourTabHref({ tourId, returnHref, tab }), 'http://syphax.local');
    assert.equal(href.pathname, `/tournees/${tourId}`);
    assert.equal(href.searchParams.get('onglet'), tab);
    assert.equal(href.searchParams.get('retour'), returnHref);
    const back = new URL(href.searchParams.get('retour'), 'http://syphax.local');
    assert.equal(back.searchParams.get('onglet'), 'tournees');
    assert.equal(back.searchParams.get('tourneePage'), '2');
    assert.equal(back.searchParams.get('retour'), listHref);
  }
});

test('le retour fourni par l’utilisateur préserve exactement ses deux niveaux', () => {
  const back = `/livreurs/${delivererId}?retour=%2Flivreurs&onglet=tournees`;
  const validated = validateTourReturnHref(back, delivererId);
  const url = new URL(buildTourTabHref({ tourId, returnHref: validated, tab: 'operations' }), 'http://syphax.local');
  const deliverer = new URL(url.searchParams.get('retour'), 'http://syphax.local');
  assert.equal(deliverer.pathname, `/livreurs/${delivererId}`);
  assert.equal(deliverer.searchParams.get('onglet'), 'tournees');
  assert.equal(deliverer.searchParams.get('retour'), '/livreurs');
});
