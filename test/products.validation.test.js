import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASE_UNITS,
  validateProduct,
  validateProductPackaging,
} from '../lib/products.js';

test('normalise le code et la désignation', () => {
  const result = validateProduct({
    code: '  prod-é01  ',
    designation: '  Huile végétale 1 L  ',
    baseUnit: 'BOUTEILLE',
  });

  assert.deepEqual(result, {
    data: {
      code: 'PROD-É01',
      designation: 'Huile végétale 1 L',
      baseUnit: 'BOUTEILLE',
    },
  });
});

test('refuse les champs obligatoires vides', () => {
  const result = validateProduct({
    code: '   ',
    designation: '   ',
    baseUnit: '',
  });

  assert.deepEqual(result.errors, {
    code: 'Le code est obligatoire.',
    designation: 'La désignation est obligatoire.',
    baseUnit: 'Sélectionnez une unité de base valide.',
  });
});

test('refuse les espaces intérieurs dans le code', () => {
  const result = validateProduct({
    code: 'PROD 001',
    designation: 'Produit',
    baseUnit: 'PIECE',
  });

  assert.equal(
    result.errors.code,
    'Le code ne doit contenir aucun espace intérieur.',
  );
});

test('applique les limites après normalisation', () => {
  const valid = validateProduct({
    code: `  ${'A'.repeat(50)}  `,
    designation: `  ${'É'.repeat(150)}  `,
    baseUnit: 'PIECE',
  });
  const invalid = validateProduct({
    code: 'A'.repeat(51),
    designation: 'É'.repeat(151),
    baseUnit: 'PIECE',
  });

  assert.ok(valid.data);
  assert.equal(
    invalid.errors.code,
    'Le code ne doit pas dépasser 50 caractères.',
  );
  assert.equal(
    invalid.errors.designation,
    'La désignation ne doit pas dépasser 150 caractères.',
  );
});

test('accepte uniquement les quatre codes d’unité stables', () => {
  assert.deepEqual(BASE_UNITS, [
    { code: 'PIECE', label: 'Pièce' },
    { code: 'BOUTEILLE', label: 'Bouteille' },
    { code: 'BOITE', label: 'Boîte' },
    { code: 'SACHET', label: 'Sachet' },
  ]);

  for (const unit of BASE_UNITS) {
    const result = validateProduct({
      code: `PROD-${unit.code}`,
      designation: 'Produit',
      baseUnit: unit.code,
    });

    assert.ok(result.data);
  }

  const invalid = validateProduct({
    code: 'PROD-CARTON',
    designation: 'Produit',
    baseUnit: 'CARTON',
  });

  assert.equal(
    invalid.errors.baseUnit,
    'Sélectionnez une unité de base valide.',
  );
});

test('valide et normalise un conditionnement supplémentaire', () => {
  assert.deepEqual(
    validateProductPackaging({ label: '  Pack de 6  ', quantity: ' 6 ' }),
    { data: { label: 'Pack de 6', quantity: 6 } },
  );
  assert.deepEqual(
    validateProductPackaging({ label: ' ', quantity: '1.5' }).errors,
    {
      label: 'Le libellé est obligatoire.',
      quantity: 'Saisissez une quantité entière supérieure ou égale à 2.',
    },
  );
});
