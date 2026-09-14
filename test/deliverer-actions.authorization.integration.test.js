import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_da_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
const { getDelivererById, listDeliverers } = await import('../lib/deliverers.js');
const { requirePermission } = await import('../lib/sessions.js');
const { createDeliverer } = await import(
  '../app/(protected)/livreurs/nouveau/actions.js'
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
    route: '/livreurs/nouveau',
  };

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, callback));
};

test('autorise la consultation avec deliverers.read', async () => {
  const { token, userId } = await createUserSession(
    'consultation-livreur-autorisee',
    ['deliverers.read'],
  );

  const session = await callWithSession(token, () =>
    requirePermission('deliverers.read'));
  const result = await listDeliverers({ userId: userId.toString() });

  assert.equal(session.username, 'consultation-livreur-autorisee');
  assert.deepEqual(result.deliverers, []);
});

test('refuse la consultation sans deliverers.read', async () => {
  const { token, userId } = await createUserSession(
    'creation-sans-consultation-livreur',
    ['deliverers.create'],
  );

  await assert.rejects(
    callWithSession(token, () => requirePermission('deliverers.read')),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.read',
  );
  await assert.rejects(
    listDeliverers({ userId: userId.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.read',
  );
  await assert.rejects(
    getDelivererById(new ObjectId().toString(), {
      userId: userId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.read',
  );
});

test('refuse un appel direct sans deliverers.create', async () => {
  const { token } = await createUserSession('sans-creation-livreur');
  const formData = new FormData();

  formData.set('code', 'LIV-INTERDIT');
  formData.set('name', 'Création interdite');

  await assert.rejects(
    callWithSession(token, () =>
      createDeliverer({ revision: 0 }, formData)),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.create',
  );
  assert.equal(await database.collection('deliverers').countDocuments({}), 0);
});

test('autorise la création et détermine les métadonnées depuis le serveur', async () => {
  const { token, userId } = await createUserSession(
    'creation-livreur-autorisee',
    ['deliverers.create'],
  );
  const formData = new FormData();

  formData.set('code', ' liv-autorise ');
  formData.set('name', ' Livreur autorisé ');
  formData.set('phone', ' 0550 00 00 00 ');
  formData.set('createdBy', new ObjectId().toString());
  formData.set('createdAt', '2000-01-01T00:00:00.000Z');

  const startedAt = new Date();
  const result = await callWithSession(token, () =>
    createDeliverer({ revision: 0 }, formData));
  const deliverer = await database.collection('deliverers').findOne({
    code: 'LIV-AUTORISE',
  });

  assert.equal(
    result.message,
    'Le livreur LIV-AUTORISE a été créé avec succès.',
  );
  assert.deepEqual(result.values, { code: '', name: '', phone: '' });
  assert.equal(deliverer.name, 'Livreur autorisé');
  assert.equal(deliverer.phone, '0550 00 00 00');
  assert.ok(deliverer.createdBy.equals(userId));
  assert.ok(deliverer.createdAt >= startedAt);
});

test('conserve les valeurs soumises lorsque le code existe déjà', async () => {
  const { token } = await createUserSession(
    'creation-livreur-doublon',
    ['deliverers.create'],
  );
  const firstFormData = new FormData();

  firstFormData.set('code', 'LIV-DOUBLON');
  firstFormData.set('name', 'Premier livreur');
  await callWithSession(token, () =>
    createDeliverer({ revision: 0 }, firstFormData));

  const duplicateFormData = new FormData();
  duplicateFormData.set('code', ' liv-doublon ');
  duplicateFormData.set('name', ' Deuxième livreur ');
  duplicateFormData.set('phone', ' 0770 00 00 00 ');

  const result = await callWithSession(token, () =>
    createDeliverer({ revision: 0 }, duplicateFormData));

  assert.equal(result.errors.code, 'Un livreur avec ce code existe déjà.');
  assert.deepEqual(result.values, {
    code: ' liv-doublon ',
    name: ' Deuxième livreur ',
    phone: ' 0770 00 00 00 ',
  });
  assert.equal(
    await database.collection('deliverers').countDocuments({
      code: 'LIV-DOUBLON',
    }),
    1,
  );
});
