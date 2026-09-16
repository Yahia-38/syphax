import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateReceptionLine,
  changeReceptionLineProduct,
  createEmptyReceptionLine,
  formatReceptionDateInput,
  getMissingReceptionFormPermissions,
  getReceptionPackagings,
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
    { id: 'pack-6', label: 'Pack de 6', quantity: 6, usage: 'BOTH' },
    { id: 'carton-24', label: 'Carton de 24', quantity: 24, usage: 'RECEPTION' },
    { id: 'sale-pack', label: 'Pack vente', quantity: 6, usage: 'SALE' },
    { id: 'legacy-palette', label: 'Palette ancienne', quantity: 240 },
  ],
};

test('préremplit la date du jour dans le fuseau d’Alger', () => {
  assert.equal(
    formatReceptionDateInput(new Date('2026-09-12T23:30:00.000Z')),
    '2026-09-13',
  );
});

test('calcule une quantité saisie directement dans l’unité de base', () => {
  const calculation = calculateReceptionLine({
    ...createEmptyReceptionLine('line-1'),
    amount: '120',
    directQuantity: '60',
    productId: product.id,
  }, product);

  assert.deepEqual(calculation, {
    amountInCentimes: 12_000,
    quantityInBaseUnits: 60,
  });
});

test('convertit dix packs de six sans rendre la quantité calculée indépendante', () => {
  const calculation = calculateReceptionLine({
    ...createEmptyReceptionLine('line-1'),
    amount: '120,50',
    packagingCount: '10',
    packagingId: 'pack-6',
    productId: product.id,
    quantityMode: 'PACKAGING',
  }, product);

  assert.deepEqual(calculation, {
    amountInCentimes: 12_050,
    quantityInBaseUnits: 60,
  });
});

test('offre uniquement les conditionnements explicitement activés pour réception', () => {
  assert.deepEqual(getReceptionPackagings(product).map(({ id }) => id), ['pack-6', 'carton-24']);
  assert.deepEqual(getReceptionPackagings(null), []);
  assert.deepEqual(getReceptionPackagings({ packagings: [] }), []);
  assert.deepEqual(getReceptionPackagings({ packagings: product.packagings.slice(2) }), []);
});

test('refuse les usages vente, absents ou invalides sans calculer de conversion', () => {
  const line = {
    ...createEmptyReceptionLine('line-1'), productId: product.id, amount: '120',
    quantityMode: 'PACKAGING', packagingId: 'restricted', packagingCount: '10',
  };
  for (const usage of ['SALE', undefined, null, '', 'ALL']) {
    const restricted = { ...product, packagings: [{ id: 'restricted', quantity: 6, usage }] };
    assert.equal(calculateReceptionLine(line, restricted).quantityInBaseUnits, null);
    assert.deepEqual(validateReceptionLine(line, restricted).errors, {
      packaging: 'Ce conditionnement n’est pas activé pour la réception.',
    });
    assert.equal(validateReceptionLine({ ...line, quantityMode: 'DIRECT', directQuantity: '60' }, restricted).data.quantityInBaseUnits, 60);
  }
});

test('convertit réception et usage mixte dans chacune des unités de stock existantes', () => {
  for (const baseUnit of ['BOUTEILLE', 'PIECE', 'BOITE', 'SACHET']) {
    for (const usage of ['RECEPTION', 'BOTH']) {
      const receptionProduct = { ...product, baseUnit, packagings: [{ id: 'palette', quantity: 240, usage }] };
      const line = { ...createEmptyReceptionLine('line-1'), amount: '120',
        quantityMode: 'PACKAGING', packagingId: 'palette', packagingCount: '3' };
      assert.equal(validateReceptionLine(line, receptionProduct).data.quantityInBaseUnits, 720);
      assert.equal(calculateReceptionLine({ ...line, packagingCount: String(Number.MAX_SAFE_INTEGER) }, receptionProduct).quantityInBaseUnits, null);
    }
  }
});

test('réinitialise les données dépendantes lors du changement de produit', () => {
  const changedLine = changeReceptionLineProduct({
    ...createEmptyReceptionLine('line-1'),
    amount: '120',
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
    amount: '120',
    packagingCount: '10',
    packagingId: 'pack-6',
    productId: product.id,
    quantityMode: 'PACKAGING',
  };

  assert.deepEqual(validateReceptionLine(emptyLine, null), {
    errors: {
      amount: 'Saisissez un montant TTC positif ou nul avec deux décimales maximum.',
      product: 'Sélectionnez un produit du catalogue.',
    },
  });
  assert.deepEqual(validateReceptionLine(validLine, product), {
    data: {
      amountInCentimes: 12_000,
      quantityInBaseUnits: 60,
    },
  });
});

test('valide le montant TTC en centimes sans confondre zéro et absence', () => {
  const validLine = {
    ...createEmptyReceptionLine('line-1'),
    amount: '0',
    directQuantity: '5',
    productId: product.id,
  };

  assert.deepEqual(validateReceptionLine(validLine, product), {
    data: {
      amountInCentimes: 0,
      quantityInBaseUnits: 5,
    },
  });

  for (const amount of ['', '-1', '12,345', 'montant']) {
    assert.equal(
      validateReceptionLine({ ...validLine, amount }, product).errors.amount,
      'Saisissez un montant TTC positif ou nul avec deux décimales maximum.',
    );
  }
});

test('refuse de valider une ligne dont la quantité est incomplète', () => {
  const directLine = {
    ...createEmptyReceptionLine('line-1'),
    amount: '25',
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
