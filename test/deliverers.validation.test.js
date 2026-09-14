import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readDelivererListState,
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
  });
  assert.deepEqual(readDelivererListState({
    q: ['première', 'seconde'],
    page: ['invalide', '3'],
  }), {
    page: 1,
    query: 'première',
  });
  assert.deepEqual(readDelivererListState({ page: '-1' }), {
    page: 1,
    query: '',
  });
});
