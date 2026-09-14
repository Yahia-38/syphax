import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_cash_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const {
  CASH_PAYMENT_CREATE_PERMISSION,
  CASH_PAYMENT_FORM_PERMISSIONS,
  CASH_READ_PERMISSION,
  getTourPaymentPreview,
} = await import('../lib/cash-payments.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');

let database;
let cashierId;

const createUser = async (permissions) => {
  const roleId = new ObjectId();
  const userId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      key: `test-${roleId.toString()}`,
      name: 'Rôle de test caisse',
      permissions,
    }),
    database.collection('users').insertOne({
      _id: userId,
      active: true,
      roleIds: [roleId],
      username: `caisse-${userId.toString()}`,
    }),
  ]);

  return userId;
};

const insertTour = async ({
  delivererActive = true,
  status = 'COUNTED',
  totalDueInCentimes = 750_000,
} = {}) => {
  const countingId = new ObjectId();
  const delivererId = new ObjectId();
  const tourId = new ObjectId();

  await Promise.all([
    database.collection('deliverers').insertOne({
      _id: delivererId,
      active: delivererActive,
      code: `LIV-${delivererId.toString().slice(-6)}`,
      name: 'Livreur caisse',
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      countingId,
      delivererId,
      reference: `TRN-${tourId.toString().toUpperCase()}`,
      status,
    }),
    database.collection('tourCountings').insertOne({
      _id: countingId,
      delivererId,
      lines: [],
      totalDueInCentimes,
      tourId,
    }),
  ]);

  return { countingId, delivererId, tourId };
};

before(async () => {
  database = await getDatabase();
  cashierId = await createUser([
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('lit exclusivement le dû définitif de la tournée sans écrire', async () => {
  const { delivererId, tourId } = await insertTour();
  const [countingBefore, delivererBefore, tourBefore, collectionsBefore] =
    await Promise.all([
      database.collection('tourCountings').findOne({ tourId }),
      database.collection('deliverers').findOne({ _id: delivererId }),
      database.collection('tours').findOne({ _id: tourId }),
      database.listCollections({}, { nameOnly: true }).toArray(),
    ]);
  const preview = await getTourPaymentPreview({
    tourId: tourId.toString(),
    userId: cashierId.toString(),
  });
  const [countingAfter, delivererAfter, tourAfter, collectionsAfter] =
    await Promise.all([
      database.collection('tourCountings').findOne({ tourId }),
      database.collection('deliverers').findOne({ _id: delivererId }),
      database.collection('tours').findOne({ _id: tourId }),
      database.listCollections({}, { nameOnly: true }).toArray(),
    ]);

  assert.deepEqual(preview, {
    amountDueInCentimes: 750_000,
    amountPaidInCentimes: 0,
    delivererId: delivererId.toString(),
    paymentCount: 0,
    remainingDueInCentimes: 750_000,
    tourId: tourId.toString(),
    tourReference: `TRN-${tourId.toString().toUpperCase()}`,
  });
  assert.deepEqual(countingAfter, countingBefore);
  assert.deepEqual(delivererAfter, delivererBefore);
  assert.deepEqual(tourAfter, tourBefore);
  assert.deepEqual(collectionsAfter, collectionsBefore);
  assert.equal(await database.collection('stockMovements').countDocuments({}), 0);
  assert.deepEqual(
    CASH_PAYMENT_FORM_PERMISSIONS,
    [CASH_READ_PERMISSION, CASH_PAYMENT_CREATE_PERMISSION],
  );
});

test('accepte un dû nul sans inventer de versement', async () => {
  const { tourId } = await insertTour({ totalDueInCentimes: 0 });
  const preview = await getTourPaymentPreview({
    tourId: tourId.toString(),
    userId: cashierId.toString(),
  });

  assert.equal(preview.amountDueInCentimes, 0);
  assert.equal(preview.remainingDueInCentimes, 0);
  assert.equal(preview.paymentCount, 0);
  assert.equal(preview.amountPaidInCentimes, 0);
});

test('refuse la lecture sans permission et une tournée non comptée', async () => {
  const unauthorizedId = await createUser([CASH_PAYMENT_CREATE_PERMISSION]);
  const counted = await insertTour();
  const loaded = await insertTour({ status: 'LOADED' });

  await assert.rejects(
    getTourPaymentPreview({
      tourId: counted.tourId.toString(),
      userId: unauthorizedId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
  assert.equal(await getTourPaymentPreview({
    tourId: loaded.tourId.toString(),
    userId: cashierId.toString(),
  }), null);
});

test('autorise la lecture après désactivation du livreur', async () => {
  const { delivererId, tourId } = await insertTour({
    delivererActive: false,
  });
  const preview = await getTourPaymentPreview({
    tourId: tourId.toString(),
    userId: cashierId.toString(),
  });

  assert.equal(preview.delivererId, delivererId.toString());
  assert.equal(preview.remainingDueInCentimes, 750_000);
});
