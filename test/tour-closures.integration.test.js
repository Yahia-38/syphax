import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_tour_closures_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const {
  CASH_PAYMENT_CREATE_PERMISSION,
  CASH_READ_PERMISSION,
  getTourPaymentPreview,
  recordTourCashPayment,
} = await import('../lib/cash-payments.js');
const { initializeMainCashRegister } = await import('../lib/cash-registers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const { getTourCountingSheet } = await import('../lib/tour-countings.js');
const {
  TOUR_CLOSE_PERMISSION,
  closeCountedTour,
  getTourClosurePreview,
} = await import('../lib/tour-closures.js');
const {
  TOUR_STATUS_CLOSED,
  TOUR_STATUS_COUNTED,
  formatTourStatus,
  getTourById,
  listToursByDeliverer,
} = await import('../lib/tours.js');

let cashRegister;
let cashierId;
let closerId;
let database;

const createUser = async (
  permissions,
  username = `cloture-${randomUUID()}`,
) => {
  const roleId = new ObjectId();
  const userId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      key: `test-${roleId.toString()}`,
      name: 'Rôle de test clôture',
      permissions,
    }),
    database.collection('users').insertOne({
      _id: userId,
      active: true,
      roleIds: [roleId],
      username,
    }),
  ]);

  return userId;
};

const insertCountedTour = async ({
  delivererActive = true,
  includeExpenseDeclaration = true,
  includeCounting = true,
  status = TOUR_STATUS_COUNTED,
  totalDueInCentimes = 750_000,
} = {}) => {
  const countingId = new ObjectId();
  const delivererId = new ObjectId();
  const tourId = new ObjectId();

  await Promise.all([
    database.collection('deliverers').insertOne({
      _id: delivererId,
      active: delivererActive,
      code: 'LIV-CLOTURE',
      name: 'Livreur clôture',
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      countingId,
      delivererCode: 'LIV-CLOTURE',
      delivererId,
      delivererName: 'Livreur clôture',
      reference: `TRN-${tourId.toString().toUpperCase()}`,
      status,
    }),
    ...(includeCounting
      ? [database.collection('tourCountings').insertOne({
          _id: countingId,
          countedAt: new Date(),
          countedBy: closerId,
          lines: [],
          totalDueInCentimes,
          tourId,
        })]
      : []),
    ...(includeCounting && includeExpenseDeclaration
      ? [database.collection('tourExpenses').insertOne({
          _id: new ObjectId(),
          choice: 'NONE',
          confirmationKey: randomUUID(),
          declaredAt: new Date(),
          declaredBy: closerId,
          delivererId,
          lines: [],
          requestDigest: 'test-none',
          sourceTourCountingId: countingId,
          totalInCentimes: 0,
          tourId,
        })]
      : []),
  ]);

  return { countingId, delivererId, tourId };
};

const recordPayment = async ({
  amount,
  confirmationKey = randomUUID(),
  tourId,
}) => {
  const tour = await database.collection('tours').findOne({ _id: tourId });
  const counting = await database.collection('tourCountings').findOne({
    _id: tour?.countingId,
    tourId,
  });
  const payments = await database.collection('cashPayments').find({
    tourId,
  }).toArray();
  const expenseDeclaration = await database.collection('tourExpenses')
    .findOne({ tourId });
  const paid = payments.reduce((total, payment) =>
    Number.isSafeInteger(payment.amountInCentimes)
      ? total + payment.amountInCentimes
      : total, 0);

  return recordTourCashPayment({
    amount,
    confirmationKey,
    expectedCashRegisterId: cashRegister.id,
    expectedRemainingDueInCentimes: String(
      counting.totalDueInCentimes
        - (expenseDeclaration?.totalInCentimes ?? 0)
        - paid,
    ),
    note: '',
    receivedBy: cashierId.toString(),
    tourId: tourId.toString(),
  });
};

const readClosurePreview = (tourId, userId = closerId) =>
  getTourClosurePreview({
    tourId: tourId.toString(),
    userId: userId.toString(),
  });

const closeFromPreview = (tourId, preview, userId = closerId) =>
  closeCountedTour({
    closedBy: userId.toString(),
    expectedDigest: preview.digest,
    tourId: tourId.toString(),
  });

before(async () => {
  database = await getDatabase();
  closerId = await createUser([
    TOUR_CLOSE_PERMISSION,
    'tours.read',
    CASH_READ_PERMISSION,
    'pricing.read',
    'tours.count.prepare',
  ], 'responsable-cloture');
  cashierId = await createUser([
    CASH_PAYMENT_CREATE_PERMISSION,
    CASH_READ_PERMISSION,
    'tours.read',
  ], 'caissier-cloture');
});

beforeEach(async () => {
  await Promise.all([
    database.collection('cashPayments').deleteMany({}),
    database.collection('cashRegisters').deleteMany({}),
    database.collection('deliverers').deleteMany({}),
    database.collection('stockMovements').deleteMany({}),
    database.collection('tourCountings').deleteMany({}),
    database.collection('tourExpenses').deleteMany({}),
    database.collection('tours').deleteMany({}),
  ]);
  cashRegister = await initializeMainCashRegister();
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('termine une tournée intégralement payée sans modifier comptage, versements ou stock', async () => {
  const tour = await insertCountedTour();
  await database.collection('stockMovements').insertOne({
    _id: new ObjectId(),
    kind: 'TEST_CLOSURE_STOCK',
    quantityDeltaInBaseUnits: 4,
  });
  await recordPayment({ amount: '7500', tourId: tour.tourId });
  const preview = await readClosurePreview(tour.tourId);
  const [countingBefore, paymentsBefore, stockBefore] = await Promise.all([
    database.collection('tourCountings').findOne({ _id: tour.countingId }),
    database.collection('cashPayments').find({}).toArray(),
    database.collection('stockMovements').find({}).toArray(),
  ]);
  const result = await closeFromPreview(tour.tourId, preview);
  const [storedTour, countingAfter, paymentsAfter, stockAfter] =
    await Promise.all([
      database.collection('tours').findOne({ _id: tour.tourId }),
      database.collection('tourCountings').findOne({ _id: tour.countingId }),
      database.collection('cashPayments').find({}).toArray(),
      database.collection('stockMovements').find({}).toArray(),
    ]);

  assert.equal(preview.amountDueInCentimes, 750_000);
  assert.equal(preview.amountPaidInCentimes, 750_000);
  assert.equal(preview.remainingDueInCentimes, 0);
  assert.equal(result.replayed, false);
  assert.equal(result.closure.status, TOUR_STATUS_CLOSED);
  assert.equal(result.closure.remainingDueInCentimes, 0);
  assert.equal(storedTour.status, TOUR_STATUS_CLOSED);
  assert.ok(storedTour.closedAt instanceof Date);
  assert.ok(storedTour.closedBy.equals(closerId));
  const [countingSheet, detail, list] = await Promise.all([
    getTourCountingSheet({
      tourId: tour.tourId.toString(),
      userId: closerId.toString(),
    }),
    getTourById(tour.tourId.toString(), { userId: closerId.toString() }),
    listToursByDeliverer({
      delivererId: tour.delivererId.toString(),
      userId: closerId.toString(),
    }),
  ]);

  assert.equal(formatTourStatus(detail.status), 'Terminée');
  assert.equal(detail.closedAt, storedTour.closedAt.toISOString());
  assert.equal(detail.closedBy, 'responsable-cloture');
  assert.equal(countingSheet.recorded, true);
  assert.equal(countingSheet.totalDueInCentimes, 750_000);
  assert.equal(list.tours[0].status, TOUR_STATUS_CLOSED);
  assert.deepEqual(countingAfter, countingBefore);
  assert.deepEqual(paymentsAfter, paymentsBefore);
  assert.deepEqual(stockAfter, stockBefore);
});

test('termine avec un paiement partiel et conserve le reste actuel', async () => {
  const tour = await insertCountedTour();
  await recordPayment({ amount: '5000', tourId: tour.tourId });
  const preview = await readClosurePreview(tour.tourId);
  const result = await closeFromPreview(tour.tourId, preview);

  assert.equal(preview.amountPaidInCentimes, 500_000);
  assert.equal(preview.remainingDueInCentimes, 250_000);
  assert.equal(result.closure.remainingDueInCentimes, 250_000);
  assert.equal((await database.collection('cashPayments').countDocuments({})), 1);
});

test('exige une déclaration enregistrée avant toute nouvelle clôture', async () => {
  const tour = await insertCountedTour({
    includeExpenseDeclaration: false,
  });
  const preview = await readClosurePreview(tour.tourId);
  const result = await closeCountedTour({
    closedBy: closerId.toString(),
    expectedDigest: 'a'.repeat(64),
    tourId: tour.tourId.toString(),
  });

  assert.match(preview.errors.form, /déclaration de frais/u);
  assert.match(result.errors.form, /déclaration de frais/u);
  assert.equal((await database.collection('tours').findOne({
    _id: tour.tourId,
  })).status, TOUR_STATUS_COUNTED);
});

test('clôture sur le net après frais sans modifier ventes, caisse ou stock', async () => {
  const tour = await insertCountedTour();

  await database.collection('tourExpenses').updateOne(
    { tourId: tour.tourId },
    {
      $set: {
        choice: 'DECLARE',
        lines: [{ amountInCentimes: 220_000, reason: 'Carburant' }],
        totalInCentimes: 220_000,
      },
    },
  );
  await recordPayment({ amount: '3000', tourId: tour.tourId });

  const preview = await readClosurePreview(tour.tourId);
  const result = await closeFromPreview(tour.tourId, preview);

  assert.equal(preview.grossSalesInCentimes, 750_000);
  assert.equal(preview.totalExpensesInCentimes, 220_000);
  assert.equal(preview.netDueInCentimes, 530_000);
  assert.equal(preview.remainingDueInCentimes, 230_000);
  assert.equal(result.closure.remainingDueInCentimes, 230_000);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 0);
  assert.equal(await database.collection('stockMovements').countDocuments({}), 0);
});

test('clôture avec uniquement le montant affecté par un versement multi-tournées', async () => {
  const first = await insertCountedTour({ totalDueInCentimes: 750_000 });
  const firstTour = await database.collection('tours').findOne({
    _id: first.tourId,
  });
  const secondCountingId = new ObjectId();
  const secondTourId = new ObjectId();

  await Promise.all([
    database.collection('tours').insertOne({
      _id: secondTourId,
      countingId: secondCountingId,
      delivererCode: firstTour.delivererCode,
      delivererId: first.delivererId,
      delivererName: firstTour.delivererName,
      reference: `TRN-${secondTourId.toString().toUpperCase()}`,
      status: TOUR_STATUS_COUNTED,
    }),
    database.collection('tourCountings').insertOne({
      _id: secondCountingId,
      countedAt: new Date(),
      countedBy: closerId,
      lines: [],
      totalDueInCentimes: 300_000,
      tourId: secondTourId,
    }),
  ]);
  const paymentId = new ObjectId();

  await database.collection('cashPayments').insertOne({
    _id: paymentId,
    allocations: [
      {
        allocatedAmountInCentimes: 500_000,
        sourceTourCountingId: first.countingId,
        tourId: first.tourId,
        tourReference: firstTour.reference,
      },
      {
        allocatedAmountInCentimes: 100_000,
        sourceTourCountingId: secondCountingId,
        tourId: secondTourId,
        tourReference: `TRN-${secondTourId.toString().toUpperCase()}`,
      },
    ],
    amountInCentimes: 600_000,
    cashRegisterCode: cashRegister.code,
    cashRegisterId: new ObjectId(cashRegister.id),
    cashRegisterName: cashRegister.name,
    confirmationKey: randomUUID(),
    currency: 'DZD',
    delivererCode: firstTour.delivererCode,
    delivererId: first.delivererId,
    delivererName: firstTour.delivererName,
    mode: 'CASH',
    receivedAt: new Date(),
    receivedBy: cashierId,
    reference: `VRS-${paymentId.toString().toUpperCase()}`,
  });

  const preview = await readClosurePreview(first.tourId);
  const result = await closeFromPreview(first.tourId, preview);

  assert.equal(preview.amountPaidInCentimes, 500_000);
  assert.equal(preview.remainingDueInCentimes, 250_000);
  assert.equal(result.closure.amountPaidInCentimes, 500_000);
  assert.equal(result.closure.remainingDueInCentimes, 250_000);
});

test('refuse la clôture si un champ allocations invalide masque des champs historiques', async () => {
  const tour = await insertCountedTour({ totalDueInCentimes: 100_000 });

  await database.collection('cashPayments').insertOne({
    _id: new ObjectId(),
    allocations: null,
    amountInCentimes: 100_000,
    confirmationKey: randomUUID(),
    currency: 'DZD',
    delivererId: tour.delivererId,
    reference: `VRS-${new ObjectId().toString().toUpperCase()}`,
    sourceTourCountingId: tour.countingId,
    tourId: tour.tourId,
  });

  const preview = await readClosurePreview(tour.tourId);

  assert.match(preview.errors.form, /versements enregistrés/u);
});

test('termine sans versement, y compris lorsque le montant dû est nul', async () => {
  for (const totalDueInCentimes of [750_000, 0]) {
    const tour = await insertCountedTour({ totalDueInCentimes });
    const preview = await readClosurePreview(tour.tourId);
    const result = await closeFromPreview(tour.tourId, preview);

    assert.equal(result.closure.status, TOUR_STATUS_CLOSED);
    assert.equal(result.closure.amountPaidInCentimes, 0);
    assert.equal(result.closure.remainingDueInCentimes, totalDueInCentimes);
  }

  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('refuse la clôture sans permission, sans état compté ou sans comptage définitif', async () => {
  const unauthorizedId = await createUser([
    'tours.read',
    CASH_READ_PERMISSION,
  ]);
  const counted = await insertCountedTour();
  const loaded = await insertCountedTour({ status: 'LOADED' });
  const missingCounting = await insertCountedTour({ includeCounting: false });
  const preview = await readClosurePreview(counted.tourId);

  await assert.rejects(
    closeFromPreview(counted.tourId, preview, unauthorizedId),
    (error) => error instanceof PermissionDeniedError
      && error.permission === TOUR_CLOSE_PERMISSION,
  );

  const loadedResult = await closeCountedTour({
    closedBy: closerId.toString(),
    expectedDigest: 'a'.repeat(64),
    tourId: loaded.tourId.toString(),
  });
  const missingCountingResult = await closeCountedTour({
    closedBy: closerId.toString(),
    expectedDigest: 'a'.repeat(64),
    tourId: missingCounting.tourId.toString(),
  });

  assert.match(loadedResult.errors.form, /tournée comptée/u);
  assert.match(missingCountingResult.errors.form, /comptage définitif/u);
  assert.equal((await database.collection('tours').findOne({
    _id: counted.tourId,
  })).status, TOUR_STATUS_COUNTED);
});

test('un livreur désactivé ne bloque pas la clôture', async () => {
  const tour = await insertCountedTour({ delivererActive: false });
  const preview = await readClosurePreview(tour.tourId);
  const result = await closeFromPreview(tour.tourId, preview);

  assert.equal(result.closure.status, TOUR_STATUS_CLOSED);
});

test('deux confirmations concurrentes conservent une seule date et un seul auteur', async () => {
  const secondCloserId = await createUser([
    TOUR_CLOSE_PERMISSION,
    'tours.read',
    CASH_READ_PERMISSION,
  ], 'second-responsable-cloture');
  const tour = await insertCountedTour();
  const preview = await readClosurePreview(tour.tourId);
  const [first, second] = await Promise.all([
    closeFromPreview(tour.tourId, preview),
    closeFromPreview(tour.tourId, preview, secondCloserId),
  ]);
  const stored = await database.collection('tours').findOne({
    _id: tour.tourId,
  });
  const unauthorizedId = await createUser([
    'tours.read',
    CASH_READ_PERMISSION,
  ], 'reprise-sans-cloture');

  assert.equal(first.replayed !== second.replayed, true);
  assert.equal(first.closure.closedAt, second.closure.closedAt);
  assert.equal(first.closure.closedBy, second.closure.closedBy);
  assert.equal(stored.status, TOUR_STATUS_CLOSED);
  assert.equal(stored.closedAt.toISOString(), first.closure.closedAt);
  assert.equal(stored.closedBy.toString(), first.closure.closedBy);
  await assert.rejects(
    closeFromPreview(tour.tourId, preview, unauthorizedId),
    (error) => error instanceof PermissionDeniedError
      && error.permission === TOUR_CLOSE_PERMISSION,
  );
});

test('refuse un récapitulatif devenu périmé après un encaissement', async () => {
  const tour = await insertCountedTour();
  const stalePreview = await readClosurePreview(tour.tourId);

  await recordPayment({ amount: '5000', tourId: tour.tourId });
  const coordinatedBeforeRefusal = await database.collection('tours').findOne({
    _id: tour.tourId,
  });
  const result = await closeFromPreview(tour.tourId, stalePreview);
  const refreshedPreview = await readClosurePreview(tour.tourId);
  const coordinatedAfterRefusal = await database.collection('tours').findOne({
    _id: tour.tourId,
  });

  assert.equal(result.stale, true);
  assert.match(result.errors.form, /montants ont changé/u);
  assert.equal(refreshedPreview.amountPaidInCentimes, 500_000);
  assert.notEqual(refreshedPreview.digest, stalePreview.digest);
  assert.equal(
    coordinatedAfterRefusal.cashPaymentReferenceVersion,
    coordinatedBeforeRefusal.cashPaymentReferenceVersion,
  );
  assert.equal((await database.collection('tours').findOne({
    _id: tour.tourId,
  })).status, TOUR_STATUS_COUNTED);
});

test('coordonne une clôture et un encaissement concurrents sur la tournée', async () => {
  const tour = await insertCountedTour();
  const preview = await readClosurePreview(tour.tourId);
  const [closure, payment] = await Promise.all([
    closeFromPreview(tour.tourId, preview),
    recordPayment({ amount: '5000', tourId: tour.tourId }),
  ]);
  const stored = await database.collection('tours').findOne({
    _id: tour.tourId,
  });

  assert.ok(payment.payment);
  if (closure.closure) {
    assert.equal(stored.status, TOUR_STATUS_CLOSED);
  } else {
    assert.equal(closure.stale, true);
    assert.equal(stored.status, TOUR_STATUS_COUNTED);
    const refreshedPreview = await readClosurePreview(tour.tourId);
    assert.equal(refreshedPreview.amountPaidInCentimes, 500_000);
  }
});

test('encaisse après clôture sans rouvrir et rejoue un versement antérieur sans doublon', async () => {
  const tour = await insertCountedTour();
  const confirmationKey = randomUUID();
  const firstPayment = await recordPayment({
    amount: '5000',
    confirmationKey,
    tourId: tour.tourId,
  });
  const preview = await readClosurePreview(tour.tourId);
  await closeFromPreview(tour.tourId, preview);
  const replay = await recordPayment({
    amount: '5000',
    confirmationKey,
    tourId: tour.tourId,
  });
  const finalPayment = await recordPayment({
    amount: '2500',
    tourId: tour.tourId,
  });
  const paymentPreview = await getTourPaymentPreview({
    tourId: tour.tourId.toString(),
    userId: cashierId.toString(),
  });
  const stored = await database.collection('tours').findOne({
    _id: tour.tourId,
  });

  assert.equal(replay.replayed, true);
  assert.equal(replay.payment.reference, firstPayment.payment.reference);
  assert.equal(finalPayment.remainingDueInCentimes, 0);
  assert.equal(paymentPreview.amountPaidInCentimes, 750_000);
  assert.equal(paymentPreview.remainingDueInCentimes, 0);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 2);
  assert.equal(stored.status, TOUR_STATUS_CLOSED);
});
