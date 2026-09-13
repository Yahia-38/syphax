import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSupplier } from '../lib/suppliers.js';

test('normalise les informations du fournisseur', () => {
  assert.deepEqual(validateSupplier({
    name: '  Distribution Atlas  ',
    contactName: '  Amine Benali  ',
    phone: '  0550 00 00 00  ',
    email: '  CONTACT@ATLAS.DZ  ',
    address: '  Alger  ',
  }), {
    data: {
      name: 'Distribution Atlas',
      contactName: 'Amine Benali',
      phone: '0550 00 00 00',
      email: 'contact@atlas.dz',
      address: 'Alger',
    },
  });
});

test('exige uniquement le nom du fournisseur', () => {
  assert.deepEqual(validateSupplier({
    name: 'Fournisseur minimal',
    contactName: '',
    phone: '',
    email: '',
    address: '',
  }), {
    data: {
      name: 'Fournisseur minimal',
      contactName: '',
      phone: '',
      email: '',
      address: '',
    },
  });

  assert.equal(
    validateSupplier({ name: '   ' }).errors.name,
    'Le nom du fournisseur est obligatoire.',
  );
});

test('refuse une adresse e-mail invalide et les champs trop longs', () => {
  const result = validateSupplier({
    name: 'A'.repeat(151),
    contactName: 'B'.repeat(151),
    phone: '0'.repeat(31),
    email: 'adresse-invalide',
    address: 'C'.repeat(501),
  });

  assert.deepEqual(Object.keys(result.errors).sort(), [
    'address',
    'contactName',
    'email',
    'name',
    'phone',
  ]);
});
