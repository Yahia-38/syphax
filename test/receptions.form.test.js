import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateReceptionLine,
  changeReceptionLineProduct,
  createEmptyReceptionLine,
  getMissingReceptionFormPermissions,
  RECEPTION_FORM_PERMISSIONS,
  validateReceptionDraft,
  validateReceptionLine,
} from '../lib/receptions.js';

const product = {
  id: 'product-bottles',
  baseUnit: 'BOUTEILLE',
  code: 'EAU-1L',
  designation: 'Eau 1 L',
  packagings: [
    { id: 'pack-6', label: 'Pack de 6', quantity: 6 },
    { id: 'carton-24', label: 'Carton de 24', quantity: 24 },
  ],
};

test('calcule une quantité saisie directement dans l’unité de base', () => {
  const calculation = calculateReceptionLine({
    ...createEmptyReceptionLine('line-1'),
    directQuantity: '60',
    productId: product.id,
  }, product);

  assert.equal(calculation.quantityInBaseUnits, 60);
});

test('convertit dix packs de six sans rendre la quantité calculée indépendante', () => {
  const calculation = calculateReceptionLine({
    ...createEmptyReceptionLine('line-1'),
    packagingCount: '10',
    packagingId: 'pack-6',
    productId: product.id,
    quantityMode: 'PACKAGING',
  }, product);

  assert.equal(calculation.quantityInBaseUnits, 60);
});

test('réinitialise les données dépendantes lors du changement de produit', () => {
  const changedLine = changeReceptionLineProduct({
    ...createEmptyReceptionLine('line-1'),
    packagingCount: '10',
    packagingId: 'pack-6',
    productId: product.id,
    productQuery: 'eau',
    quantityMode: 'PACKAGING',
  }, 'another-product');

  assert.deepEqual(changedLine, {
    ...createEmptyReceptionLine('line-1'),
    productId: 'another-product',
  });
});

test('valide une ligne avant sa transformation en récapitulatif', () => {
  const emptyLine = createEmptyReceptionLine('line-1');
  const validLine = {
    ...emptyLine,
    packagingCount: '10',
    packagingId: 'pack-6',
    productId: product.id,
    quantityMode: 'PACKAGING',
  };

  assert.deepEqual(validateReceptionLine(emptyLine, null), {
    errors: { product: 'Sélectionnez un produit du catalogue.' },
  });
  assert.deepEqual(validateReceptionLine(validLine, product), {
    data: { quantityInBaseUnits: 60 },
  });
});

test('refuse de valider une ligne dont la quantité est incomplète', () => {
  const directLine = {
    ...createEmptyReceptionLine('line-1'),
    productId: product.id,
  };
  const packagingLine = {
    ...directLine,
    quantityMode: 'PACKAGING',
  };

  assert.deepEqual(validateReceptionLine(directLine, product), {
    errors: { directQuantity: 'Saisissez une quantité entière positive.' },
  });
  assert.deepEqual(validateReceptionLine(packagingLine, product), {
    errors: {
      packaging: 'Sélectionnez un conditionnement du produit.',
      packagingCount: 'Saisissez un nombre entier positif.',
    },
  });
});

test('valide la réception uniquement avec une ligne récapitulative terminée', () => {
  assert.deepEqual(validateReceptionDraft({
    hasLineDraft: true,
    lineCount: 1,
  }), {
    error: 'Validez ou annulez la ligne en cours avant de valider la réception.',
  });
  assert.deepEqual(validateReceptionDraft({
    hasLineDraft: false,
    lineCount: 0,
  }), {
    error: 'Ajoutez et validez au moins une ligne de réception.',
  });
  assert.deepEqual(validateReceptionDraft({
    hasLineDraft: false,
    lineCount: 1,
  }), { valid: true });
});

test('refuse l’accès au formulaire dès qu’un droit nécessaire manque', () => {
  assert.deepEqual(
    getMissingReceptionFormPermissions(RECEPTION_FORM_PERMISSIONS),
    [],
  );

  for (const permission of RECEPTION_FORM_PERMISSIONS) {
    const grantedPermissions = RECEPTION_FORM_PERMISSIONS.filter(
      (candidate) => candidate !== permission,
    );

    assert.deepEqual(
      getMissingReceptionFormPermissions(grantedPermissions),
      [permission],
    );
  }
});
