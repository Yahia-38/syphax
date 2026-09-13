import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_sa_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
const { createSupplier, removeSupplier, updateSupplier } = await import(
  '../app/(protected)/receptions/actions.js'
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
    route: '/receptions',
  };

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, callback));
};

test('refuse un appel direct sans suppliers.create', async () => {
  const { token } = await createUserSession('sans-creation-fournisseur', [
    'suppliers.read',
  ]);
  const formData = new FormData();

  formData.set('name', 'Création interdite');

  await assert.rejects(
    callWithSession(token, () =>
      createSupplier({ revision: 0 }, formData)),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'suppliers.create',
  );
  assert.equal(await database.collection('suppliers').countDocuments({}), 0);
});

test('autorise la création avec suppliers.create et conserve son auteur', async () => {
  const { token, userId } = await createUserSession(
    'creation-fournisseur-autorisee',
    ['suppliers.create'],
  );
  const formData = new FormData();

  formData.set('name', 'Fournisseur autorisé');

  const result = await callWithSession(token, () =>
    createSupplier({ revision: 0 }, formData));
  const supplier = await database.collection('suppliers').findOne({
    name: 'Fournisseur autorisé',
  });

  assert.equal(result.message, 'Le fournisseur Fournisseur autorisé a été créé avec succès.');
  assert.ok(supplier.createdBy.equals(userId));
});

test('autorise la modification et détermine son auteur depuis la session', async () => {
  const creatorId = new ObjectId();
  const supplierId = new ObjectId();
  const createdAt = new Date('2026-01-15T09:00:00.000Z');
  const { token, userId } = await createUserSession(
    'modification-fournisseur-autorisee',
    ['suppliers.update'],
  );

  await database.collection('suppliers').insertOne({
    _id: supplierId,
    name: 'Fournisseur initial',
    normalizedName: 'fournisseur initial',
    contactName: '',
    phone: '',
    email: '',
    address: '',
    active: true,
    createdAt,
    createdBy: creatorId,
  });

  const formData = new FormData();
  formData.set('name', 'Fournisseur modifié');
  formData.set('contactName', 'Contact mis à jour');
  formData.set('email', 'MODIFIE@EXEMPLE.DZ');

  const result = await callWithSession(token, () =>
    updateSupplier(supplierId.toString(), { revision: 0 }, formData));
  const supplier = await database.collection('suppliers').findOne({
    _id: supplierId,
  });

  assert.equal(
    result.message,
    'Le fournisseur Fournisseur modifié a été modifié avec succès.',
  );
  assert.equal(supplier.name, 'Fournisseur modifié');
  assert.equal(supplier.contactName, 'Contact mis à jour');
  assert.equal(supplier.email, 'modifie@exemple.dz');
  assert.ok(supplier.createdBy.equals(creatorId));
  assert.equal(supplier.createdAt.getTime(), createdAt.getTime());
  assert.ok(supplier.updatedBy.equals(userId));
  assert.ok(supplier.updatedAt instanceof Date);
});

test('conserve les valeurs soumises lorsque le nom est déjà utilisé', async () => {
  const { token, userId } = await createUserSession(
    'modification-fournisseur-doublon',
    ['suppliers.update'],
  );
  const supplierId = new ObjectId();

  await database.collection('suppliers').insertMany([
    {
      _id: supplierId,
      name: 'Fournisseur avant doublon',
      normalizedName: 'fournisseur avant doublon',
      active: true,
      createdAt: new Date(),
      createdBy: userId,
    },
    {
      _id: new ObjectId(),
      name: 'Nom réservé',
      normalizedName: 'nom réservé',
      active: true,
      createdAt: new Date(),
      createdBy: userId,
    },
  ]);

  const formData = new FormData();
  formData.set('name', ' Nom réservé ');
  formData.set('contactName', 'Valeur conservée');

  const result = await callWithSession(token, () =>
    updateSupplier(supplierId.toString(), { revision: 0 }, formData));
  const unchanged = await database.collection('suppliers').findOne({
    _id: supplierId,
  });

  assert.equal(
    result.errors.name,
    'Un fournisseur avec ce nom existe déjà.',
  );
  assert.equal(result.values.name, ' Nom réservé ');
  assert.equal(result.values.contactName, 'Valeur conservée');
  assert.equal(unchanged.name, 'Fournisseur avant doublon');
  assert.equal(unchanged.updatedAt, undefined);
});

test('signale un fournisseur introuvable sans écrire', async () => {
  const { token } = await createUserSession(
    'modification-fournisseur-absent',
    ['suppliers.update'],
  );
  const missingId = new ObjectId().toString();
  const formData = new FormData();
  formData.set('name', 'Fournisseur absent');
  const countBefore = await database.collection('suppliers').countDocuments();

  const result = await callWithSession(token, () =>
    updateSupplier(missingId, { revision: 0 }, formData));

  assert.equal(result.errors.form, 'Ce fournisseur n’existe plus.');
  assert.equal(await database.collection('suppliers').countDocuments(), countBefore);
});

test('refuse la modification sans suppliers.update et n’écrit rien', async () => {
  const { token, userId } = await createUserSession(
    'sans-modification-fournisseur',
    ['suppliers.read'],
  );
  const supplierId = new ObjectId();

  await database.collection('suppliers').insertOne({
    _id: supplierId,
    name: 'Fournisseur protégé',
    normalizedName: 'fournisseur protégé',
    contactName: 'Contact initial',
    active: true,
    createdAt: new Date(),
    createdBy: userId,
  });

  const formData = new FormData();
  formData.set('name', 'Modification interdite');
  formData.set('contactName', 'Contact interdit');

  await assert.rejects(
    callWithSession(token, () =>
      updateSupplier(supplierId.toString(), { revision: 0 }, formData)),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'suppliers.update',
  );

  const unchanged = await database.collection('suppliers').findOne({
    _id: supplierId,
  });

  assert.equal(unchanged.name, 'Fournisseur protégé');
  assert.equal(unchanged.contactName, 'Contact initial');
  assert.equal(unchanged.updatedAt, undefined);
  assert.equal(unchanged.updatedBy, undefined);
});

test('supprime un fournisseur sans historique avec suppliers.delete', async () => {
  const { token, userId } = await createUserSession(
    'suppression-fournisseur-autorisee',
    ['suppliers.delete'],
  );
  const supplierId = new ObjectId();

  await database.collection('suppliers').insertOne({
    _id: supplierId,
    name: 'Fournisseur supprimable',
    normalizedName: 'fournisseur supprimable',
    active: true,
    createdAt: new Date(),
    createdBy: userId,
  });

  const result = await callWithSession(token, () =>
    removeSupplier(supplierId.toString(), { revision: 0 }));

  assert.equal(result.message, 'Le fournisseur Fournisseur supprimable a été supprimé.');
  assert.equal(
    await database.collection('suppliers').findOne({ _id: supplierId }),
    null,
  );
});

test('désactive avec l’auteur de session un fournisseur présent dans une réception', async () => {
  const creatorId = new ObjectId();
  const supplierId = new ObjectId();
  const { token, userId } = await createUserSession(
    'desactivation-fournisseur-autorisee',
    ['suppliers.delete'],
  );

  await Promise.all([
    database.collection('suppliers').insertOne({
      _id: supplierId,
      name: 'Fournisseur référencé',
      normalizedName: 'fournisseur référencé',
      active: true,
      createdAt: new Date(),
      createdBy: creatorId,
    }),
    database.collection('receptions').insertOne({
      supplierId,
      receivedAt: new Date(),
    }),
  ]);

  const result = await callWithSession(token, () =>
    removeSupplier(supplierId.toString(), { revision: 0 }));
  const supplier = await database.collection('suppliers').findOne({
    _id: supplierId,
  });

  assert.equal(
    result.message,
    'Le fournisseur Fournisseur référencé a été désactivé car il est utilisé dans une réception.',
  );
  assert.equal(supplier.active, false);
  assert.ok(supplier.createdBy.equals(creatorId));
  assert.ok(supplier.deactivatedBy.equals(userId));
  assert.ok(supplier.updatedBy.equals(userId));
});

test('refuse le retrait sans suppliers.delete et ne modifie rien', async () => {
  const { token, userId } = await createUserSession(
    'sans-retrait-fournisseur',
    ['suppliers.read'],
  );
  const supplierId = new ObjectId();

  await database.collection('suppliers').insertOne({
    _id: supplierId,
    name: 'Fournisseur protégé du retrait',
    normalizedName: 'fournisseur protégé du retrait',
    active: true,
    createdAt: new Date(),
    createdBy: userId,
  });

  await assert.rejects(
    callWithSession(token, () =>
      removeSupplier(supplierId.toString(), { revision: 0 })),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'suppliers.delete',
  );

  const unchanged = await database.collection('suppliers').findOne({
    _id: supplierId,
  });

  assert.equal(unchanged.active, true);
  assert.equal(unchanged.deactivatedAt, undefined);
  assert.equal(unchanged.deactivatedBy, undefined);
});
