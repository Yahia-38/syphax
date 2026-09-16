import assert from 'node:assert/strict';
import test from 'node:test';

import { getDelivererSections, readDelivererSection } from '../lib/deliverer-detail-navigation.js';
import { buildDelivererToursHref, validateTourReturnHref } from '../lib/tours.js';

const id = '0123456789abcdef01234567';

test('sections et choix initial suivent les lectures indépendantes', () => {
  for (const canReadCash of [false, true]) for (const canReadCreditLimit of [false, true]) for (const canReadTours of [false, true]) {
    const sections = getDelivererSections({ canReadCash, canReadCreditLimit, canReadTours });
    assert.equal(sections.some(([key]) => key === 'ensemble'), canReadCash || canReadCreditLimit);
    assert.equal(sections.some(([key]) => key === 'tournees'), canReadTours);
    assert.equal(readDelivererSection({}, sections), canReadCash || canReadCreditLimit ? 'ensemble' : canReadTours ? 'tournees' : 'identification');
    assert.equal(readDelivererSection({ modifier: '1', section: 'ensemble' }, sections), 'identification');
    assert.equal(readDelivererSection({ section: 'inconnue' }, sections), sections[0][0]);
    for (const key of ['tourneeRecherche', 'tourneeDate', 'tourneePage']) {
      assert.equal(readDelivererSection({ [key]: '' }, sections), canReadTours ? 'tournees' : sections[0][0]);
    }
    assert.equal(readDelivererSection({ section: 'identification', tourneePage: '2' }, sections), 'identification');
  }
});

test('les retours de tournée conservent chaque section, les filtres et la liste validée', () => {
  for (const section of ['ensemble', 'tournees', 'identification']) {
    const href = buildDelivererToursHref({ delivererId: id, section, query: 'TRN ABC', plannedDate: '2026-09-14', page: 3, returnHref: '/livreurs?q=Atlas&statut=all&page=2' });
    assert.equal(validateTourReturnHref(href, id), href);
    const url = new URL(href, 'http://syphax.local');
    assert.equal(url.searchParams.get('section'), section);
    assert.equal(url.searchParams.get('tourneePage'), '3');
    assert.equal(url.searchParams.get('retour'), '/livreurs?q=Atlas&statut=all&page=2');
  }
});

test('les retours restent fermés aux destinations et paramètres arbitraires', () => {
  const fallback = buildDelivererToursHref({ delivererId: id });
  for (const value of [
    'https://example.com', '//example.com/livreurs', '/produits',
    '/livreurs/ffffffffffffffffffffffff?section=ensemble',
    `/livreurs/${id}?section=autre`, `/livreurs/${id}?modifier=1`,
    `/livreurs/${id}?section=ensemble&section=tournees`,
    `/livreurs/${id}?tourneePage=2&tourneePage=3`,
  ]) assert.equal(validateTourReturnHref(value, id), fallback);
  assert.equal(new URL(validateTourReturnHref(`/livreurs/${id}?section=ensemble&retour=https%3A%2F%2Fexample.com`, id), 'http://syphax.local').searchParams.get('retour'), '/livreurs');
});
