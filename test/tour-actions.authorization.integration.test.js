import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_tour_actions_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
const { createTour } = await import(
  '../app/(protected)/livreurs/[id]/actions.js'
);
const { addTourProduct, releaseTourProduct } = await import(
  '../app/(protected)/tournees/[id]/actions.js'
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
    route: '/livreurs/[id]',
  };

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, callback));
};

const createTourFormData = ({ creationKey = randomUUID(), plannedDate }) => {
  const formData = new FormData();

  formData.set('creationKey', creationKey);
  formData.set('plannedDate', plannedDate);
  formData.set('createdBy', new ObjectId().toString());
  formData.set('reference', 'REF-NAVIGATEUR');
  formData.set('status', 'TERMINEE');

  return formData;
};

const createTourProductFormData = ({ productId }) => {
  const formData = new FormData();

  formData.set('additionKey', randomUUID());
  formData.set('productId', productId);
  formData.set('quantityMode', 'DIRECT');
  formData.set('directQuantity', '10');

  return formData;
};

test('refuse l’ajout de produit sans la permission dédiée', async () => {
  const { token } = await createUserSession(
    'lecture-tournee-sans-reservation',
    ['packaging.read', 'products.read', 'tours.read'],
  );
  const delivererId = new ObjectId();
  const productId = new ObjectId();
  const tourId = new ObjectId();

  await Promise.all([
    database.collection('deliverers').insertOne({
      _id: delivererId,
      active: true,
      code: 'LIV-SANS-RESERVATION',
      name: 'Sans réservation',
    }),
    database.collection('products').insertOne({
      _id: productId,
      baseUnit: 'PIECE',
      code: 'PRD-SANS-PERMISSION',
      designation: 'Produit protégé',
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      delivererId,
      reference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
      status: 'PREPARATION',
    }),
    database.collection('stockMovements').insertOne({
      productId,
      quantityDeltaInBaseUnits: 100,
    }),
  ]);

  await assert.rejects(
    callWithSession(token, () => addTourProduct(
      tourId.toString(),
      { revision: 0 },
      createTourProductFormData({ productId: productId.toString() }),
    )),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'tours.products.add',
  );
  assert.equal(await database.collection('tourReservations').countDocuments({
    tourId,
  }), 0);
  await Promise.all([
    database.collection('deliverers').deleteOne({ _id: delivererId }),
    database.collection('products').deleteOne({ _id: productId }),
    database.collection('stockMovements').deleteMany({ productId }),
    database.collection('tours').deleteOne({ _id: tourId }),
  ]);
});

test('refuse le retrait sans la permission dédiée et sans écrire', async () => {
  const { token } = await createUserSession(
    'lecture-tournee-sans-retrait',
    ['tours.read'],
  );
  const productId = new ObjectId();
  const reservationId = new ObjectId();
  const tourId = new ObjectId();

  await Promise.all([
    database.collection('products').insertOne({
      _id: productId,
      baseUnit: 'PIECE',
      code: 'PRD-SANS-RETRAIT',
      designation: 'Produit protégé du retrait',
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      reference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
      status: 'PREPARATION',
    }),
    database.collection('tourReservations').insertOne({
      _id: reservationId,
      productId,
      quantityInBaseUnits: 10,
      status: 'ACTIVE',
      tourId,
    }),
  ]);

  await assert.rejects(
    callWithSession(token, () => releaseTourProduct(
      tourId.toString(),
      reservationId.toString(),
      { revision: 0 },
    )),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'tours.products.release',
  );

  const reservation = await database.collection('tourReservations').findOne({
    _id: reservationId,
  });
  const tour = await database.collection('tours').findOne({ _id: tourId });
  const product = await database.collection('products').findOne({
    _id: productId,
  });

  assert.equal(reservation.status, 'ACTIVE');
  assert.equal('releasedAt' in reservation, false);
  assert.equal('releasedBy' in reservation, false);
  assert.equal('reservationReferenceVersion' in tour, false);
  assert.equal('stockReferenceVersion' in product, false);

  await Promise.all([
    database.collection('products').deleteOne({ _id: productId }),
    database.collection('tourReservations').deleteOne({ _id: reservationId }),
    database.collection('tours').deleteOne({ _id: tourId }),
  ]);
});

test('exige aussi les droits de lecture du catalogue et des conditionnements', async () => {
  const { token: missingProductReadToken } = await createUserSession(
    'reservation-sans-catalogue',
    ['packaging.read', 'tours.products.add'],
  );
  const { token: missingPackagingReadToken } = await createUserSession(
    'reservation-sans-conditionnements',
    ['products.read', 'tours.products.add'],
  );
  const tourId = new ObjectId().toString();
  const productId = new ObjectId().toString();

  await assert.rejects(
    callWithSession(missingProductReadToken, () => addTourProduct(
      tourId,
      { revision: 0 },
      createTourProductFormData({ productId }),
    )),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'products.read',
  );
  await assert.rejects(
    callWithSession(missingPackagingReadToken, () => addTourProduct(
      tourId,
      { revision: 0 },
      createTourProductFormData({ productId }),
    )),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'packaging.read',
  );
});

test('refuse la création avec la seule permission deliverers.read sans écrire', async () => {
  const { token, userId } = await createUserSession(
    'lecture-livreur-sans-creation-tournee',
    ['deliverers.read'],
  );
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: 'LIV-SANS-TOUR',
    name: 'Sans permission tournée',
    createdAt: new Date(),
    createdBy: userId,
  });

  await assert.rejects(
    callWithSession(token, () => createTour(
      delivererId.toString(),
      `/livreurs/${delivererId}`,
      { revision: 0 },
      createTourFormData({ plannedDate: '2026-09-14' }),
    )),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'tours.create',
  );
  assert.equal(await database.collection('tours').countDocuments({}), 0);
});

test('crée via la session, ignore les métadonnées du navigateur et ouvre la fiche', async () => {
  const { token, userId } = await createUserSession(
    'creation-tournee-autorisee',
    ['deliverers.read', 'tours.create', 'tours.read'],
  );
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: 'LIV-ACTION',
    name: 'Livreur action',
    createdAt: new Date(),
    createdBy: userId,
  });

  await assert.rejects(
    callWithSession(token, () => createTour(
      delivererId.toString(),
      `/livreurs/${delivererId}`,
      { revision: 0 },
      createTourFormData({ plannedDate: '2026-09-14' }),
    )),
    (error) => typeof error?.digest === 'string'
      && error.digest.startsWith('NEXT_REDIRECT;')
      && error.digest.includes('/tournees/'),
  );

  const stored = await database.collection('tours').findOne({ delivererId });

  assert.ok(stored.createdBy.equals(userId));
  assert.equal(stored.delivererCode, 'LIV-ACTION');
  assert.equal(stored.delivererName, 'Livreur action');
  assert.equal(stored.status, 'PREPARATION');
  assert.match(stored.reference, /^TRN-[A-F\d]{24}$/u);
  assert.equal('amount' in stored, false);
  assert.equal('products' in stored, false);
  assert.equal('reservations' in stored, false);
});

test('retourne l’erreur de date sans créer de tournée', async () => {
  const { token, userId } = await createUserSession(
    'date-tournee-invalide',
    ['tours.create'],
  );
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: 'LIV-DATE',
    name: 'Livreur date',
    createdAt: new Date(),
    createdBy: userId,
  });

  const result = await callWithSession(token, () => createTour(
    delivererId.toString(),
    `/livreurs/${delivererId}`,
    { revision: 0 },
    createTourFormData({ plannedDate: '2026-09-31' }),
  ));

  assert.equal(result.errors.plannedDate, 'Saisissez une date prévue valide.');
  assert.equal(await database.collection('tours').countDocuments({
    delivererId,
  }), 0);
});
