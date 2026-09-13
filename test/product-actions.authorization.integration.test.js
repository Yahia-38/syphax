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

const createUserSession = async (username) => {
  const userId = new ObjectId();
  const token = randomBytes(32).toString('base64url');

  await Promise.all([
    database.collection('users').insertOne({
      _id: userId,
      username,
      active: true,
      roleIds: [],
    }),
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
  const workStore = { route: '/produits' };

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
