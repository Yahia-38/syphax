import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_day_recap_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const { getDayRecap } = await import('../lib/day-recap.js');

const DAY = '2026-09-17';
const OTHER_DAY = '2026-09-16';
const PLANNED_DATE = new Date(`${DAY}T00:00:00.000Z`);
const SALE_PRICE = Object.freeze({
  amountInCentimes: 9_000,
  currency: 'DZD',
  taxIncluded: true,
  unit: 'PIECE',
});
const ALL_PERMISSIONS = Object.freeze([
  'tours.read',
  'cash.read',
  'tours.expenses.read',
]);

let authorId;
let database;

const createUser = async (permissions) => {
  const roleId = new ObjectId();
  const userId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      key: `test-${roleId.toString()}`,
      name: 'Rôle de test récap',
      permissions,
    }),
    database.collection('users').insertOne({
      _id: userId,
      active: true,
      roleIds: [roleId],
      username: `recap-${randomUUID()}`,
    }),
  ]);

  return userId.toString();
};

// One tour a day, loaded with `loadedQuantity` bottles at 90 DA, of which
// `returnedQuantity` come back. Expenses and payments are optional.
const insertTour = async ({
  expensesInCentimes = null,
  loadedQuantity = 100,
  name = 'Brahim',
  paidInCentimes = null,
  plannedDate = PLANNED_DATE,
  returnedQuantity = 0,
  status = 'CLOSED',
  unallocatedPayment = false,
} = {}) => {
  const delivererId = new ObjectId();
  const tourId = new ObjectId();
  const countingId = new ObjectId();
  const counted = ['COUNTED', 'CLOSED'].includes(status);
  const grossSalesInCentimes = (loadedQuantity - returnedQuantity)
    * SALE_PRICE.amountInCentimes;

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: `LIV-${name.toUpperCase()}`,
    name,
  });
  await database.collection('tours').insertOne({
    _id: tourId,
    ...(counted ? { countedAt: new Date(`${DAY}T16:00:00.000Z`), countingId } : {}),
    ...(status === 'CLOSED' ? { closedAt: new Date(`${DAY}T17:00:00.000Z`) } : {}),
    createdAt: new Date(`${DAY}T05:00:00.000Z`),
    delivererCode: `LIV-${name.toUpperCase()}`,
    delivererId,
    delivererName: name,
    loadedAt: new Date(`${DAY}T06:40:00.000Z`),
    plannedDate,
    reference: `TRN-${name.toUpperCase()}`,
    status,
  });

  if (status !== 'PREPARATION') {
    await database.collection('tourReservations').insertOne({
      _id: new ObjectId(),
      baseUnit: 'PIECE',
      productId: new ObjectId(),
      quantityInBaseUnits: loadedQuantity,
      salePriceAtLoading: { ...SALE_PRICE },
      status: 'LOADED',
      tourId,
    });
  }

  if (counted) {
    await database.collection('tourCountings').insertOne({
      _id: countingId,
      countedAt: new Date(`${DAY}T16:00:00.000Z`),
      countedBy: authorId,
      lines: [],
      totalDueInCentimes: grossSalesInCentimes,
      tourId,
    });
  }

  if (counted && expensesInCentimes !== null) {
    await database.collection('tourExpenses').insertOne({
      _id: new ObjectId(),
      choice: expensesInCentimes === 0 ? 'NONE' : 'DECLARE',
      declaredAt: new Date(`${DAY}T16:30:00.000Z`),
      declaredBy: authorId,
      lines: expensesInCentimes === 0
        ? []
        : [{ amountInCentimes: expensesInCentimes, reason: 'Carburant' }],
      sourceTourCountingId: countingId,
      totalInCentimes: expensesInCentimes,
      tourId,
    });
  }

  if (paidInCentimes !== null) {
    await database.collection('cashPayments').insertOne({
      _id: new ObjectId(),
      allocations: [{
        allocatedAmountInCentimes: paidInCentimes,
        sourceTourCountingId: unallocatedPayment ? new ObjectId() : countingId,
        tourId,
        tourReference: `TRN-${name.toUpperCase()}`,
      }],
      amountInCentimes: paidInCentimes,
      currency: 'DZD',
      delivererId,
      receivedAt: new Date(`${DAY}T17:30:00.000Z`),
    });
  }

  return { countingId, delivererId, tourId };
};

before(async () => {
  database = await getDatabase();
  authorId = new ObjectId();
});

beforeEach(async () => {
  await database.dropDatabase();
  authorId = new ObjectId();
});

after(async () => {
  await database.dropDatabase();
  await closeMongoConnection();
});

test('reading the day recap requires the tour permission', async () => {
  const userId = await createUser(['cash.read']);

  await assert.rejects(
    getDayRecap({ date: DAY, today: DAY, userId }),
    PermissionDeniedError,
  );
});

test('the day decomposes into parts that add up to the goods that went out', async () => {
  const userId = await createUser(ALL_PERMISSIONS);

  // 100 bottles out, 10 back, 200 DA of fuel, 80 000 DA paid of the 890 - 200 due.
  await insertTour({
    expensesInCentimes: 20_000,
    name: 'Brahim',
    paidInCentimes: 700_000,
    returnedQuantity: 10,
    status: 'CLOSED',
  });
  // Fully settled, no returns, no expenses.
  await insertTour({
    expensesInCentimes: 0,
    loadedQuantity: 50,
    name: 'Jaber',
    paidInCentimes: 450_000,
    status: 'CLOSED',
  });
  // Still out with 40 bottles.
  await insertTour({ loadedQuantity: 40, name: 'Oussama', status: 'LOADED' });

  const recap = await getDayRecap({ date: DAY, today: DAY, userId });
  const { totals } = recap;

  assert.equal(recap.financialsVisible, true);
  assert.equal(totals.complete, true);
  assert.equal(totals.sortieInCentimes, 190 * SALE_PRICE.amountInCentimes);
  assert.equal(totals.onTourValueInCentimes, 40 * SALE_PRICE.amountInCentimes);
  assert.equal(totals.returnsValueInCentimes, 10 * SALE_PRICE.amountInCentimes);
  assert.equal(totals.grossSalesInCentimes, 140 * SALE_PRICE.amountInCentimes);
  assert.equal(totals.expensesInCentimes, 20_000);
  assert.equal(totals.paidInCentimes, 1_150_000);
  assert.equal(totals.remainingInCentimes, (90 * 9_000) - 20_000 - 700_000);
  assert.equal(
    totals.segments.reduce((sum, segment) => sum + segment.amountInCentimes, 0),
    totals.sortieInCentimes,
  );
  assert.deepEqual(totals.counts, {
    cancelled: 0,
    closed: 2,
    deliverers: 3,
    onTour: 1,
    preparation: 0,
    returned: 2,
    shipped: 3,
  });
});

test('each row carries its stages and the number that matters', async () => {
  const userId = await createUser(ALL_PERMISSIONS);

  await insertTour({
    expensesInCentimes: 20_000,
    name: 'Brahim',
    paidInCentimes: 700_000,
    returnedQuantity: 10,
    status: 'CLOSED',
  });
  await insertTour({ loadedQuantity: 40, name: 'Oussama', status: 'LOADED' });

  const { tours } = await getDayRecap({ date: DAY, today: DAY, userId });
  const [brahim, oussama] = tours;

  assert.equal(brahim.deliverer.name, 'Brahim');
  assert.deepEqual(brahim.stages, [true, true, false, true]);
  assert.equal(brahim.headline.label, 'Reste à encaisser');
  assert.equal(brahim.headline.amountInCentimes, (90 * 9_000) - 20_000 - 700_000);
  assert.equal(brahim.href, `/tournees/${brahim.id}`);
  assert.deepEqual(oussama.stages, [true, false, null, false]);
  assert.equal(oussama.headline.label, 'En tournée');
  assert.equal(oussama.headline.amountInCentimes, 40 * SALE_PRICE.amountInCentimes);
});

test('tours of other days, cancellations and preparations stay out of the totals', async () => {
  const userId = await createUser(ALL_PERMISSIONS);

  await insertTour({
    expensesInCentimes: 0,
    name: 'Brahim',
    paidInCentimes: 900_000,
    status: 'CLOSED',
  });
  await insertTour({ name: 'Jaber', status: 'CANCELLED' });
  await insertTour({ name: 'Oussama', status: 'PREPARATION' });
  await insertTour({
    expensesInCentimes: 0,
    name: 'Veille',
    paidInCentimes: 900_000,
    plannedDate: new Date(`${OTHER_DAY}T00:00:00.000Z`),
    status: 'CLOSED',
  });

  const recap = await getDayRecap({ date: DAY, today: DAY, userId });

  assert.equal(recap.totalTourCount, 3);
  assert.equal(recap.totals.counts.shipped, 1);
  assert.equal(recap.totals.counts.cancelled, 1);
  assert.equal(recap.totals.counts.preparation, 1);
  assert.equal(recap.totals.sortieInCentimes, 100 * SALE_PRICE.amountInCentimes);
  assert.equal(recap.totals.paidInCentimes, 900_000);
});

test('an inconsistent tour is excluded, flagged and reported as partial', async () => {
  const userId = await createUser(ALL_PERMISSIONS);

  await insertTour({
    expensesInCentimes: 0,
    name: 'Jaber',
    paidInCentimes: 900_000,
    status: 'CLOSED',
  });
  // Paid more than due: the tour cannot be trusted in the totals.
  await insertTour({
    expensesInCentimes: 0,
    name: 'Brahim',
    paidInCentimes: 9_900_000,
    status: 'CLOSED',
  });

  const recap = await getDayRecap({ date: DAY, today: DAY, userId });
  const broken = recap.tours.find(({ deliverer }) => deliverer.name === 'Brahim');

  assert.equal(recap.totals.complete, false);
  assert.equal(recap.totals.paidInCentimes, 900_000);
  assert.equal(recap.totals.counts.shipped, 1);
  assert.equal(broken.anomaly, 'OVERPAID');
  assert.equal(broken.headline.label, 'Données à vérifier');
  assert.equal(broken.remainingDueInCentimes, null);
  assert.deepEqual(
    recap.alerts.filter(({ code }) => code === 'ANOMALY').map(({ tourReference }) => tourReference),
    ['TRN-BRAHIM'],
  );
});

test('the attention list reports what is still open on a past day', async () => {
  const userId = await createUser(ALL_PERMISSIONS);

  await insertTour({ name: 'Oussama', status: 'LOADED' });
  await insertTour({ name: 'Brahim', returnedQuantity: 5, status: 'COUNTED' });
  await insertTour({
    expensesInCentimes: 0,
    name: 'Jaber',
    paidInCentimes: 900_000,
    status: 'CLOSED',
  });

  const recap = await getDayRecap({ date: DAY, today: '2026-09-18', userId });

  assert.deepEqual(
    recap.alerts.map(({ code, deliverer }) => [code, deliverer]),
    [
      ['NOT_RETURNED', 'Oussama'],
      ['REMAINING_DUE', 'Brahim'],
      ['MISSING_EXPENSES', 'Brahim'],
    ],
  );
});

test('filters, search and pagination narrow the rows without moving the totals', async () => {
  const userId = await createUser(ALL_PERMISSIONS);

  for (const name of ['Amine', 'Brahim', 'Jaber']) {
    await insertTour({
      expensesInCentimes: 0,
      name,
      paidInCentimes: 900_000,
      status: 'CLOSED',
    });
  }

  await insertTour({ name: 'Oussama', status: 'LOADED' });

  const sortieInCentimes = 400 * SALE_PRICE.amountInCentimes;
  const onTour = await getDayRecap({ date: DAY, filter: 'tournee', today: DAY, userId });

  assert.equal(onTour.totalItems, 1);
  assert.equal(onTour.tours[0].deliverer.name, 'Oussama');
  assert.equal(onTour.totals.sortieInCentimes, sortieInCentimes);

  const searched = await getDayRecap({ date: DAY, query: 'bra', today: DAY, userId });

  assert.equal(searched.totalItems, 1);
  assert.equal(searched.tours[0].deliverer.name, 'Brahim');
  assert.equal(searched.totals.sortieInCentimes, sortieInCentimes);

  const paged = await getDayRecap({ date: DAY, page: 2, pageSize: 3, today: DAY, userId });

  assert.equal(paged.totalPages, 2);
  assert.equal(paged.tours.length, 1);
  assert.equal(paged.tours[0].deliverer.name, 'Oussama');

  const beyond = await getDayRecap({ date: DAY, page: 9, pageSize: 3, today: DAY, userId });

  assert.equal(beyond.page, 2);
});

test('without the cash permissions the money is hidden and the sales stay visible', async () => {
  const userId = await createUser(['tours.read']);

  await insertTour({
    expensesInCentimes: 20_000,
    name: 'Brahim',
    paidInCentimes: 700_000,
    returnedQuantity: 10,
    status: 'CLOSED',
  });

  const recap = await getDayRecap({ date: DAY, filter: 'impayes', today: DAY, userId });

  assert.equal(recap.financialsVisible, false);
  assert.equal(recap.filter, '');
  assert.equal(recap.cash, null);
  assert.equal(recap.totals.paidInCentimes, null);
  assert.equal(recap.totals.expensesInCentimes, null);
  assert.equal(recap.totals.grossSalesInCentimes, 90 * SALE_PRICE.amountInCentimes);
  assert.deepEqual(recap.totals.segments.map(({ key }) => key), ['sold', 'returns']);
  assert.equal(recap.tours[0].headline.label, 'Terminée');
  assert.deepEqual(recap.tours[0].stages, [true, true, null, true]);
});

test('the cash line separates what settles the day from what settles older tours', async () => {
  const userId = await createUser(ALL_PERMISSIONS);
  const { tourId } = await insertTour({
    expensesInCentimes: 0,
    name: 'Brahim',
    paidInCentimes: 900_000,
    status: 'CLOSED',
  });

  // A payment received the same day, settling a tour of another day.
  await database.collection('cashPayments').insertOne({
    _id: new ObjectId(),
    allocations: [{
      allocatedAmountInCentimes: 3_216_300,
      sourceTourCountingId: new ObjectId(),
      tourId: new ObjectId(),
      tourReference: 'TRN-VEILLE',
    }],
    amountInCentimes: 3_216_300,
    currency: 'DZD',
    receivedAt: new Date(`${DAY}T07:15:00.000Z`),
  });
  await database.collection('cashWithdrawals').insertOne({
    _id: new ObjectId(),
    amountInCentimes: 5_000_000,
    withdrawnAt: new Date(`${DAY}T18:00:00.000Z`),
  });
  // Received the next day in Algiers: outside the window.
  await database.collection('cashPayments').insertOne({
    _id: new ObjectId(),
    allocations: [{
      allocatedAmountInCentimes: 1_000,
      sourceTourCountingId: new ObjectId(),
      tourId,
      tourReference: 'TRN-BRAHIM',
    }],
    amountInCentimes: 1_000,
    currency: 'DZD',
    receivedAt: new Date(`${DAY}T23:30:00.000Z`),
  });

  const { cash } = await getDayRecap({ date: DAY, today: DAY, userId });

  assert.equal(cash.paymentCount, 2);
  assert.equal(cash.receivedInCentimes, 900_000 + 3_216_300);
  assert.equal(cash.receivedForDayToursInCentimes, 900_000);
  assert.equal(cash.receivedForOtherToursInCentimes, 3_216_300);
  assert.equal(cash.withdrawnInCentimes, 5_000_000);
  assert.equal(cash.withdrawalCount, 1);
  assert.equal(cash.complete, true);
});
