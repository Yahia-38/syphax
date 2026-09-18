import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDayTourHref,
  formatDayRecapShortDate,
  isDayRecapHref,
  readDayRecapHrefDate,
  validateDayRecapHref,
} from '../lib/day-recap-navigation.js';
import { buildDelivererToursHref, describeTourReturn, validateTourReturnHref } from '../lib/tours.js';

const delivererId = '6aa73924f609544f68c37666';
const tourId = '6aa87bf1a6c1118e767192f0';

test('seule la racine est reconnue comme un récap', () => {
  assert.equal(isDayRecapHref('/'), true);
  assert.equal(isDayRecapHref('/?jour=2026-09-17&jourPage=2'), true);
  for (const value of ['/caisse', `/livreurs/${delivererId}`, '//example.com/', 'https://example.com/', '', null]) {
    assert.equal(isDayRecapHref(value), false);
  }
});

test('le lien d’une tournée ramène au jour, au filtre, à la recherche et à la page', () => {
  const returnHref = '/?jour=2026-09-16&jourEtat=impayes&jourRecherche=brahim&jourPage=3';
  const href = new URL(buildDayTourHref({ returnHref, tourId }), 'https://syphax.invalid');
  assert.equal(href.pathname, `/tournees/${tourId}`);
  assert.equal(href.searchParams.get('retour'), returnHref);
});

test('un retour étranger au récap est ramené au tableau de bord', () => {
  for (const returnHref of ['/caisse?jour=2026-09-16', '//example.com/', '/?retour=https://example.com', '/?jour=2026-02-30']) {
    const href = new URL(buildDayTourHref({ returnHref, tourId }), 'https://syphax.invalid');
    assert.equal(href.searchParams.get('retour'), '/');
  }
  assert.equal(validateDayRecapHref('/?jourEtat=inventé'), '/');
});

test('la fiche tournée accepte le récap sans ouvrir les autres destinations', () => {
  const returnHref = '/?jour=2026-09-16&jourPage=2';
  assert.equal(validateTourReturnHref(returnHref, delivererId), returnHref);
  assert.equal(validateTourReturnHref('/', delivererId), '/');
  assert.equal(validateTourReturnHref('/caisse', delivererId), buildDelivererToursHref({ delivererId }));
  assert.equal(validateTourReturnHref('//example.com/', delivererId), buildDelivererToursHref({ delivererId }));
  const fiche = buildDelivererToursHref({ delivererId, section: 'tournees' });
  assert.equal(validateTourReturnHref(fiche, delivererId), fiche);
});

test('le lien de retour annonce sa destination', () => {
  assert.equal(describeTourReturn('/?jour=2026-09-17').label, '← Retour au récap du 17/09');
  assert.equal(describeTourReturn('/?jour=2026-09-17').target, 'dayRecap');
  assert.equal(describeTourReturn('/').label, '← Retour au récap');
  assert.equal(describeTourReturn(`/livreurs/${delivererId}`).label, '← Retour à la fiche livreur');
  assert.equal(describeTourReturn(`/livreurs/${delivererId}`).target, 'deliverer');
  assert.equal(formatDayRecapShortDate('2026-01-05'), '05/01');
  assert.equal(formatDayRecapShortDate('2026-02-30'), '');
  assert.equal(readDayRecapHrefDate('/?jour=2026-09-16&jourPage=2'), '2026-09-16');
  assert.equal(readDayRecapHrefDate('/caisse?jour=2026-09-16'), '');
});
