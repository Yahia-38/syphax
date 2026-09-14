import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_tour_expenses_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  TOUR_EXPENSE_DECLARE_PERMISSION,
  TOUR_EXPENSE_READ_PERMISSION,
  getTourExpensePreview,
} = await import('../lib/tour-expenses.js');

let database;

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
      username: `expense-${userId.toString()}`,
    }),
  ]);

  return userId.toString();
};

const insertCountedTour = async ({
  delivererActive = true,
  delivererId = new ObjectId(),
  grossSalesInCentimes = 750_000,
  status = 'COUNTED',
} = {}) => {
  const countingId = new ObjectId();
  const tourId = new ObjectId();

  await Promise.all([
    database.collection('deliverers').updateOne(
      { _id: delivererId },
      {
        $set: {
          active: delivererActive,
          code: 'LIV-FRAIS',
          name: 'Livreur frais',
        },
      },
      { upsert: true },
    ),
    database.collection('tourCountings').insertOne({
      _id: countingId,
      countedAt: new Date('2026-09-15T08:00:00.000Z'),
      totalDueInCentimes: grossSalesInCentimes,
      tourId,
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      countingId,
      delivererCode: 'LIV-FRAIS',
      delivererId,
      delivererName: 'Livreur frais',
      reference: `TR-FRAIS-${tourId.toString().slice(-6)}`,
      status,
    }),
  ]);

  return { countingId, delivererId, tourId };
};

before(async () => {
  database = await getDatabase();
});

beforeEach(async () => {
  await Promise.all([
    database.collection('cashPayments').deleteMany({}),
    database.collection('cashWithdrawals').deleteMany({}),
    database.collection('deliverers').deleteMany({}),
    database.collection('roles').deleteMany({}),
    database.collection('tourCountings').deleteMany({}),
    database.collection('tours').deleteMany({}),
    database.collection('users').deleteMany({}),
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('lit les ventes brutes et seulement la part affectée par un versement multi-tournées', async () => {
  const userId = await createUser([
    TOUR_EXPENSE_READ_PERMISSION,
    TOUR_EXPENSE_DECLARE_PERMISSION,
    'tours.read',
    'cash.read',
  ]);
  const delivererId = new ObjectId();
  const first = await insertCountedTour({ delivererId });
  const second = await insertCountedTour({
    delivererId,
    grossSalesInCentimes: 400_000,
  });

  await database.collection('cashPayments').insertOne({
    _id: new ObjectId(),
    allocations: [
      {
        allocatedAmountInCentimes: 300_000,
        sourceTourCountingId: first.countingId,
        tourId: first.tourId,
        tourReference: 'TR-FRAIS-1',
      },
      {
        allocatedAmountInCentimes: 100_000,
        sourceTourCountingId: second.countingId,
        tourId: second.tourId,
        tourReference: 'TR-FRAIS-2',
      },
    ],
    amountInCentimes: 400_000,
    currency: 'DZD',
    delivererId,
    receivedAt: new Date('2026-09-15T09:00:00.000Z'),
  });

  const preview = await getTourExpensePreview({
    tourId: first.tourId.toString(),
    userId,
  });

  assert.equal(preview.grossSalesInCentimes, 750_000);
  assert.equal(preview.totalPaidInCentimes, 300_000);
  assert.deepEqual(preview.errors, {});
});

test('autorise la préparation pour une tournée comptée au livreur désactivé', async () => {
  const userId = await createUser([
    TOUR_EXPENSE_READ_PERMISSION,
    'tours.read',
    'cash.read',
  ]);
  const { tourId } = await insertCountedTour({ delivererActive: false });

  const preview = await getTourExpensePreview({
    tourId: tourId.toString(),
    userId,
  });

  assert.equal(preview.grossSalesInCentimes, 750_000);
  assert.equal(preview.totalPaidInCentimes, 0);
});

test('refuse chacune des lectures requises et ne considère pas tours.read seul comme suffisant', async () => {
  const { tourId } = await insertCountedTour();
  const cases = [
    {
      expected: TOUR_EXPENSE_READ_PERMISSION,
      permissions: ['tours.read', 'cash.read'],
    },
    {
      expected: 'tours.read',
      permissions: [TOUR_EXPENSE_READ_PERMISSION, 'cash.read'],
    },
    {
      expected: 'cash.read',
      permissions: [TOUR_EXPENSE_READ_PERMISSION, 'tours.read'],
    },
  ];

  for (const permissionCase of cases) {
    const userId = await createUser(permissionCase.permissions);

    await assert.rejects(
      getTourExpensePreview({ tourId: tourId.toString(), userId }),
      (error) => error instanceof PermissionDeniedError
        && error.permission === permissionCase.expected,
    );
  }
});

test('ne propose pas les frais sur une tournée CLOSED', async () => {
  const userId = await createUser([
    TOUR_EXPENSE_READ_PERMISSION,
    'tours.read',
    'cash.read',
  ]);
  const { tourId } = await insertCountedTour({ status: 'CLOSED' });

  assert.equal(await getTourExpensePreview({
    tourId: tourId.toString(),
    userId,
  }), null);
});

test('la prévisualisation ne crée et ne modifie aucune donnée métier', async () => {
  const userId = await createUser([
    TOUR_EXPENSE_READ_PERMISSION,
    TOUR_EXPENSE_DECLARE_PERMISSION,
    'tours.read',
    'cash.read',
  ]);
  const { tourId } = await insertCountedTour();
  const before = {
    cashPayments: await database.collection('cashPayments').find({}).toArray(),
    cashWithdrawals: await database.collection('cashWithdrawals').find({}).toArray(),
    countings: await database.collection('tourCountings').find({}).toArray(),
    deliverers: await database.collection('deliverers').find({}).toArray(),
    tours: await database.collection('tours').find({}).toArray(),
  };

  await getTourExpensePreview({ tourId: tourId.toString(), userId });

  const after = {
    cashPayments: await database.collection('cashPayments').find({}).toArray(),
    cashWithdrawals: await database.collection('cashWithdrawals').find({}).toArray(),
    countings: await database.collection('tourCountings').find({}).toArray(),
    deliverers: await database.collection('deliverers').find({}).toArray(),
    tours: await database.collection('tours').find({}).toArray(),
  };

  assert.deepEqual(after, before);
  assert.equal(await database.collection('tourExpenses').countDocuments({}), 0);
});
