import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_receptions_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
const { getReceptionById, listReceptions } = await import(
  '../lib/reception-records.js'
);
const { createReception } = await import(
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

const createReceptionFormData = ({ productId, supplierId, packagingId }) => {
  const formData = new FormData();

  formData.set('supplierId', supplierId.toString());
  formData.set('receptionDate', '2026-09-13');
  formData.set('supplierReference', ' BL-2026-0042 ');
  formData.set('lines', JSON.stringify([
    {
      productId: productId.toString(),
      quantityMode: 'PACKAGING',
      packagingId: packagingId.toString(),
      packagingCount: '10',
      quantityInBaseUnits: 999,
    },
  ]));

  return formData;
};

test('refuse un appel direct sans receptions.create', async () => {
  const { token } = await createUserSession('sans-creation-reception', [
    'receptions.read',
  ]);
  const formData = new FormData();

  await assert.rejects(
    callWithSession(token, () =>
      createReception({ revision: 0 }, formData)),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'receptions.create',
  );
  assert.equal(await database.collection('receptions').countDocuments({}), 0);
});

test('refuse la lecture d’une réception sans receptions.read', async () => {
  const { userId } = await createUserSession('sans-lecture-reception', [
    'receptions.create',
  ]);

  await assert.rejects(
    getReceptionById(new ObjectId().toString(), { userId: userId.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'receptions.read',
  );
  await assert.rejects(
    listReceptions({ userId: userId.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'receptions.read',
  );
});

test('renvoie une absence pour un identifiant invalide ou inconnu', async () => {
  const { userId } = await createUserSession('lecture-reception-absente', [
    'receptions.read',
  ]);
  const options = { userId: userId.toString() };

  assert.equal(await getReceptionById('identifiant-invalide', options), null);
  assert.equal(
    await getReceptionById(new ObjectId().toString(), options),
    null,
  );
});

test('enregistre une réception et la rend disponible dans l’historique', async () => {
  const { token, userId } = await createUserSession(
    'creation-reception-autorisee',
    ['receptions.create', 'receptions.read'],
  );
  const supplierId = new ObjectId();
  const productId = new ObjectId();
  const packagingId = new ObjectId();

  await Promise.all([
    database.collection('suppliers').insertOne({
      _id: supplierId,
      name: 'Distribution Atlas',
      normalizedName: 'distribution atlas',
      active: true,
      createdAt: new Date(),
      createdBy: userId,
    }),
    database.collection('products').insertOne({
      _id: productId,
      code: 'EAU-1L',
      designation: 'Eau 1 L',
      baseUnit: 'BOUTEILLE',
      packagings: [{
        _id: packagingId,
        label: 'Pack de 6',
        quantity: 6,
      }],
      createdAt: new Date(),
      createdBy: userId,
    }),
  ]);
  const formData = createReceptionFormData({
    packagingId,
    productId,
    supplierId,
  });
  const result = await callWithSession(token, () =>
    createReception({ revision: 0 }, formData));
  const storedReception = await database.collection('receptions').findOne({
    supplierReference: 'BL-2026-0042',
  });
  const receptions = await listReceptions({ userId: userId.toString() });

  await Promise.all([
    database.collection('suppliers').updateOne(
      { _id: supplierId },
      { $set: { name: 'Distribution Atlas renommée' } },
    ),
    database.collection('products').updateOne(
      { _id: productId },
      {
        $set: {
          code: 'EAU-1L-NOUVEAU',
          designation: 'Eau renommée',
          'packagings.0.label': 'Nouveau pack',
          'packagings.0.quantity': 12,
        },
      },
    ),
  ]);
  const receptionDetail = await getReceptionById(
    storedReception._id.toString(),
    { userId: userId.toString() },
  );

  assert.equal(
    result.message,
    'La réception BL-2026-0042 a été enregistrée avec succès.',
  );
  assert.ok(storedReception.createdBy.equals(userId));
  assert.ok(storedReception.supplierId.equals(supplierId));
  assert.equal(storedReception.supplierName, 'Distribution Atlas');
  assert.equal(storedReception.lines[0].quantityInBaseUnits, 60);
  assert.equal(storedReception.lines[0].productCode, 'EAU-1L');
  assert.equal(storedReception.lines[0].packaging.count, 10);
  assert.deepEqual(receptions, [
    {
      id: storedReception._id.toString(),
      supplierId: supplierId.toString(),
      supplierName: 'Distribution Atlas',
      receptionDate: '2026-09-13',
      supplierReference: 'BL-2026-0042',
      createdAt: storedReception.createdAt.toISOString(),
      lines: [{
        productCode: 'EAU-1L',
        productDesignation: 'Eau 1 L',
        quantityInBaseUnits: 60,
        baseUnit: 'BOUTEILLE',
      }],
    },
  ]);
  assert.deepEqual(receptionDetail, {
    id: storedReception._id.toString(),
    supplierId: supplierId.toString(),
    supplierName: 'Distribution Atlas',
    receptionDate: '2026-09-13',
    supplierReference: 'BL-2026-0042',
    createdAt: storedReception.createdAt.toISOString(),
    createdBy: 'creation-reception-autorisee',
    totalAmountInCentimes: null,
    lines: [{
      id: storedReception.lines[0]._id.toString(),
      productId: productId.toString(),
      productCode: 'EAU-1L',
      productDesignation: 'Eau 1 L',
      baseUnit: 'BOUTEILLE',
      quantityMode: 'PACKAGING',
      quantityInBaseUnits: 60,
      directQuantity: null,
      amountInCentimes: null,
      packaging: {
        packagingId: packagingId.toString(),
        label: 'Pack de 6',
        quantity: 6,
        count: 10,
      },
    }],
  });
});

test('conserve zéro comme montant renseigné et distingue un montant absent', async () => {
  const { userId } = await createUserSession('lecture-montants-reception', [
    'receptions.read',
  ]);
  const receptionId = new ObjectId();

  await database.collection('receptions').insertOne({
    _id: receptionId,
    supplierId: new ObjectId(),
    supplierName: 'Fournisseur historique',
    receptionDate: new Date('2026-09-13T00:00:00.000Z'),
    supplierReference: 'BL-MONTANTS',
    createdAt: new Date('2026-09-13T08:00:00.000Z'),
    createdBy: userId,
    totalAmountInCentimes: 0,
    lines: [
      {
        _id: new ObjectId(),
        productId: new ObjectId(),
        productCode: 'ZERO',
        productDesignation: 'Montant nul',
        baseUnit: 'PIECE',
        quantityMode: 'DIRECT',
        quantityInBaseUnits: 5,
        amountInCentimes: 0,
      },
      {
        _id: new ObjectId(),
        productId: new ObjectId(),
        productCode: 'ABSENT',
        productDesignation: 'Montant absent',
        baseUnit: 'PIECE',
        quantityMode: 'DIRECT',
        quantityInBaseUnits: 2,
      },
    ],
  });
  const reception = await getReceptionById(receptionId.toString(), {
    userId: userId.toString(),
  });

  assert.equal(reception.totalAmountInCentimes, 0);
  assert.equal(reception.lines[0].amountInCentimes, 0);
  assert.equal(reception.lines[0].directQuantity, 5);
  assert.equal(reception.lines[1].amountInCentimes, null);
  assert.equal(reception.lines[1].quantityInBaseUnits, 2);
});

test('refuse un fournisseur désactivé sans créer de réception', async () => {
  const { token, userId } = await createUserSession(
    'reception-fournisseur-inactif',
    ['receptions.create'],
  );
  const supplierId = new ObjectId();
  const productId = new ObjectId();
  const packagingId = new ObjectId();

  await Promise.all([
    database.collection('suppliers').insertOne({
      _id: supplierId,
      name: 'Ancien fournisseur',
      active: false,
    }),
    database.collection('products').insertOne({
      _id: productId,
      code: 'PRODUIT-INACTIF',
      designation: 'Produit de contrôle',
      baseUnit: 'PIECE',
      packagings: [{
        _id: packagingId,
        label: 'Carton de 10',
        quantity: 10,
      }],
      createdAt: new Date(),
      createdBy: userId,
    }),
  ]);
  const beforeCount = await database.collection('receptions').countDocuments();
  const result = await callWithSession(token, () => createReception(
    { revision: 0 },
    createReceptionFormData({ packagingId, productId, supplierId }),
  ));

  assert.equal(result.errors.supplierId, 'Ce fournisseur n’est plus actif.');
  assert.equal(
    await database.collection('receptions').countDocuments(),
    beforeCount,
  );
});

test('refuse un mode de quantité forgé côté client', async () => {
  const { token, userId } = await createUserSession(
    'reception-mode-invalide',
    ['receptions.create'],
  );
  const supplierId = new ObjectId();
  const productId = new ObjectId();

  await Promise.all([
    database.collection('suppliers').insertOne({
      _id: supplierId,
      name: 'Fournisseur de contrôle',
      active: true,
    }),
    database.collection('products').insertOne({
      _id: productId,
      code: 'MODE-INVALIDE',
      designation: 'Produit de contrôle',
      baseUnit: 'PIECE',
      createdAt: new Date(),
      createdBy: userId,
    }),
  ]);
  const formData = new FormData();

  formData.set('supplierId', supplierId.toString());
  formData.set('receptionDate', '2026-09-13');
  formData.set('supplierReference', 'BL-MODE-INVALIDE');
  formData.set('lines', JSON.stringify([{
    productId: productId.toString(),
    quantityMode: 'FORGED',
    directQuantity: '10',
  }]));
  const beforeCount = await database.collection('receptions').countDocuments();
  const result = await callWithSession(token, () =>
    createReception({ revision: 0 }, formData));

  assert.equal(
    result.errors.lines,
    'La ligne 1 contient un mode de quantité invalide.',
  );
  assert.equal(
    await database.collection('receptions').countDocuments(),
    beforeCount,
  );
});
