import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDelivererListHref,
  formatDelivererCreatedAt,
  readDelivererListState,
  validateDelivererListHref,
  validateDeliverer,
} from '../lib/deliverers.js';

test('normalise les informations du livreur', () => {
  assert.deepEqual(validateDeliverer({
    code: '  liv-é01  ',
    name: '  Amine Benali  ',
    phone: '  0550 00 00 00  ',
  }), {
    data: {
      code: 'LIV-É01',
      name: 'Amine Benali',
      phone: '0550 00 00 00',
    },
  });
});

test('exige le code et le nom mais accepte un téléphone vide', () => {
  assert.deepEqual(validateDeliverer({
    code: 'LIV-001',
    name: 'Livreur minimal',
    phone: '',
  }), {
    data: {
      code: 'LIV-001',
      name: 'Livreur minimal',
      phone: '',
    },
  });

  const result = validateDeliverer({ code: '   ', name: '   ' });

  assert.equal(result.errors.code, 'Le code est obligatoire.');
  assert.equal(result.errors.name, 'Le nom du livreur est obligatoire.');
  assert.equal(result.errors.phone, undefined);
});

test('refuse un code avec espaces et les champs trop longs', () => {
  assert.equal(
    validateDeliverer({ code: 'LIV 001', name: 'Livreur' }).errors.code,
    'Le code ne doit contenir aucun espace intérieur.',
  );

  const result = validateDeliverer({
    code: 'A'.repeat(51),
    name: 'B'.repeat(151),
    phone: '0'.repeat(31),
  });

  assert.deepEqual(Object.keys(result.errors).sort(), ['code', 'name', 'phone']);
});

test('normalise la recherche et la page demandées', () => {
  assert.deepEqual(readDelivererListState({
    q: '  Livreur nord  ',
    page: '2',
  }), {
    page: 2,
    query: 'Livreur nord',
    status: 'active',
  });
  assert.deepEqual(readDelivererListState({
    q: ['première', 'seconde'],
    page: ['invalide', '3'],
  }), {
    page: 1,
    query: 'première',
    status: 'active',
  });
  assert.deepEqual(readDelivererListState({ page: '-1' }), {
    page: 1,
    query: '',
    status: 'active',
  });
});

test('conserve la recherche et la pagination dans le retour à la liste', () => {
  const href = buildDelivererListHref({
    page: 3,
    query: ' Livreur nord ',
  });

  assert.equal(href, '/livreurs?q=Livreur+nord&page=3');
  assert.equal(validateDelivererListHref(href), href);
  assert.equal(buildDelivererListHref(), '/livreurs');
});

test('refuse une destination de retour externe ou étrangère à la liste', () => {
  assert.equal(
    validateDelivererListHref('https://example.com/livreurs'),
    '/livreurs',
  );
  assert.equal(validateDelivererListHref('//example.com/livreurs'), '/livreurs');
  assert.equal(validateDelivererListHref('/produits'), '/livreurs');
  assert.equal(
    validateDelivererListHref('/livreurs?destination=/administration'),
    '/livreurs',
  );
  assert.equal(validateDelivererListHref(), '/livreurs');
  assert.equal(validateDelivererListHref('/livreurs?q=Atlas#fiche'), '/livreurs');
  assert.equal(validateDelivererListHref('/livreurs?statut=disabled&page=3&q=Atlas'), '/livreurs?q=Atlas&statut=disabled&page=3');
});

test('compte les points de code après normalisation et conserve les préfixes téléphoniques', () => {
  const values = { code: '𐐨'.repeat(50), name: '😀'.repeat(150), phone: ' +213 (0) 0550 00 00 00 ' };
  assert.deepEqual(validateDeliverer(values), { data: {
    code: '𐐀'.repeat(50), name: values.name, phone: '+213 (0) 0550 00 00 00',
  } });
  assert.equal(validateDeliverer({ ...values, code: 'ß'.repeat(26) }).errors.code, 'Le code ne doit pas dépasser 50 caractères.');
  assert.equal(validateDeliverer({ ...values, phone: '😀'.repeat(30) }).data.phone, '😀'.repeat(30));
  assert.ok(validateDeliverer({ ...values, name: '😀'.repeat(151), phone: '😀'.repeat(31) }).errors.name);
});

test('formate la date de création dans le fuseau d’Alger', () => {
  assert.match(
    formatDelivererCreatedAt('2026-09-12T23:30:00.000Z'),
    /13 septembre 2026.*00:30/u,
  );
  assert.equal(formatDelivererCreatedAt(null), 'Non renseignée');
});

test('préserve le mois et la réalisation dans les retours du répertoire', () => {
  const state = readDelivererListState({ q: ' Atlas ', statut: 'all', page: '2', mois: '2025-12', realisation: 'reached' });
  assert.deepEqual(state, { query: 'Atlas', status: 'all', page: 2, month: '2025-12', achievementStatus: 'reached' });
  const href = buildDelivererListHref(state);
  assert.equal(validateDelivererListHref(href), href);
  assert.equal(new URL(href, 'https://syphax.invalid').searchParams.get('mois'), '2025-12');
  assert.equal(new URL(href, 'https://syphax.invalid').searchParams.get('realisation'), 'reached');
  assert.equal(readDelivererListState({ mois: '2026-13', realisation: 'toString' }).achievementStatus, '');
  assert.equal(validateDelivererListHref('/livreurs?mois=2025-12&mois=2026-09'), '/livreurs');
});
