import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

const testUri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
testUri.pathname = `/syphax_profitability_${process.pid}_${randomUUID().replaceAll('-', '')}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  PROFITABILITY_READ_PERMISSIONS,
  getProfitabilityReport,
} = await import('../lib/profitability.js');

const COUNTED_AT = new Date('2026-09-15T15:00:00.000Z');
const UNIT_PRICE = Object.freeze({
  amountInCentimes: 9_000,
  currency: 'DZD',
  taxIncluded: true,
  unit: 'PIECE',
});
const UNIT_COST_IN_CENTIMES = 7_200;

let database;
let readerId;

const createUser = async (permissions) => {
  const roleId = new ObjectId();
  const userId = new ObjectId();

  await database.collection('roles').insertOne({
    _id: roleId,
    key: `test-${roleId.toString()}`,
    name: 'Rôle de test rentabilité',
    permissions,
  });
  await database.collection('users').insertOne({
    _id: userId,
    active: true,
    roleIds: [roleId],
    username: `rentabilite-${randomUUID()}`,
  });

  return userId.toString();
};

// A recorded counting line: 90 DA sale price and 72 DA loaded cost per bottle,
// with the returned share of the cost restored at its original value.
const countingLine = ({
  amountDueInCentimes,
  loaded = 12,
  returned = 2,
  salePrice = UNIT_PRICE,
  valued = true,
} = {}) => {
  const loadedValueInCentimes = loaded * UNIT_COST_IN_CENTIMES;
  const returnedValueInCentimes = returned * UNIT_COST_IN_CENTIMES;

  return {
    amountDueInCentimes: amountDueInCentimes ?? (loaded - returned) * salePrice.amountInCentimes,
    baseUnit: 'PIECE',
    productId: new ObjectId(),
    quantityInBaseUnits: loaded,
    returnedQuantityInBaseUnits: returned,
    salePriceAtLoading: salePrice,
    soldQuantityInBaseUnits: loaded - returned,
    sourceTourReservationId: new ObjectId(),
    ...(valued
      ? {
          costOfGoodsSoldInCentimes: loadedValueInCentimes - returnedValueInCentimes,
          purchaseCostAtLoading: {
            baseUnit: 'PIECE',
            currency: 'DZD',
            method: 'MOVING_WEIGHTED_AVERAGE',
            quantityInBaseUnits: loaded,
            taxIncluded: true,
            valueInCentimes: loadedValueInCentimes,
            version: 1,
          },
          returnedValueInCentimes,
        }
      : {}),
  };
};

const sum = (lines, field) => lines.reduce((total, line) => total + line[field], 0);

const insertTour = async ({
  counting = {},
  countedAt = COUNTED_AT,
  declaration = {},
  delivererCode = 'LIV-AHMED',
  delivererId = new ObjectId(),
  delivererName = 'Ahmed',
  expensesInCentimes = null,
  lines = [countingLine()],
  reference = `TRN-${new ObjectId().toString().toUpperCase()}`,
  status = 'CLOSED',
  tour = {},
} = {}) => {
  const tourId = new ObjectId();
  const countingId = new ObjectId();
  const counted = ['COUNTED', 'CLOSED'].includes(status);
  const valued = lines.every((line) => line.purchaseCostAtLoading);

  await database.collection('tours').insertOne({
    _id: tourId,
    ...(counted ? { countedAt, countingId } : {}),
    ...(status === 'CLOSED' ? { closedAt: new Date(countedAt.getTime() + 3_600_000) } : {}),
    delivererCode,
    delivererId,
    delivererName,
    plannedDate: new Date('2026-09-15T00:00:00.000Z'),
    reference,
    status,
    ...tour,
  });

  if (counted) {
    await database.collection('tourCountings').insertOne({
      _id: countingId,
      countedAt,
      delivererId,
      lines,
      totalDueInCentimes: sum(lines, 'amountDueInCentimes'),
      ...(valued
        ? {
            totalCostOfGoodsSoldInCentimes: sum(lines, 'costOfGoodsSoldInCentimes'),
            totalPurchaseCostInCentimes: lines.reduce(
              (total, line) => total + line.purchaseCostAtLoading.valueInCentimes,
              0,
            ),
            totalReturnedValueInCentimes: sum(lines, 'returnedValueInCentimes'),
          }
        : {}),
      tourId,
      ...counting,
    });
  }

  if (counted && expensesInCentimes !== null) {
    await database.collection('tourExpenses').insertOne({
      _id: new ObjectId(),
      choice: expensesInCentimes === 0 ? 'NONE' : 'DECLARE',
      declaredAt: new Date(countedAt.getTime() + 1_800_000),
      declaredBy: new ObjectId(),
      lines: expensesInCentimes === 0
        ? []
        : [{ amountInCentimes: expensesInCentimes, reason: 'Carburant' }],
      sourceTourCountingId: countingId,
      totalInCentimes: expensesInCentimes,
      tourId,
      ...declaration,
    });
  }

  return { countingId, delivererId, tourId: tourId.toString() };
};

const read = (options = {}) => getProfitabilityReport({ userId: readerId, ...options });
const findTour = (report, tourId) => report.tours.find(({ id }) => id === tourId);

before(async () => {
  database = await getDatabase();
});

beforeEach(async () => {
  await database.dropDatabase();
  readerId = await createUser([...PROFITABILITY_READ_PERMISSIONS]);
});

after(async () => {
  try {
    if (database) {
      await database.dropDatabase();
    }
  } finally {
    await closeMongoConnection();
  }
});

test('la rentabilité exige chacune des permissions de lecture des ventes, coûts et frais', async () => {
  for (const missingPermission of PROFITABILITY_READ_PERMISSIONS) {
    const userId = await createUser(
      PROFITABILITY_READ_PERMISSIONS.filter((permission) => permission !== missingPermission),
    );

    await assert.rejects(
      getProfitabilityReport({ userId }),
      (error) => error instanceof PermissionDeniedError
        && error.permission === missingPermission,
    );
  }
});

test('une tournée terminée donne ventes, coût des ventes, marge, frais et résultat définitifs', async () => {
  const { delivererId, tourId } = await insertTour({ expensesInCentimes: 5_000 });

  // Collections and manager withdrawals must leave profitability unchanged.
  await database.collection('cashPayments').insertOne({
    _id: new ObjectId(),
    amountInCentimes: 50_000,
    currency: 'DZD',
    delivererId,
    receivedAt: COUNTED_AT,
  });
  await database.collection('cashWithdrawals').insertOne({
    _id: new ObjectId(),
    amountInCentimes: 40_000,
    withdrawnAt: COUNTED_AT,
  });

  const report = await read();
  const tour = findTour(report, tourId);

  assert.equal(tour.salesInCentimes, 90_000);
  assert.equal(tour.costOfGoodsSoldInCentimes, 72_000);
  assert.equal(tour.marginInCentimes, 18_000);
  assert.equal(tour.expenseDeclarationStatus, 'DECLARED');
  assert.equal(tour.expensesInCentimes, 5_000);
  assert.equal(tour.resultInCentimes, 13_000);
  assert.equal(tour.profitabilityStatus, 'FINAL');
  assert.deepEqual(tour.issues, []);
  assert.equal(tour.countedAt, COUNTED_AT.toISOString());
  assert.deepEqual(tour.deliverer, {
    code: 'LIV-AHMED',
    id: delivererId.toString(),
    name: 'Ahmed',
  });
  assert.deepEqual(report.totals.result, {
    amountInCentimes: 13_000,
    complete: true,
    unknownCount: 0,
  });
});

test('les lignes vendues par pack comptent le prix du pack enregistré au chargement', async () => {
  const packPrice = {
    ...UNIT_PRICE,
    packaging: {
      amountInCentimes: 50_000,
      currency: 'DZD',
      quantity: 6,
      taxIncluded: true,
    },
  };
  // Two packs of six at 500 DA, not twelve bottles at 90 DA.
  const { tourId } = await insertTour({
    expensesInCentimes: 0,
    lines: [countingLine({ amountDueInCentimes: 100_000, returned: 0, salePrice: packPrice })],
  });
  const tour = findTour(await read(), tourId);

  assert.equal(tour.salesInCentimes, 100_000);
  assert.equal(tour.costOfGoodsSoldInCentimes, 86_400);
  assert.equal(tour.marginInCentimes, 13_600);
  assert.equal(tour.resultInCentimes, 13_600);
  assert.equal(tour.profitabilityStatus, 'FINAL');
});

test('le statut du résultat suit la déclaration de frais et non le statut de la tournée', async () => {
  const countedDeclared = await insertTour({ expensesInCentimes: 3_000, status: 'COUNTED' });
  const countedPending = await insertTour({ status: 'COUNTED' });
  const closedWithoutDeclaration = await insertTour({ status: 'CLOSED' });
  const closedWithoutExpenses = await insertTour({ expensesInCentimes: 0, status: 'CLOSED' });
  const invalidDeclaration = await insertTour({
    declaration: { totalInCentimes: 9_999 },
    expensesInCentimes: 3_000,
  });
  const report = await read();

  assert.equal(findTour(report, countedDeclared.tourId).profitabilityStatus, 'FINAL');
  assert.equal(findTour(report, countedDeclared.tourId).resultInCentimes, 15_000);
  assert.equal(findTour(report, closedWithoutExpenses.tourId).resultInCentimes, 18_000);

  const pending = findTour(report, countedPending.tourId);

  assert.equal(pending.profitabilityStatus, 'PENDING_EXPENSES');
  assert.equal(pending.expenseDeclarationStatus, 'MISSING');
  assert.equal(pending.marginInCentimes, 18_000);
  assert.equal(pending.expensesInCentimes, null);
  assert.equal(pending.resultInCentimes, null);
  assert.deepEqual(pending.issues, []);

  const historical = findTour(report, closedWithoutDeclaration.tourId);

  assert.equal(historical.profitabilityStatus, 'INCOMPLETE');
  assert.equal(historical.expenseDeclarationStatus, 'HISTORICAL_MISSING');
  assert.equal(historical.expensesInCentimes, null);
  assert.equal(historical.resultInCentimes, null);
  assert.deepEqual(historical.issues.map(({ code }) => code), ['EXPENSES_HISTORICAL_MISSING']);

  const invalid = findTour(report, invalidDeclaration.tourId);

  assert.equal(invalid.expenseDeclarationStatus, 'INVALID');
  assert.equal(invalid.expensesInCentimes, null);
  assert.deepEqual(invalid.issues.map(({ code }) => code), ['EXPENSES_INVALID']);

  assert.deepEqual(report.totals.counts, {
    final: 2,
    incomplete: 2,
    pendingExpenses: 1,
    tours: 5,
  });
  assert.deepEqual(report.totals.margin, {
    amountInCentimes: 90_000,
    complete: true,
    unknownCount: 0,
  });
  assert.deepEqual(report.totals.expenses, {
    amountInCentimes: 3_000,
    complete: false,
    unknownCount: 3,
  });
  assert.deepEqual(report.totals.result, {
    amountInCentimes: 33_000,
    complete: false,
    unknownCount: 3,
  });
});

test('un coût, une vente ou un comptage inconnu reste non calculable et rend le total partiel', async () => {
  const unvalued = await insertTour({
    expensesInCentimes: 0,
    lines: [countingLine({ valued: false })],
  });
  const tamperedCost = await insertTour({
    counting: { totalCostOfGoodsSoldInCentimes: 1 },
    expensesInCentimes: 0,
  });
  const tamperedSales = await insertTour({
    counting: { totalDueInCentimes: 1 },
    expensesInCentimes: 0,
  });
  const withoutCounting = await insertTour({
    status: 'COUNTED',
    tour: { countedAt: null, countingId: new ObjectId() },
  });
  const report = await read({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });

  for (const { tourId } of [unvalued, tamperedCost]) {
    const tour = findTour(report, tourId);

    assert.equal(tour.salesInCentimes, 90_000);
    assert.equal(tour.costOfGoodsSoldInCentimes, null);
    assert.equal(tour.marginInCentimes, null);
    assert.equal(tour.resultInCentimes, null);
    assert.equal(tour.profitabilityStatus, 'INCOMPLETE');
    assert.deepEqual(tour.issues.map(({ code }) => code), ['COST_UNKNOWN']);
  }

  const sales = findTour(report, tamperedSales.tourId);

  assert.equal(sales.salesInCentimes, null);
  assert.equal(sales.costOfGoodsSoldInCentimes, 72_000);
  assert.deepEqual(sales.issues.map(({ code }) => code), ['SALES_INVALID']);

  // Without a counting date the tour cannot be placed outside the period:
  // it stays visible as incomplete instead of disappearing.
  const missing = findTour(report, withoutCounting.tourId);

  assert.equal(missing.countedAt, null);
  assert.equal(missing.salesInCentimes, null);
  assert.deepEqual(missing.issues.map(({ code }) => code), ['COUNTING_MISSING']);

  assert.deepEqual(report.totals.sales, {
    amountInCentimes: 180_000,
    complete: false,
    unknownCount: 2,
  });
  assert.deepEqual(report.totals.costOfGoodsSold, {
    amountInCentimes: 72_000,
    complete: false,
    unknownCount: 3,
  });
  assert.equal(report.totals.counts.incomplete, 4);
});

test('seules les tournées comptées entrent dans la sélection, filtrée par période, livreur, statut et recherche', async () => {
  const brahimId = new ObjectId();

  for (const status of ['PREPARATION', 'LOADED', 'CANCELLED']) {
    await insertTour({ status });
  }

  // Algiers is UTC+1: 22:59:59 UTC is still 30 September, 23:00 UTC is 1 October.
  const lastSeptember = await insertTour({
    countedAt: new Date('2026-09-30T22:59:59.000Z'),
    delivererCode: 'LIV-BRAHIM',
    delivererId: brahimId,
    delivererName: 'Brahim',
    expensesInCentimes: 0,
    reference: 'TRN-SEPTEMBRE',
  });
  const firstOctober = await insertTour({
    countedAt: new Date('2026-09-30T23:00:00.000Z'),
    delivererId: brahimId,
    delivererName: 'Brahim',
    reference: 'TRN-OCTOBRE',
    status: 'COUNTED',
  });
  const ahmed = await insertTour({
    countedAt: new Date('2026-09-20T10:00:00.000Z'),
    expensesInCentimes: 0,
    reference: 'TRN-AHMED',
  });

  const all = await read();

  assert.deepEqual(
    all.tours.map(({ id }) => id),
    [firstOctober.tourId, lastSeptember.tourId, ahmed.tourId],
  );

  const september = await read({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });

  assert.deepEqual(september.tours.map(({ id }) => id), [lastSeptember.tourId, ahmed.tourId]);
  assert.deepEqual(september.filters, {
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    delivererId: '',
    query: '',
    status: '',
  });

  const reversed = await read({ dateFrom: '2026-10-31', dateTo: '2026-10-01' });

  assert.deepEqual(reversed.tours.map(({ id }) => id), [firstOctober.tourId]);
  assert.equal(reversed.filters.dateFrom, '2026-10-01');

  const brahim = await read({ delivererId: brahimId.toString() });

  assert.deepEqual(brahim.tours.map(({ id }) => id), [firstOctober.tourId, lastSeptember.tourId]);

  const counted = await read({ status: 'COUNTED' });

  assert.deepEqual(counted.tours.map(({ id }) => id), [firstOctober.tourId]);
  assert.equal((await read({ status: 'LOADED' })).totalItems, 3);

  // The deliverer choices come from counted tours only, whatever the filters.
  assert.deepEqual(september.delivererOptions.map(({ id, name }) => ({ id, name })), [
    { id: ahmed.delivererId.toString(), name: 'Ahmed' },
    { id: brahimId.toString(), name: 'Brahim' },
  ]);
  assert.deepEqual(counted.delivererOptions, all.delivererOptions);

  assert.deepEqual(
    (await read({ query: 'septembre' })).tours.map(({ id }) => id),
    [lastSeptember.tourId],
  );
  assert.deepEqual(
    (await read({ query: 'liv-brahim' })).tours.map(({ id }) => id),
    [lastSeptember.tourId],
  );
  assert.equal((await read({ query: '.*' })).totalItems, 0);
});

test('les totaux portent sur toute la sélection, indépendamment de la page', async () => {
  for (let index = 0; index < 12; index += 1) {
    await insertTour({
      countedAt: new Date(COUNTED_AT.getTime() + index * 60_000),
      expensesInCentimes: 1_000,
    });
  }

  const lastPage = await read({ page: 3, pageSize: 5 });

  assert.equal(lastPage.page, 3);
  assert.equal(lastPage.totalPages, 3);
  assert.equal(lastPage.totalItems, 12);
  assert.equal(lastPage.tours.length, 2);
  assert.equal(lastPage.totals.counts.tours, 12);
  assert.deepEqual(lastPage.totals.sales, {
    amountInCentimes: 1_080_000,
    complete: true,
    unknownCount: 0,
  });
  assert.equal(lastPage.totals.result.amountInCentimes, 12 * 17_000);

  const beyond = await read({ page: 9, pageSize: 5 });

  assert.equal(beyond.page, 3);
  assert.deepEqual(beyond.tours, lastPage.tours);
});
