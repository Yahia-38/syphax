import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_count_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const { getTourCountingSheet } = await import('../lib/tour-countings.js');

let database;
let fullAccessUserId;

const createUser = async (permissions) => {
  const roleId = new ObjectId();
  const userId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      permissions,
    }),
    database.collection('users').insertOne({
      _id: userId,
      active: true,
      roleIds: [roleId],
      username: `comptage-${userId.toHexString()}`,
    }),
  ]);

  return userId;
};

const insertLoadedTour = async ({ historicalPrice = true } = {}) => {
  const productId = new ObjectId();
  const reservationId = new ObjectId();
  const tourId = new ObjectId();

  await Promise.all([
    database.collection('products').insertOne({
      _id: productId,
      active: true,
      baseUnit: 'BOUTEILLE',
      code: `PRD-${productId.toHexString().slice(-6)}`,
      designation: 'Bouteille test',
      salePrice: {
        amountInCentimes: 99_900,
        currency: 'DZD',
        taxIncluded: true,
        unit: 'BOUTEILLE',
      },
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      loadedAt: new Date('2026-09-14T10:00:00.000Z'),
      loadedBy: fullAccessUserId,
      reference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
      status: 'LOADED',
    }),
    database.collection('tourReservations').insertOne({
      _id: reservationId,
      baseUnit: 'BOUTEILLE',
      productCode: 'PRD-HISTORIQUE',
      productDesignation: 'Désignation historique',
      productId,
      quantityInBaseUnits: 60,
      quantityMode: 'DIRECT',
      reservedAt: new Date('2026-09-14T09:00:00.000Z'),
      ...(historicalPrice
        ? {
            salePriceAtLoading: {
              amountInCentimes: 15_000,
              currency: 'DZD',
              taxIncluded: true,
              unit: 'BOUTEILLE',
            },
          }
        : {}),
      status: 'LOADED',
      tourId,
    }),
  ]);

  return { productId, reservationId, tourId };
};

before(async () => {
  database = await getDatabase();
  fullAccessUserId = await createUser([
    'tours.read',
    'tours.count.prepare',
    'pricing.read',
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('retourne uniquement les données historiques nécessaires sans écrire', async () => {
  const { productId, reservationId, tourId } = await insertLoadedTour();
  const beforeCounts = await Promise.all([
    database.collection('tours').countDocuments({}),
    database.collection('tourReservations').countDocuments({}),
    database.collection('stockMovements').countDocuments({}),
  ]);

  const sheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });

  await database.collection('products').updateOne(
    { _id: productId },
    { $set: { 'salePrice.amountInCentimes': 200_000 } },
  );

  const refreshedSheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });
  const [afterCounts, storedReservation] = await Promise.all([
    Promise.all([
      database.collection('tours').countDocuments({}),
      database.collection('tourReservations').countDocuments({}),
      database.collection('stockMovements').countDocuments({}),
    ]),
    database.collection('tourReservations').findOne({ _id: reservationId }),
  ]);

  assert.deepEqual(sheet.errors, {});
  assert.equal(sheet.lines.length, 1);
  assert.equal(sheet.lines[0].productCode, 'PRD-HISTORIQUE');
  assert.equal(sheet.lines[0].productDesignation, 'Désignation historique');
  assert.equal(sheet.lines[0].quantityInBaseUnits, 60);
  assert.equal(sheet.lines[0].salePriceAtLoading.amountInCentimes, 15_000);
  assert.equal(
    refreshedSheet.lines[0].salePriceAtLoading.amountInCentimes,
    15_000,
  );
  assert.deepEqual(afterCounts, beforeCounts);
  assert.equal(storedReservation.status, 'LOADED');
  assert.equal('returnedQuantityInBaseUnits' in storedReservation, false);
  assert.equal('soldQuantityInBaseUnits' in storedReservation, false);
  assert.equal('amountDueInCentimes' in storedReservation, false);
});

test('laisse un prix historique absent explicitement non renseigné', async () => {
  const { tourId } = await insertLoadedTour({ historicalPrice: false });
  const sheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });

  assert.equal(sheet.lines[0].quantityInBaseUnits, 60);
  assert.equal(sheet.lines[0].salePriceAtLoading, null);
});

test('refuse la feuille sans chacun des droits nécessaires', async () => {
  const { tourId } = await insertLoadedTour();
  const permissionCases = [
    {
      expected: 'tours.read',
      permissions: ['tours.count.prepare', 'pricing.read'],
    },
    {
      expected: 'tours.count.prepare',
      permissions: ['tours.read', 'pricing.read'],
    },
    {
      expected: 'pricing.read',
      permissions: ['tours.read', 'tours.count.prepare'],
    },
  ];

  for (const permissionCase of permissionCases) {
    const userId = await createUser(permissionCase.permissions);

    await assert.rejects(
      getTourCountingSheet({
        tourId: tourId.toString(),
        userId: userId.toString(),
      }),
      (error) => error instanceof PermissionDeniedError
        && error.permission === permissionCase.expected,
    );
  }
});

test('refuse une tournée qui n’est pas chargée sans modifier son statut', async () => {
  const tourId = new ObjectId();

  await database.collection('tours').insertOne({
    _id: tourId,
    reference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
    status: 'PREPARATION',
  });

  const sheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });
  const storedTour = await database.collection('tours').findOne({ _id: tourId });

  assert.match(sheet.errors.form, /uniquement pour une tournée chargée/u);
  assert.deepEqual(sheet.lines, []);
  assert.equal(storedTour.status, 'PREPARATION');
});
