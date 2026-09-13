import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

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

test('protège la création de conditionnement et conserve son auteur', async () => {
  const productId = new ObjectId();
  const { token: deniedToken } = await createUserSession(
    'lecture-produit-sans-creation-conditionnement',
    ['products.read'],
  );
  const { token: allowedToken, userId: allowedUserId } = await createUserSession(
    'creation-conditionnement-autorisee',
    ['products.read', 'packaging.create'],
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
