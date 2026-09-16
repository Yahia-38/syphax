import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { Collection, ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_pa_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { workAsyncStorage } = await import(
  'next/dist/server/app-render/work-async-storage.external.js'
);
const { workUnitAsyncStorage } = await import(
  'next/dist/server/app-render/work-unit-async-storage.external.js'
);
const { RequestCookies } = await import(
  'next/dist/server/web/spec-extension/cookies.js'
);
const { PermissionDeniedError } = await import('../lib/access.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const { requirePermission } = await import('../lib/sessions.js');
const { createProduct } = await import(
  '../app/(protected)/produits/nouveau/actions.js'
);
const { deleteProduct } = await import(
  '../app/(protected)/produits/delete-actions.js'
);
const { updateProduct } = await import(
  '../app/(protected)/produits/[id]/product-actions.js'
);
const { addProductPackaging, removePackagingAction } = await import(
  '../app/(protected)/produits/[id]/packaging-actions.js'
);
const { updateProductSalePrice } = await import(
  '../app/(protected)/produits/[id]/pricing-actions.js'
);

let database;

before(async () => {
  database = await getDatabase();
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

const createUserSession = async (username, permissions = []) => {
  const userId = new ObjectId();
  const roleId = new ObjectId();
  const token = randomBytes(32).toString('base64url');

  await Promise.all([
    database.collection('users').insertOne({
      _id: userId,
      username,
      active: true,
      roleIds: permissions.length > 0 ? [roleId] : [],
    }),
    ...(permissions.length > 0
      ? [database.collection('roles').insertOne({
          _id: roleId,
          permissions,
        })]
      : []),
    database.collection('sessions').insertOne({
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }),
  ]);

  return { token, userId };
};

const callWithSession = async (token, callback) => {
  const cookies = new RequestCookies(new Headers({
    cookie: `syphax-session=${token}`,
  }));
  const requestStore = {
    type: 'request',
    phase: 'action',
    cookies,
    userspaceMutableCookies: cookies,
  };
  const workStore = {
    incrementalCache: {},
    route: '/produits',
  };

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, callback));
};

const isPermissionDenied = (permission) => (error) =>
  error instanceof PermissionDeniedError
  && error.code === 'FORBIDDEN'
  && error.permission === permission;

test('refuse la consultation des produits sans products.read', async () => {
  const { token } = await createUserSession('sans-consultation-produit');

  await assert.rejects(
    callWithSession(token, () => requirePermission('products.read')),
    isPermissionDenied('products.read'),
  );
});

test('distingue la lecture des produits de celle des tarifs', async () => {
  const { token } = await createUserSession(
    'lecture-produit-sans-lecture-tarif',
    ['products.read'],
  );

  const session = await callWithSession(token, () =>
    requirePermission('products.read'));
  assert.equal(session.username, 'lecture-produit-sans-lecture-tarif');
  await assert.rejects(
    callWithSession(token, () => requirePermission('pricing.read')),
    isPermissionDenied('pricing.read'),
  );
});

test('refuse un appel direct de la création sans products.create', async () => {
  const { token } = await createUserSession('sans-creation-produit');
  const formData = new FormData();

  formData.set('code', 'INTERDIT-CREATION');
  formData.set('designation', 'Création interdite');
  formData.set('baseUnit', 'PIECE');

  await assert.rejects(
    callWithSession(token, () =>
      createProduct({ revision: 0 }, formData)),
    isPermissionDenied('products.create'),
  );
  assert.equal(
    await database.collection('products').countDocuments({
      code: 'INTERDIT-CREATION',
    }),
    0,
  );
});

test('refuse un appel direct de la modification sans products.update', async () => {
  const { token, userId } = await createUserSession(
    'sans-modification-produit',
  );
  const productId = new ObjectId();

  await database.collection('products').insertOne({
    _id: productId,
    code: 'PROTEGE-01',
    designation: 'Produit protégé',
    baseUnit: 'PIECE',
    createdAt: new Date(),
    createdBy: userId,
  });

  const formData = new FormData();
  formData.set('code', 'PROTEGE-02');
  formData.set('designation', 'Modification interdite');
  formData.set('baseUnit', 'BOITE');

  await assert.rejects(
    callWithSession(token, () =>
      updateProduct(productId.toString(), { revision: 0 }, formData)),
    isPermissionDenied('products.update'),
  );

  const unchangedProduct = await database.collection('products').findOne({
    _id: productId,
  });

  assert.equal(unchangedProduct.code, 'PROTEGE-01');
  assert.equal(unchangedProduct.designation, 'Produit protégé');
  assert.equal(unchangedProduct.baseUnit, 'PIECE');
  assert.equal(unchangedProduct.updatedAt, undefined);
  assert.equal(unchangedProduct.updatedBy, undefined);
});

test('refuse un appel direct de la suppression sans products.delete', async () => {
  const { token, userId } = await createUserSession('sans-suppression-produit');
  const productId = new ObjectId();

  await database.collection('products').insertOne({
    _id: productId,
    code: 'INTERDIT-SUPPRESSION',
    designation: 'Suppression interdite',
    baseUnit: 'PIECE',
    createdAt: new Date(),
    createdBy: userId,
  });

  await assert.rejects(
    callWithSession(token, () => deleteProduct(productId.toString())),
    isPermissionDenied('products.delete'),
  );
  assert.ok(await database.collection('products').findOne({ _id: productId }));
});

test('protège la modification du prix et conserve son auteur', async () => {
  const productId = new ObjectId();
  const { token: deniedToken } = await createUserSession(
    'lecture-tarif-sans-modification',
    ['products.read', 'pricing.read'],
  );
  const { token: allowedToken, userId: allowedUserId } = await createUserSession(
    'modification-tarif-autorisee',
    ['products.read', 'pricing.read', 'pricing.update'],
  );

  await database.collection('products').insertOne({
    _id: productId,
    code: 'TARIF-PROTEGE',
    designation: 'Produit avec tarif protégé',
    baseUnit: 'PIECE',
    createdAt: new Date(),
    createdBy: allowedUserId,
  });

  const deniedFormData = new FormData();
  deniedFormData.set('price', '125');

  await assert.rejects(
    callWithSession(deniedToken, () =>
      updateProductSalePrice(
        productId.toString(),
        { revision: 0 },
        deniedFormData,
      )),
    isPermissionDenied('pricing.update'),
  );

  const productAfterRefusal = await database.collection('products').findOne({
    _id: productId,
  });
  assert.equal(productAfterRefusal.salePrice, undefined);
  assert.equal(productAfterRefusal.salePriceHistory, undefined);

  const allowedFormData = new FormData();
  allowedFormData.set('price', '175,50');

  const result = await callWithSession(allowedToken, () =>
    updateProductSalePrice(
      productId.toString(),
      { revision: 0 },
      allowedFormData,
    ));
  assert.equal(result.message, 'Le prix de vente a été mis à jour.');

  const productAfterUpdate = await database.collection('products').findOne({
    _id: productId,
  });
  assert.equal(productAfterUpdate.salePrice.amountInCentimes, 17550);
  assert.ok(productAfterUpdate.salePrice.updatedBy.equals(allowedUserId));
  assert.equal(productAfterUpdate.salePriceHistory.length, 1);
  assert.ok(
    productAfterUpdate.salePriceHistory[0].changedBy.equals(allowedUserId),
  );
});

test('protège le tarif de pack avec les permissions de prix et de conditionnement', async () => {
  const productId = new ObjectId();
  const packagingId = new ObjectId();
  const { token, userId } = await createUserSession('tarif-pack-autorise', ['products.read', 'pricing.read', 'pricing.update', 'packaging.read']);
  await database.collection('products').insertOne({
    _id: productId, code: 'TARIF-PACK-PROTEGE', designation: 'Soda', baseUnit: 'BOUTEILLE',
    packagings: [{ _id: packagingId, label: 'Pack de 6', quantity: 6 }],
  });
  const formData = new FormData();
  formData.set('price', '500');
  formData.set('packagingId', packagingId.toString());
  for (const missingPermission of ['pricing.read', 'pricing.update', 'packaging.read']) {
    const denied = await createUserSession(`tarif-pack-sans-${missingPermission}`, ['products.read', 'pricing.read', 'pricing.update', 'packaging.read'].filter((permission) => permission !== missingPermission));
    await assert.rejects(callWithSession(denied.token, () => updateProductSalePrice(productId.toString(), { revision: 0 }, formData)), isPermissionDenied(missingPermission));
  }
  const refused = await database.collection('products').findOne({ _id: productId });
  assert.equal(refused.packagings[0].salePrice, undefined);
  const result = await callWithSession(token, () => updateProductSalePrice(productId.toString(), { revision: 0 }, formData));
  assert.equal(result.message, 'Le prix de vente a été mis à jour.');
  const updated = await database.collection('products').findOne({ _id: productId });
  assert.equal(updated.salePrice, undefined);
  assert.equal(updated.packagings[0].salePrice.amountInCentimes, 50000);
  assert.ok(updated.packagings[0].salePrice.updatedBy.equals(userId));
  const missingFormData = new FormData();
  missingFormData.set('price', '600');
  missingFormData.set('packagingId', new ObjectId().toString());
  const missing = await callWithSession(token, () => updateProductSalePrice(productId.toString(), { revision: 0 }, missingFormData));
  assert.ok(missing.errors.form.includes('conditionnement'));
});

test('protège la création de conditionnement et conserve son auteur', async () => {
  const productId = new ObjectId();
  const { token: deniedToken } = await createUserSession(
    'lecture-produit-sans-creation-conditionnement',
    ['products.read'],
  );
  const { token: allowedToken, userId: allowedUserId } = await createUserSession(
    'creation-conditionnement-autorisee',
    ['products.read', 'packaging.read', 'packaging.create'],
  );

  await database.collection('products').insertOne({
    _id: productId,
    code: 'CONDITIONNEMENT-PROTEGE',
    designation: 'Produit avec conditionnements protégés',
    baseUnit: 'PIECE',
    packagings: [],
    createdAt: new Date(),
    createdBy: allowedUserId,
  });

  const deniedFormData = new FormData();
  deniedFormData.set('label', 'Carton interdit');
  deniedFormData.set('quantity', '12');

  await assert.rejects(
    callWithSession(deniedToken, () =>
      addProductPackaging(
        productId.toString(),
        { revision: 0 },
        deniedFormData,
      )),
    isPermissionDenied('packaging.create'),
  );

  const productAfterRefusal = await database.collection('products').findOne({
    _id: productId,
  });
  assert.deepEqual(productAfterRefusal.packagings, []);

  const allowedFormData = new FormData();
  allowedFormData.set('label', 'Carton autorisé');
  allowedFormData.set('quantity', '24');

  const result = await callWithSession(allowedToken, () =>
    addProductPackaging(
      productId.toString(),
      { revision: 0 },
      allowedFormData,
    ));
  assert.equal(
    result.message,
    'Le conditionnement Carton autorisé a été ajouté.',
  );

  const productAfterAddition = await database.collection('products').findOne({
    _id: productId,
  });
  assert.equal(productAfterAddition.packagings.length, 1);
  assert.equal(productAfterAddition.packagings[0].label, 'Carton autorisé');
  assert.equal(productAfterAddition.packagings[0].quantity, 24);
  assert.ok(productAfterAddition.packagings[0].createdBy.equals(allowedUserId));
});

test('distingue la lecture du produit de celle des conditionnements', async () => {
  const { token } = await createUserSession(
    'lecture-produit-sans-lecture-conditionnement',
    ['products.read'],
  );

  const session = await callWithSession(token, () =>
    requirePermission('products.read'));
  assert.equal(
    session.username,
    'lecture-produit-sans-lecture-conditionnement',
  );
  await assert.rejects(
    callWithSession(token, () => requirePermission('packaging.read')),
    isPermissionDenied('packaging.read'),
  );
});

test('protège la suppression des conditionnements', async () => {
  const productId = new ObjectId();
  const packagingId = new ObjectId();
  const { token: deniedToken } = await createUserSession(
    'lecture-conditionnement-sans-suppression',
    ['products.read', 'packaging.read'],
  );
  const { token: allowedToken, userId: allowedUserId } = await createUserSession(
    'suppression-conditionnement-autorisee',
    ['products.read', 'packaging.read', 'packaging.delete'],
  );

  await database.collection('products').insertOne({
    _id: productId,
    code: 'SUPPRESSION-CONDITIONNEMENT',
    designation: 'Produit avec suppression protégée',
    baseUnit: 'PIECE',
    packagings: [{
      _id: packagingId,
      label: 'Carton à retirer',
      quantity: 12,
      createdAt: new Date(),
      createdBy: allowedUserId,
    }],
    createdAt: new Date(),
    createdBy: allowedUserId,
  });

  await assert.rejects(
    callWithSession(deniedToken, () =>
      removePackagingAction(
        productId.toString(),
        packagingId.toString(),
        { revision: 0 },
      )),
    isPermissionDenied('packaging.delete'),
  );

  const productAfterRefusal = await database.collection('products').findOne({
    _id: productId,
  });
  assert.equal(productAfterRefusal.packagings.length, 1);
  assert.ok(productAfterRefusal.packagings[0]._id.equals(packagingId));

  const result = await callWithSession(allowedToken, () =>
    removePackagingAction(
      productId.toString(),
      packagingId.toString(),
      { revision: 0 },
    ));
  assert.deepEqual(result, {
    error: null,
    revision: 1,
    success: true,
  });

  const productAfterRemoval = await database.collection('products').findOne({
    _id: productId,
  });
  assert.deepEqual(productAfterRemoval.packagings, []);
});


test('refuse une écriture de prix sans sa lecture même avec pricing.update', async () => {
  const { token } = await createUserSession('ecriture-prix-sans-lecture', ['products.read', 'pricing.update']);
  const formData = new FormData();
  formData.set('price', '125');
  await assert.rejects(callWithSession(token, () => updateProductSalePrice(new ObjectId().toString(), { revision: 0 }, formData)), isPermissionDenied('pricing.read'));
});

test('refuse les actions de conditionnement sans packaging.read', async () => {
  const { token } = await createUserSession('conditionnement-sans-lecture', ['products.read', 'packaging.create', 'packaging.delete']);
  const formData = new FormData();
  formData.set('label', 'Carton');
  formData.set('quantity', '12');
  const productId = new ObjectId().toString();
  await assert.rejects(callWithSession(token, () => addProductPackaging(productId, { revision: 0 }, formData)), isPermissionDenied('packaging.read'));
  await assert.rejects(callWithSession(token, () => removePackagingAction(productId, new ObjectId().toString(), { revision: 0 })), isPermissionDenied('packaging.read'));
});

const creationData = (overrides = {}) => {
  const data = new FormData();
  for (const [name, value] of Object.entries({ designation: 'Boisson citron 1 L', code: 'CREATION-TEST', baseUnit: 'BOUTEILLE', withPackaging: 'false', ...overrides })) {
    data.set(name, value);
  }
  return data;
};

test('création refondue : création seule, résultat validé et aucun stock ni prix', async () => {
  const { token, userId } = await createUserSession('creation-seule', ['products.create']);
  const result = await callWithSession(token, () => createProduct({ revision: 0 }, creationData({ code: '  création-seule  ', designation: '  Boisson citron 1 L  ' })));
  assert.equal(result.message, 'Produit créé');
  assert.equal(result.product.code, 'CRÉATION-SEULE');
  assert.equal(result.product.designation, 'Boisson citron 1 L');
  assert.equal(result.product.packaging, null);
  const product = await database.collection('products').findOne({ _id: new ObjectId(result.product.id) });
  assert.ok(product.createdBy.equals(userId));
  assert.equal(product.salePrice, undefined);
  assert.equal(product.packagings, undefined);
  assert.equal(await database.collection('stockMovements').countDocuments({ productId: product._id }), 0);
  await assert.rejects(callWithSession(token, () => requirePermission('products.read')), isPermissionDenied('products.read'));
});

test('création refondue : conditionnement intégré sous products.create, récapitulatif fidèle', async () => {
  const { token, userId } = await createUserSession('creation-conditionnement-initial', ['products.create']);
  const result = await callWithSession(token, () => createProduct({ revision: 0 }, creationData({ code: 'CREATION-PACK', withPackaging: 'true', label: '  Pack de 6  ', quantity: '6' })));
  assert.deepEqual(result.product.packaging, { label: 'Pack de 6', quantity: 6 });
  const product = await database.collection('products').findOne({ _id: new ObjectId(result.product.id) });
  assert.equal(product.packagings.length, 1);
  assert.equal(product.packagings[0].quantity, 6);
  assert.ok(product.packagings[0].createdBy.equals(userId));
  assert.equal(await database.collection('stockMovements').countDocuments({ productId: product._id }), 0);
});

test('création refondue : option active vide ou partielle et quantités invalides sans écriture', async () => {
  const { token } = await createUserSession('creation-pack-invalide', ['products.create']);
  for (const [label, quantity, expected] of [
    ['', '', ['label', 'quantity']], ['', '6', ['label']], ['Pack', '', ['quantity']],
    ['Pack', '2.5', ['quantity']], ['Pack', '1', ['quantity']], ['Pack', '1000001', ['quantity']],
    ['x'.repeat(101), '6', ['label']],
  ]) {
    const result = await callWithSession(token, () => createProduct({ revision: 2 }, creationData({ code: 'CREATION-INVALIDE', withPackaging: 'true', label, quantity })));
    assert.deepEqual(Object.keys(result.errors).sort(), expected);
    assert.equal(result.revision, 3);
    assert.equal(result.values.withPackaging, true);
    assert.equal(result.values.label, label);
    assert.equal(result.values.quantity, quantity);
    assert.equal(result.product, undefined);
  }
  assert.equal(await database.collection('products').countDocuments({ code: 'CREATION-INVALIDE' }), 0);
});

test('création refondue : option désactivée exclut les valeurs obsolètes et préserve les erreurs d’identification', async () => {
  const { token } = await createUserSession('creation-pack-desactive', ['products.create']);
  const invalid = await callWithSession(token, () => createProduct({ revision: 0 }, creationData({ code: '', withPackaging: 'false', label: 'Ancien pack', quantity: '1.5' })));
  assert.deepEqual(Object.keys(invalid.errors), ['code']);
  assert.equal(invalid.values.label, '');
  assert.equal(invalid.values.quantity, '');
  const result = await callWithSession(token, () => createProduct(invalid, creationData({ code: 'CREATION-SANS-PACK', withPackaging: 'false', label: 'Ancien pack', quantity: '1.5' })));
  assert.equal(result.product.packaging, null);
});

test('création refondue : espaces intérieurs et doublon conservent tous les champs', async () => {
  const { token } = await createUserSession('creation-doublon', ['products.create']);
  const data = creationData({ code: 'CREATION-DOUBLON', withPackaging: 'true', label: 'Pack', quantity: '12' });
  const first = await callWithSession(token, () => createProduct({ revision: 0 }, data));
  assert.ok(first.product.id);
  const duplicate = await callWithSession(token, () => createProduct(first, data));
  assert.equal(duplicate.errors.code, 'Un produit avec ce code existe déjà.');
  assert.equal(duplicate.values.designation, 'Boisson citron 1 L');
  assert.equal(duplicate.values.baseUnit, 'BOUTEILLE');
  assert.equal(duplicate.values.label, 'Pack');
  assert.equal(duplicate.values.quantity, '12');
  assert.equal(duplicate.values.withPackaging, true);
  const spaced = await callWithSession(token, () => createProduct({ revision: 0 }, creationData({ code: 'CODE ESPACE' })));
  assert.equal(spaced.errors.code, 'Le code ne doit contenir aucun espace intérieur.');
  assert.equal(await database.collection('products').countDocuments({ code: 'CREATION-DOUBLON' }), 1);
});

test('création refondue : échec de persistance et réessai sans perte des champs', async (context) => {
  const { token } = await createUserSession('creation-reessai', ['products.create']);
  const products = database.collection('products');
  const insert = context.mock.method(Collection.prototype, 'insertOne', async () => { throw new Error('Échec de test isolé'); });
  context.mock.method(console, 'error', () => {});
  const data = creationData({ code: 'CREATION-REESSAI', withPackaging: 'true', label: 'Pack', quantity: '6' });
  const failed = await callWithSession(token, () => createProduct({ revision: 0 }, data));
  assert.equal(failed.errors.form, 'La création du produit est momentanément indisponible.');
  assert.equal(failed.values.withPackaging, true);
  assert.equal(failed.values.label, 'Pack');
  assert.equal(failed.values.designation, 'Boisson citron 1 L');
  assert.equal(failed.product, undefined);
  insert.mock.restore();
  const retried = await callWithSession(token, () => createProduct(failed, data));
  assert.ok(retried.product.id);
  assert.equal(await products.countDocuments({ code: 'CREATION-REESSAI' }), 1);
});
