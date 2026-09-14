import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_cash_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const {
  calculateDelivererCashAllocationPreview,
} = await import('../lib/cash-payment-calculations.js');
const {
  CASH_PAYMENT_CREATE_PERMISSION,
  CASH_PAYMENT_MODE,
  CASH_READ_PERMISSION,
  buildCashJournalHref,
  buildCashRemaindersHref,
  createDelivererCashPaymentSummaryDigest,
  getDelivererCashSummary,
  getTourPaymentPreview,
  listCashJournalFilterOptions,
  listCashPayments,
  listCashRemainders,
  readCashJournalState,
  readCashRemaindersState,
  recordDelivererCashPayment,
  recordTourCashPayment,
} = await import('../lib/cash-payments.js');
const {
  CASH_CURRENCY,
  MAIN_CASH_REGISTER_CODE,
  MAIN_CASH_REGISTER_NAME,
  initializeMainCashRegister,
} = await import('../lib/cash-registers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  confirmTourCounting,
  getTourCountingSheet,
} = await import('../lib/tour-countings.js');
const { getTourClosurePreview } = await import('../lib/tour-closures.js');

let database;
let cashierId;

const createUser = async (permissions, username = `caisse-${randomUUID()}`) => {
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
      username,
    }),
  ]);

  return userId;
};

const insertCashRegister = async ({
  active = true,
  code = `TEST-${randomUUID()}`,
  currency = CASH_CURRENCY,
  name = 'Caisse de test',
} = {}) => {
  const cashRegisterId = new ObjectId();

  await database.collection('cashRegisters').insertOne({
    _id: cashRegisterId,
    active,
    code,
    createdAt: new Date(),
    currency,
    name,
  });

  return cashRegisterId;
};

const insertTour = async ({
  countedAt = new Date('2026-09-01T08:00:00.000Z'),
  deliverer = null,
  delivererActive = true,
  delivererCode: requestedDelivererCode,
  delivererName: requestedDelivererName,
  status = 'COUNTED',
  totalDueInCentimes = 750_000,
} = {}) => {
  const countingId = new ObjectId();
  const delivererId = deliverer?.delivererId ?? new ObjectId();
  const tourId = new ObjectId();
  const delivererCode = deliverer?.delivererCode
    ?? requestedDelivererCode
    ?? `LIV-${delivererId.toString().slice(-6)}`;
  const delivererName = deliverer?.delivererName
    ?? requestedDelivererName
    ?? 'Livreur caisse';
  const tourReference = `TRN-${tourId.toString().toUpperCase()}`;
  const insertions = [
    database.collection('tours').insertOne({
      _id: tourId,
      countingId,
      delivererCode,
      delivererId,
      delivererName,
      reference: tourReference,
      status,
    }),
    database.collection('tourCountings').insertOne({
      _id: countingId,
      countedAt,
      delivererId,
      lines: [{ amountDueInCentimes: totalDueInCentimes }],
      totalDueInCentimes,
      tourId,
    }),
  ];

  if (!deliverer) {
    insertions.push(database.collection('deliverers').insertOne({
      _id: delivererId,
      active: delivererActive,
      code: delivererCode,
      name: delivererName,
    }));
  }

  await Promise.all(insertions);

  return {
    countingId,
    delivererCode,
    delivererId,
    delivererName,
    tourId,
    tourReference,
  };
};

const submitPayment = async ({
  amount,
  cashRegisterId,
  confirmationKey = randomUUID(),
  expectedRemainingDueInCentimes,
  note = '',
  tourId,
  userId = cashierId,
}) => {
  let expectedRemaining = expectedRemainingDueInCentimes;

  if (!Number.isSafeInteger(expectedRemaining)) {
    const tour = await database.collection('tours').findOne({ _id: tourId });
    const counting = tour?.countingId
      ? await database.collection('tourCountings').findOne({
          _id: tour.countingId,
          tourId,
        })
      : null;
    const payments = await database.collection('cashPayments').find({
      tourId,
    }).toArray();
    const paid = payments.reduce((total, payment) =>
      payment.currency === CASH_CURRENCY
        && payment.sourceTourCountingId?.equals?.(tour?.countingId)
        && Number.isSafeInteger(payment.amountInCentimes)
        ? total + payment.amountInCentimes
        : total, 0);

    expectedRemaining = Number.isSafeInteger(counting?.totalDueInCentimes)
      ? Math.max(0, counting.totalDueInCentimes - paid)
      : 0;
  }

  return recordTourCashPayment({
    amount,
    confirmationKey,
    expectedCashRegisterId: cashRegisterId.toString(),
    expectedRemainingDueInCentimes: String(expectedRemaining),
    note,
    receivedBy: userId.toString(),
    tourId: tourId.toString(),
  });
};

const readDelivererRemainder = async (delivererId, userId = cashierId) => {
  const result = await listCashRemainders({
    pageSize: 100,
    userId: userId.toString(),
  });

  return result.remainders.find((remainder) =>
    remainder.deliverer.id === delivererId.toString()) ?? null;
};

const prepareDelivererPayment = async ({
  amount,
  cashRegisterId,
  delivererId,
  userId = cashierId,
}) => {
  const remainder = await readDelivererRemainder(delivererId, userId);
  const summary = calculateDelivererCashAllocationPreview({
    amount,
    blockingAnomalies: remainder?.blockingAnomalies ?? [],
    tours: remainder?.tours ?? [],
  });

  return {
    amount,
    confirmationKey: randomUUID(),
    delivererId: delivererId.toString(),
    expectedCashRegisterId: cashRegisterId.toString(),
    expectedSummary: summary,
    note: '',
    receivedBy: userId.toString(),
  };
};

const insertLoadedTour = async ({ deliverer, totalDueInCentimes }) => {
  const productId = new ObjectId();
  const reservationId = new ObjectId();
  const tourId = new ObjectId();

  await Promise.all([
    database.collection('products').insertOne({
      _id: productId,
      active: true,
      baseUnit: 'PIECE',
      code: `PRD-${productId.toString().slice(-6)}`,
      designation: 'Produit comptage concurrent',
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      delivererCode: deliverer.delivererCode,
      delivererId: deliverer.delivererId,
      delivererName: deliverer.delivererName,
      reference: `TRN-${tourId.toString().toUpperCase()}`,
      status: 'LOADED',
    }),
    database.collection('tourReservations').insertOne({
      _id: reservationId,
      baseUnit: 'PIECE',
      productCode: `PRD-${productId.toString().slice(-6)}`,
      productDesignation: 'Produit comptage concurrent',
      productId,
      quantityInBaseUnits: 1,
      salePriceAtLoading: {
        amountInCentimes: totalDueInCentimes,
        currency: CASH_CURRENCY,
        taxIncluded: true,
        unit: 'PIECE',
      },
      status: 'LOADED',
      tourId,
    }),
  ]);

  return { reservationId, tourId };
};

before(async () => {
  database = await getDatabase();
  cashierId = await createUser([
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
    'tours.close',
    'tours.read',
  ], 'caissier-test');
});

beforeEach(async () => {
  await Promise.all([
    database.collection('cashPayments').deleteMany({}),
    database.collection('cashRegisters').deleteMany({}),
    database.collection('deliverers').deleteMany({}),
    database.collection('products').deleteMany({}),
    database.collection('stockMovements').deleteMany({}),
    database.collection('tourCountings').deleteMany({}),
    database.collection('tourReservations').deleteMany({}),
    database.collection('tours').deleteMany({}),
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('initialise une unique Caisse principale active sans solde fictif', async () => {
  const first = await initializeMainCashRegister();
  const second = await initializeMainCashRegister();
  const cashRegister = await database.collection('cashRegisters').findOne({});

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.id, second.id);
  assert.equal(cashRegister.code, MAIN_CASH_REGISTER_CODE);
  assert.equal(cashRegister.name, MAIN_CASH_REGISTER_NAME);
  assert.equal(cashRegister.currency, CASH_CURRENCY);
  assert.equal(cashRegister.active, true);
  assert.equal(await database.collection('cashRegisters').countDocuments({}), 1);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
  assert.equal(await database.collection('cashMovements').countDocuments({}), 0);
  assert.equal('balanceInCentimes' in cashRegister, false);
});

test('enregistre 5 000 DA puis 2 500 DA et conserve les deux versements', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour();
  await database.collection('stockMovements').insertOne({
    _id: new ObjectId(),
    kind: 'TEST_STOCK',
    quantityDeltaInBaseUnits: 12,
  });
  const [countingBefore, stockBefore] = await Promise.all([
    database.collection('tourCountings').findOne({ _id: tour.countingId }),
    database.collection('stockMovements').find({}).toArray(),
  ]);
  const first = await submitPayment({
    amount: '5000',
    cashRegisterId: cashRegister.id,
    note: '  Premier versement  ',
    tourId: tour.tourId,
  });
  const second = await submitPayment({
    amount: '2500,00',
    cashRegisterId: cashRegister.id,
    tourId: tour.tourId,
  });
  const preview = await getTourPaymentPreview({
    tourId: tour.tourId.toString(),
    userId: cashierId.toString(),
  });
  const [payments, countingAfter, stockAfter, storedTour] = await Promise.all([
    database.collection('cashPayments').find({ tourId: tour.tourId })
      .sort({ receivedAt: 1 }).toArray(),
    database.collection('tourCountings').findOne({ _id: tour.countingId }),
    database.collection('stockMovements').find({}).toArray(),
    database.collection('tours').findOne({ _id: tour.tourId }),
  ]);
  const journal = await listCashPayments({ userId: cashierId.toString() });

  assert.equal(first.remainingDueInCentimes, 250_000);
  assert.equal(second.remainingDueInCentimes, 0);
  assert.equal(payments.length, 2);
  assert.deepEqual(payments.map(({ amountInCentimes }) => amountInCentimes), [
    500_000,
    250_000,
  ]);
  assert.match(payments[0].reference, /^VRS-[A-F\d]{24}$/u);
  assert.equal(payments[0].cashRegisterId.toString(), cashRegister.id);
  assert.equal(payments[0].cashRegisterName, MAIN_CASH_REGISTER_NAME);
  assert.equal(payments[0].delivererId.toString(), tour.delivererId.toString());
  assert.equal(payments[0].sourceTourCountingId.toString(), tour.countingId.toString());
  assert.equal(payments[0].currency, CASH_CURRENCY);
  assert.equal(payments[0].mode, CASH_PAYMENT_MODE);
  assert.equal(payments[0].note, 'Premier versement');
  assert.equal(payments[0].receivedBy.toString(), cashierId.toString());
  assert.ok(payments[0].receivedAt instanceof Date);
  assert.equal(preview.amountPaidInCentimes, 750_000);
  assert.equal(preview.remainingDueInCentimes, 0);
  assert.equal(preview.paymentCount, 2);
  assert.equal(preview.payments[0].receivedBy, 'caissier-test');
  assert.deepEqual(
    new Map(journal.payments.map((payment) => [
      payment.reference,
      payment.amountInCentimes,
    ])),
    new Map(preview.payments.map((payment) => [
      payment.reference,
      payment.amountInCentimes,
    ])),
  );
  assert.equal(storedTour.status, 'COUNTED');
  assert.deepEqual(countingAfter, countingBefore);
  assert.deepEqual(stockAfter, stockBefore);
});

test('lit ensemble un versement réparti et un versement unitaire historique sans multiplier le total', async () => {
  const cashRegister = await initializeMainCashRegister();
  const firstTour = await insertTour({
    delivererCode: 'LIV-MIXTE',
    delivererName: 'Livreur mixte',
    totalDueInCentimes: 200_000,
  });
  const secondTour = await insertTour({
    deliverer: firstTour,
    totalDueInCentimes: 400_000,
  });
  const paymentId = new ObjectId();
  const paymentReference = `VRS-${paymentId.toString().toUpperCase()}`;

  await database.collection('cashPayments').insertOne({
    _id: paymentId,
    allocations: [
      {
        allocatedAmountInCentimes: 200_000,
        sourceTourCountingId: firstTour.countingId,
        tourId: firstTour.tourId,
        tourReference: firstTour.tourReference,
      },
      {
        allocatedAmountInCentimes: 300_000,
        sourceTourCountingId: secondTour.countingId,
        tourId: secondTour.tourId,
        tourReference: secondTour.tourReference,
      },
    ],
    amountInCentimes: 500_000,
    cashRegisterCode: cashRegister.code,
    cashRegisterId: new ObjectId(cashRegister.id),
    cashRegisterName: cashRegister.name,
    confirmationKey: randomUUID(),
    currency: CASH_CURRENCY,
    delivererCode: firstTour.delivererCode,
    delivererId: firstTour.delivererId,
    delivererName: firstTour.delivererName,
    mode: 'CASH',
    receivedAt: new Date(),
    receivedBy: cashierId,
    reference: paymentReference,
  });

  const [firstPreview, secondPreview, initialJournal, initialRemainders] =
    await Promise.all([
      getTourPaymentPreview({
        tourId: firstTour.tourId.toString(),
        userId: cashierId.toString(),
      }),
      getTourPaymentPreview({
        tourId: secondTour.tourId.toString(),
        userId: cashierId.toString(),
      }),
      listCashPayments({ userId: cashierId.toString() }),
      listCashRemainders({ userId: cashierId.toString() }),
    ]);
  const [initialRemainder] = initialRemainders.remainders;

  assert.equal(initialJournal.totalItems, 1);
  assert.equal(initialJournal.totalAmountInCentimes, 500_000);
  assert.equal(initialJournal.payments[0].amountInCentimes, 500_000);
  assert.deepEqual(
    initialJournal.payments[0].allocations.map((allocation) =>
      allocation.amountInCentimes),
    [200_000, 300_000],
  );
  assert.equal(firstPreview.amountPaidInCentimes, 200_000);
  assert.equal(firstPreview.payments[0].amountInCentimes, 200_000);
  assert.equal(secondPreview.amountPaidInCentimes, 300_000);
  assert.equal(secondPreview.payments[0].amountInCentimes, 300_000);
  assert.equal(initialRemainder.remainingDueInCentimes, 100_000);
  assert.equal(firstPreview.remainingDueInCentimes, 0);
  assert.equal(
    initialRemainder.tours.find(({ id }) =>
      id === secondTour.tourId.toString()).remainingDueInCentimes,
    100_000,
  );

  const unitPayment = await submitPayment({
    amount: '500',
    cashRegisterId: cashRegister.id,
    expectedRemainingDueInCentimes: 100_000,
    tourId: secondTour.tourId,
  });
  const [storedUnitPayment, finalJournal, finalPreview, indexes] = await Promise.all([
    database.collection('cashPayments').findOne({
      reference: unitPayment.payment.reference,
    }),
    listCashPayments({ userId: cashierId.toString() }),
    getTourPaymentPreview({
      tourId: secondTour.tourId.toString(),
      userId: cashierId.toString(),
    }),
    database.collection('cashPayments').indexes(),
  ]);

  assert.equal(Object.hasOwn(storedUnitPayment, 'allocations'), false);
  assert.equal(finalJournal.totalItems, 2);
  assert.equal(finalJournal.totalAmountInCentimes, 550_000);
  assert.equal(finalPreview.amountPaidInCentimes, 350_000);
  assert.equal(finalPreview.remainingDueInCentimes, 50_000);
  assert.ok(indexes.some(({ name }) => name === 'cash_payment_tour_history'));
  assert.ok(indexes.some(
    ({ name }) => name === 'cash_payment_allocation_tour_history',
  ));
});

test('rejoue une demande identique après solde nul sans doublon', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour({ totalDueInCentimes: 250_000 });
  const confirmationKey = randomUUID();
  const request = {
    amount: '2500',
    cashRegisterId: cashRegister.id,
    confirmationKey,
    note: 'Solde',
    tourId: tour.tourId,
  };
  const first = await submitPayment(request);
  const replay = await submitPayment(request);
  const conflictingReplay = await submitPayment({
    ...request,
    amount: '1000',
  });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.payment.reference, first.payment.reference);
  assert.match(conflictingReplay.errors.form, /contenu différent/u);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});

test('une double soumission concurrente identique ne crée qu’un versement', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour();
  const request = {
    amount: '5000',
    cashRegisterId: cashRegister.id,
    confirmationKey: randomUUID(),
    tourId: tour.tourId,
  };
  const [first, second] = await Promise.all([
    submitPayment(request),
    submitPayment(request),
  ]);

  assert.equal(first.payment.reference, second.payment.reference);
  assert.equal(first.replayed !== second.replayed, true);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});

test('sérialise deux versements concurrents qui dépasseraient ensemble le reste', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour();
  const [first, second] = await Promise.all([
    submitPayment({
      amount: '5000',
      cashRegisterId: cashRegister.id,
      expectedRemainingDueInCentimes: 750_000,
      tourId: tour.tourId,
    }),
    submitPayment({
      amount: '5000',
      cashRegisterId: cashRegister.id,
      expectedRemainingDueInCentimes: 750_000,
      tourId: tour.tourId,
    }),
  ]);
  const accepted = first.payment ? first : second;
  const refused = first.errors ? first : second;
  const payments = await database.collection('cashPayments').find({
    tourId: tour.tourId,
  }).toArray();

  assert.ok(accepted.payment);
  assert.match(refused.errors.form, /reste de cette tournée a changé/u);
  assert.equal(refused.stale, true);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amountInCentimes, 500_000);
});

test('refuse sans les permissions financières nécessaires', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour();
  const withoutRead = await createUser([
    CASH_PAYMENT_CREATE_PERMISSION,
    'tours.read',
  ]);
  const withoutCreate = await createUser([
    CASH_READ_PERMISSION,
    'tours.read',
  ]);

  await assert.rejects(
    submitPayment({
      amount: '1000',
      cashRegisterId: cashRegister.id,
      tourId: tour.tourId,
      userId: withoutRead,
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
  await assert.rejects(
    submitPayment({
      amount: '1000',
      cashRegisterId: cashRegister.id,
      tourId: tour.tourId,
      userId: withoutCreate,
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_PAYMENT_CREATE_PERMISSION,
  );
  await assert.rejects(
    getTourPaymentPreview({
      tourId: tour.tourId.toString(),
      userId: withoutRead.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('refuse les montants invalides, la note trop longue et une tournée non comptée', async () => {
  const cashRegister = await initializeMainCashRegister();
  const countedTour = await insertTour();
  const loadedTour = await insertTour({ status: 'LOADED' });

  for (const amount of ['', '0', '-1', '1,001', '7500,01']) {
    const result = await submitPayment({
      amount,
      cashRegisterId: cashRegister.id,
      tourId: countedTour.tourId,
    });

    assert.ok(result.errors.amount);
  }

  const longNote = await submitPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    note: 'a'.repeat(501),
    tourId: countedTour.tourId,
  });
  const nonCounted = await submitPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    tourId: loadedTour.tourId,
  });

  assert.ok(longNote.errors.note);
  assert.match(nonCounted.errors.form, /n’est pas comptée/u);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('refuse sans caisse active ou avec plusieurs caisses compatibles', async () => {
  const tour = await insertTour();
  const inactiveCashRegisterId = await insertCashRegister({ active: false });
  const noActive = await submitPayment({
    amount: '1000',
    cashRegisterId: inactiveCashRegisterId,
    tourId: tour.tourId,
  });

  assert.match(noActive.errors.form, /n’est plus active/u);

  const firstActiveId = await insertCashRegister({ code: 'ACTIVE-1' });
  await insertCashRegister({ code: 'ACTIVE-2' });
  const multiplePreview = await getTourPaymentPreview({
    tourId: tour.tourId.toString(),
    userId: cashierId.toString(),
  });
  const multiple = await submitPayment({
    amount: '1000',
    cashRegisterId: firstActiveId,
    tourId: tour.tourId,
  });

  assert.match(multiplePreview.errors.cashRegister, /Plusieurs caisses/u);
  assert.match(multiple.errors.form, /Plusieurs caisses/u);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('refuse une caisse du récapitulatif devenue indisponible sans réaffecter', async () => {
  const initialCashRegister = await initializeMainCashRegister();
  const tour = await insertTour();
  const preview = await getTourPaymentPreview({
    tourId: tour.tourId.toString(),
    userId: cashierId.toString(),
  });

  await database.collection('cashRegisters').updateOne(
    { _id: new ObjectId(initialCashRegister.id) },
    { $set: { active: false } },
  );
  const replacementId = await insertCashRegister({ code: 'REMPLACEMENT' });
  const result = await submitPayment({
    amount: '1000',
    cashRegisterId: preview.cashRegister.id,
    tourId: tour.tourId,
  });

  assert.match(result.errors.form, /caisse du récapitulatif/u);
  assert.equal(result.stale, true);
  assert.equal(await database.collection('cashPayments').countDocuments({
    cashRegisterId: replacementId,
  }), 0);
});

test('autorise le versement après désactivation du livreur', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour({ delivererActive: false });
  const result = await submitPayment({
    amount: '5000',
    cashRegisterId: cashRegister.id,
    tourId: tour.tourId,
  });

  assert.ok(result.payment.reference);
  assert.equal(result.remainingDueInCentimes, 250_000);
});

test('autorise le versement d’une tournée terminée sans la rouvrir', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour({ status: 'CLOSED' });
  const result = await submitPayment({
    amount: '5000',
    cashRegisterId: cashRegister.id,
    tourId: tour.tourId,
  });
  const preview = await getTourPaymentPreview({
    tourId: tour.tourId.toString(),
    userId: cashierId.toString(),
  });
  const storedTour = await database.collection('tours').findOne({
    _id: tour.tourId,
  });

  assert.equal(result.remainingDueInCentimes, 250_000);
  assert.equal(preview.amountPaidInCentimes, 500_000);
  assert.equal(preview.remainingDueInCentimes, 250_000);
  assert.equal(storedTour.status, 'CLOSED');
});

test('lit une seule fois les versements comptés et terminés sans dépendre des statuts actifs', async () => {
  const cashRegister = await initializeMainCashRegister();
  const countedTour = await insertTour();
  const closedTour = await insertTour({ status: 'CLOSED' });

  await submitPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    note: 'Versement compté',
    tourId: countedTour.tourId,
  });
  await submitPayment({
    amount: '2500',
    cashRegisterId: cashRegister.id,
    tourId: closedTour.tourId,
  });
  await Promise.all([
    database.collection('cashRegisters').updateOne(
      { _id: new ObjectId(cashRegister.id) },
      { $set: { active: false } },
    ),
    database.collection('deliverers').updateMany(
      { _id: { $in: [countedTour.delivererId, closedTour.delivererId] } },
      { $set: { active: false } },
    ),
  ]);
  const before = {
    cashPayments: await database.collection('cashPayments').countDocuments({}),
    cashRegisters: await database.collection('cashRegisters').countDocuments({}),
    deliverers: await database.collection('deliverers').countDocuments({}),
    tours: await database.collection('tours').countDocuments({}),
  };
  const [journal, options] = await Promise.all([
    listCashPayments({ userId: cashierId.toString() }),
    listCashJournalFilterOptions({ userId: cashierId.toString() }),
  ]);
  const after = {
    cashPayments: await database.collection('cashPayments').countDocuments({}),
    cashRegisters: await database.collection('cashRegisters').countDocuments({}),
    deliverers: await database.collection('deliverers').countDocuments({}),
    tours: await database.collection('tours').countDocuments({}),
  };

  assert.equal(journal.totalItems, 2);
  assert.equal(journal.totalAmountInCentimes, 350_000);
  assert.deepEqual(
    new Set(journal.payments.map(({ tour }) => tour.id)),
    new Set([countedTour.tourId.toString(), closedTour.tourId.toString()]),
  );
  assert.equal(journal.payments.find(
    ({ tour }) => tour.id === countedTour.tourId.toString(),
  ).note, 'Versement compté');
  assert.equal(options.deliverers.length, 2);
  assert.equal(journal.cashRegisters[0].id, cashRegister.id);
  assert.deepEqual(after, before);
  assert.equal(await database.collection('cashMovements').countDocuments({}), 0);
});

test('filtre le journal, applique les journées d’Alger et totalise toute la sélection', async () => {
  const cashRegister = await initializeMainCashRegister();
  const firstTour = await insertTour({ totalDueInCentimes: 1_000_000 });
  const secondTour = await insertTour({ totalDueInCentimes: 1_000_000 });
  const receivedAtValues = [
    new Date('2026-09-13T22:59:59.999Z'),
    new Date('2026-09-14T12:00:00.000Z'),
    new Date('2026-09-14T12:00:00.000Z'),
    new Date('2026-09-14T23:00:00.000Z'),
  ];
  const references = [];

  for (const [index, receivedAt] of receivedAtValues.entries()) {
    const tour = index === 2 ? secondTour : firstTour;
    const result = await submitPayment({
      amount: String((index + 1) * 100),
      cashRegisterId: cashRegister.id,
      tourId: tour.tourId,
    });
    references.push(result.payment.reference);

    await database.collection('cashPayments').updateOne(
      { reference: result.payment.reference },
      { $set: { receivedAt } },
    );
  }

  const dateResult = await listCashPayments({
    dateFrom: '2026-09-14',
    dateTo: '2026-09-14',
    pageSize: 1,
    userId: cashierId.toString(),
  });
  const delivererResult = await listCashPayments({
    delivererId: secondTour.delivererId.toString(),
    userId: cashierId.toString(),
  });
  const secondPage = await listCashPayments({
    dateFrom: '2026-09-14',
    dateTo: '2026-09-14',
    page: 2,
    pageSize: 1,
    userId: cashierId.toString(),
  });
  const searchResult = await listCashPayments({
    query: secondTour.delivererCode.toLocaleLowerCase('fr'),
    userId: cashierId.toString(),
  });
  const namedSearchResult = await listCashPayments({
    query: 'Livreur caisse',
    userId: cashierId.toString(),
  });

  assert.equal(dateResult.totalItems, 2);
  assert.equal(dateResult.totalPages, 2);
  assert.equal(dateResult.payments.length, 1);
  assert.equal(dateResult.payments[0].reference, references[2]);
  assert.equal(dateResult.totalAmountInCentimes, 50_000);
  assert.equal(secondPage.payments[0].reference, references[1]);
  assert.equal(secondPage.totalAmountInCentimes, 50_000);
  assert.equal(delivererResult.totalItems, 1);
  assert.equal(delivererResult.totalAmountInCentimes, 30_000);
  assert.equal(searchResult.totalItems, 1);
  assert.equal(namedSearchResult.totalItems, 4);
});

test('recherche une référence, conserve les filtres et refuse la lecture sans cash.read', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour();
  const payment = await submitPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    tourId: tour.tourId,
  });
  const withoutCashRead = await createUser(['tours.read', 'deliverers.read']);
  const state = readCashJournalState({
    au: '2026-09-30',
    du: '2026-09-01',
    livreur: tour.delivererId.toString(),
    page: '2',
    q: payment.payment.reference,
  });
  const href = buildCashJournalHref(state);
  const result = await listCashPayments({
    query: payment.payment.reference,
    userId: cashierId.toString(),
  });

  assert.equal(result.totalItems, 1);
  assert.match(href, /^\/caisse\?/u);
  assert.match(href, /q=VRS-/u);
  assert.match(href, /livreur=/u);
  assert.match(href, /du=2026-09-01/u);
  assert.match(href, /au=2026-09-30/u);
  assert.match(href, /page=2/u);
  await assert.rejects(
    listCashPayments({ userId: withoutCashRead.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
  await assert.rejects(
    listCashJournalFilterOptions({ userId: withoutCashRead.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
});

test('calcule les restes par livreur sans doubler le dû et les actualise après versement', async () => {
  const cashRegister = await initializeMainCashRegister();
  const firstAhmedTour = await insertTour({
    delivererActive: false,
    delivererCode: 'LIV-AHMED',
    delivererName: 'Ahmed',
    totalDueInCentimes: 750_000,
  });
  const secondAhmedTour = await insertTour({
    deliverer: firstAhmedTour,
    status: 'CLOSED',
    totalDueInCentimes: 300_000,
  });
  const unpaidTour = await insertTour({
    delivererCode: 'LIV-IMPAYE',
    delivererName: 'Livreur sans versement',
    totalDueInCentimes: 120_000,
  });
  const settledTour = await insertTour({ totalDueInCentimes: 100_000 });
  await insertTour({ totalDueInCentimes: 0 });
  await insertTour({ status: 'PREPARATION', totalDueInCentimes: 900_000 });
  await insertTour({ status: 'LOADED', totalDueInCentimes: 800_000 });

  await submitPayment({
    amount: '3000',
    cashRegisterId: cashRegister.id,
    tourId: firstAhmedTour.tourId,
  });
  await submitPayment({
    amount: '2000',
    cashRegisterId: cashRegister.id,
    tourId: firstAhmedTour.tourId,
  });
  await submitPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    tourId: secondAhmedTour.tourId,
  });
  await submitPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    tourId: settledTour.tourId,
  });
  const before = {
    cashPayments: await database.collection('cashPayments').countDocuments({}),
    deliverers: await database.collection('deliverers').countDocuments({}),
    tourCountings: await database.collection('tourCountings').countDocuments({}),
    tours: await database.collection('tours').countDocuments({}),
  };
  const initial = await listCashRemainders({
    userId: cashierId.toString(),
  });
  const afterRead = {
    cashPayments: await database.collection('cashPayments').countDocuments({}),
    deliverers: await database.collection('deliverers').countDocuments({}),
    tourCountings: await database.collection('tourCountings').countDocuments({}),
    tours: await database.collection('tours').countDocuments({}),
  };
  const ahmed = initial.remainders.find(
    ({ deliverer }) => deliverer.id === firstAhmedTour.delivererId.toString(),
  );
  const unpaid = initial.remainders.find(
    ({ deliverer }) => deliverer.id === unpaidTour.delivererId.toString(),
  );

  assert.equal(initial.anomalyCount, 0);
  assert.equal(initial.cashRegister.id, cashRegister.id);
  assert.equal(initial.cashRegisterError, null);
  assert.equal(initial.totalItems, 2);
  assert.equal(initial.totalRemainingDueInCentimes, 570_000);
  assert.equal(ahmed.deliverer.code, 'LIV-AHMED');
  assert.equal(ahmed.tourCount, 2);
  assert.equal(ahmed.remainingDueInCentimes, 450_000);
  assert.deepEqual(
    ahmed.tours.map((tour) => ({
      due: tour.amountDueInCentimes,
      paid: tour.amountPaidInCentimes,
      remaining: tour.remainingDueInCentimes,
      status: tour.status,
    })).sort((first, second) => first.due - second.due),
    [
      { due: 300_000, paid: 100_000, remaining: 200_000, status: 'CLOSED' },
      { due: 750_000, paid: 500_000, remaining: 250_000, status: 'COUNTED' },
    ],
  );
  assert.equal(unpaid.remainingDueInCentimes, 120_000);
  assert.equal(unpaid.tours[0].amountPaidInCentimes, 0);
  assert.deepEqual(afterRead, before);

  await submitPayment({
    amount: '500',
    cashRegisterId: cashRegister.id,
    tourId: firstAhmedTour.tourId,
  });
  const updated = await listCashRemainders({
    userId: cashierId.toString(),
  });
  const updatedAhmed = updated.remainders.find(
    ({ deliverer }) => deliverer.id === firstAhmedTour.delivererId.toString(),
  );

  assert.equal(updatedAhmed.remainingDueInCentimes, 400_000);
  assert.equal(updated.totalRemainingDueInCentimes, 520_000);
});

test('synthétise toutes les tournées comptées avec versements anciens et affectations explicites sans écriture', async () => {
  const cashRegister = await initializeMainCashRegister();
  const first = await insertTour({
    delivererActive: false,
    delivererCode: 'LIV-SYNTHESE',
    delivererName: 'Livreur synthèse',
    status: 'CLOSED',
    totalDueInCentimes: 200_000,
  });
  const second = await insertTour({
    countedAt: new Date('2026-09-02T08:00:00.000Z'),
    deliverer: first,
    status: 'CLOSED',
    totalDueInCentimes: 400_000,
  });

  await insertTour({
    deliverer: first,
    status: 'PREPARATION',
    totalDueInCentimes: 900_000,
  });
  await insertTour({
    deliverer: first,
    status: 'LOADED',
    totalDueInCentimes: 800_000,
  });

  for (let index = 0; index < 3; index += 1) {
    await insertTour({
      delivererCode: `LIV-PAGE-${index}`,
      totalDueInCentimes: 100_000,
    });
  }

  const globalRequest = await prepareDelivererPayment({
    amount: '5000',
    cashRegisterId: cashRegister.id,
    delivererId: first.delivererId,
  });

  await recordDelivererCashPayment(globalRequest);

  const beforePartialRead = {
    cashPayments: await database.collection('cashPayments').countDocuments({}),
    deliverers: await database.collection('deliverers').countDocuments({}),
    tourCountings: await database.collection('tourCountings').countDocuments({}),
    tours: await database.collection('tours').countDocuments({}),
  };
  const partial = await getDelivererCashSummary({
    delivererId: first.delivererId.toString(),
    userId: cashierId.toString(),
  });
  const afterPartialRead = {
    cashPayments: await database.collection('cashPayments').countDocuments({}),
    deliverers: await database.collection('deliverers').countDocuments({}),
    tourCountings: await database.collection('tourCountings').countDocuments({}),
    tours: await database.collection('tours').countDocuments({}),
  };

  assert.deepEqual(partial, {
    amountDueInCentimes: 600_000,
    amountPaidInCentimes: 500_000,
    anomalies: [],
    countedTourCount: 2,
    reliable: true,
    remainingDueInCentimes: 100_000,
  });
  assert.deepEqual(afterPartialRead, beforePartialRead);

  await submitPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    expectedRemainingDueInCentimes: 100_000,
    tourId: second.tourId,
  });
  await listCashRemainders({
    page: 99,
    pageSize: 1,
    query: 'aucun résultat',
    userId: cashierId.toString(),
  });

  const beforeSettledRead = await database.collection('cashPayments')
    .countDocuments({});
  const settled = await getDelivererCashSummary({
    delivererId: first.delivererId.toString(),
    userId: cashierId.toString(),
  });

  assert.deepEqual(settled, {
    amountDueInCentimes: 600_000,
    amountPaidInCentimes: 600_000,
    anomalies: [],
    countedTourCount: 2,
    reliable: true,
    remainingDueInCentimes: 0,
  });
  assert.equal(
    await database.collection('cashPayments').countDocuments({}),
    beforeSettledRead,
  );
  assert.equal(
    await database.collection('cashPayments').countDocuments({
      allocations: { $exists: false },
    }),
    1,
  );
  assert.equal(
    await database.collection('cashPayments').countDocuments({
      allocations: { $exists: true },
    }),
    1,
  );
});

test('distingue l’absence de comptage, bloque les anomalies et exige cash.read', async () => {
  const uncounted = await insertTour({
    delivererCode: 'LIV-SANS-COMPTAGE',
    delivererName: 'Livreur sans comptage',
    status: 'PREPARATION',
  });

  await insertTour({
    deliverer: uncounted,
    status: 'LOADED',
  });

  const empty = await getDelivererCashSummary({
    delivererId: uncounted.delivererId.toString(),
    userId: cashierId.toString(),
  });
  const anomalousTour = await insertTour({
    delivererCode: 'LIV-SYNTHESE-ANOMALIE',
    totalDueInCentimes: 300_000,
  });

  await database.collection('tourCountings').deleteOne({
    _id: anomalousTour.countingId,
  });

  const anomalous = await getDelivererCashSummary({
    delivererId: anomalousTour.delivererId.toString(),
    userId: cashierId.toString(),
  });
  const delivererReaderId = await createUser(['deliverers.read']);

  assert.deepEqual(empty, {
    amountDueInCentimes: null,
    amountPaidInCentimes: null,
    anomalies: [],
    countedTourCount: 0,
    reliable: true,
    remainingDueInCentimes: null,
  });
  assert.equal(anomalous.reliable, false);
  assert.equal(anomalous.amountDueInCentimes, null);
  assert.equal(anomalous.amountPaidInCentimes, null);
  assert.equal(anomalous.remainingDueInCentimes, null);
  assert.deepEqual(anomalous.anomalies, [{
    code: 'MISSING_COUNTING',
    label: 'comptage définitif introuvable',
    tourReference: anomalousTour.tourReference,
  }]);
  await assert.rejects(
    getDelivererCashSummary({
      delivererId: uncounted.delivererId.toString(),
      userId: delivererReaderId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
});

test('charge toutes les tournées éligibles avec la vraie date de comptage sans écriture', async () => {
  await initializeMainCashRegister();
  const oldest = await insertTour({
    countedAt: new Date('2026-08-01T09:00:00.000Z'),
    delivererActive: false,
    delivererCode: 'LIV-GLOBAL',
    delivererName: 'Livreur global',
    status: 'CLOSED',
    totalDueInCentimes: 200_000,
  });
  await insertTour({
    countedAt: new Date('2026-08-03T09:00:00.000Z'),
    deliverer: oldest,
    totalDueInCentimes: 400_000,
  });
  await insertTour({
    countedAt: new Date('2026-08-02T09:00:00.000Z'),
    deliverer: oldest,
    totalDueInCentimes: 300_000,
  });
  await insertTour({
    delivererCode: 'LIV-AUTRE',
    delivererName: 'Autre livreur',
    totalDueInCentimes: 100_000,
  });
  const before = {
    cashPayments: await database.collection('cashPayments').countDocuments({}),
    tourCountings: await database.collection('tourCountings').countDocuments({}),
    tours: await database.collection('tours').countDocuments({}),
  };
  const result = await listCashRemainders({
    pageSize: 1,
    query: 'Livreur global',
    userId: cashierId.toString(),
  });
  const after = {
    cashPayments: await database.collection('cashPayments').countDocuments({}),
    tourCountings: await database.collection('tourCountings').countDocuments({}),
    tours: await database.collection('tours').countDocuments({}),
  };
  const [remainder] = result.remainders;

  assert.equal(result.totalItems, 1);
  assert.equal(remainder.tourCount, 3);
  assert.equal(remainder.remainingDueInCentimes, 900_000);
  assert.deepEqual(
    new Set(remainder.tours.map((tour) => tour.status)),
    new Set(['COUNTED', 'CLOSED']),
  );
  assert.deepEqual(
    remainder.tours.map((tour) => tour.countedAt).sort(),
    [
      '2026-08-01T09:00:00.000Z',
      '2026-08-02T09:00:00.000Z',
      '2026-08-03T09:00:00.000Z',
    ],
  );
  assert.deepEqual(remainder.blockingAnomalies, []);
  assert.deepEqual(after, before);
});

test('bloque la prévisualisation globale si une tournée du livreur est incohérente', async () => {
  const valid = await insertTour({
    delivererCode: 'LIV-ANOMALIE-GLOBALE',
    delivererName: 'Livreur avec anomalie',
    totalDueInCentimes: 200_000,
  });
  const invalidCounting = await insertTour({
    deliverer: valid,
    totalDueInCentimes: 300_000,
  });
  await insertTour({
    countedAt: null,
    deliverer: valid,
    totalDueInCentimes: 400_000,
  });

  await database.collection('tourCountings').updateOne(
    { _id: invalidCounting.countingId },
    { $set: { totalDueInCentimes: '300000' } },
  );
  const result = await listCashRemainders({
    query: 'LIV-ANOMALIE-GLOBALE',
    userId: cashierId.toString(),
  });
  const [remainder] = result.remainders;

  assert.equal(remainder.remainingDueInCentimes, 600_000);
  assert.deepEqual(
    new Set(remainder.blockingAnomalies.map((anomaly) => anomaly.code)),
    new Set(['INVALID_COUNTING', 'MISSING_COUNTING_DATE']),
  );
  assert.deepEqual(
    new Set(remainder.blockingAnomalies.map(
      (anomaly) => anomaly.tourReference,
    )),
    new Set([
      invalidCounting.tourReference,
      remainder.tours.find((tour) => tour.countedAt === null).reference,
    ]),
  );
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('recherche et pagine les restes indépendamment des filtres du journal avec cash.read seul', async () => {
  const atlas = await insertTour({
    delivererCode: 'LIV-ATLAS',
    delivererName: 'Atlas Alger',
    totalDueInCentimes: 100_000,
  });
  await insertTour({
    delivererCode: 'LIV-BETA',
    delivererName: 'Beta Oran',
    totalDueInCentimes: 200_000,
  });
  await insertTour({
    delivererCode: 'LIV-GAMMA',
    delivererName: 'Gamma Sétif',
    totalDueInCentimes: 300_000,
  });
  const cashReadOnly = await createUser([CASH_READ_PERMISSION]);
  const withoutCashRead = await createUser(['tours.read', 'deliverers.read']);
  const state = readCashRemaindersState({
    au: '2026-09-30',
    du: '2026-09-01',
    livreur: new ObjectId().toString(),
    page: '9',
    q: 'VRS-INEXISTANT',
    restePage: '2',
    resteRecherche: 'Atlas',
  });
  const firstPage = await listCashRemainders({
    pageSize: 1,
    userId: cashReadOnly.toString(),
  });
  const secondPage = await listCashRemainders({
    page: 2,
    pageSize: 1,
    userId: cashReadOnly.toString(),
  });
  const search = await listCashRemainders({
    query: 'atlas alger',
    userId: cashReadOnly.toString(),
  });
  const href = buildCashRemaindersHref({
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    delivererId: atlas.delivererId.toString(),
    journalPage: 3,
    journalQuery: 'VRS-TEST',
    page: 2,
    query: 'Atlas',
  });

  assert.deepEqual(state, { page: 2, query: 'Atlas' });
  assert.equal(firstPage.totalItems, 3);
  assert.equal(firstPage.totalPages, 3);
  assert.equal(firstPage.totalRemainingDueInCentimes, 600_000);
  assert.equal(firstPage.remainders.length, 1);
  assert.equal(secondPage.remainders.length, 1);
  assert.notEqual(
    firstPage.remainders[0].deliverer.id,
    secondPage.remainders[0].deliverer.id,
  );
  assert.equal(search.totalItems, 1);
  assert.equal(search.totalRemainingDueInCentimes, 100_000);
  assert.equal(search.remainders[0].deliverer.id, atlas.delivererId.toString());
  assert.match(href, /q=VRS-TEST/u);
  assert.match(href, /livreur=/u);
  assert.match(href, /du=2026-09-01/u);
  assert.match(href, /au=2026-09-30/u);
  assert.match(href, /page=3/u);
  assert.match(href, /resteRecherche=Atlas/u);
  assert.match(href, /restePage=2/u);
  await assert.rejects(
    listCashRemainders({ userId: withoutCashRead.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
});

test('signale les comptages et versements incohérents sans fabriquer de reste', async () => {
  const missingCounting = await insertTour({ totalDueInCentimes: 100_000 });
  const invalidCounting = await insertTour({ totalDueInCentimes: 200_000 });
  const invalidPayment = await insertTour({ totalDueInCentimes: 300_000 });
  const overpaid = await insertTour({ totalDueInCentimes: 400_000 });

  await Promise.all([
    database.collection('tourCountings').deleteOne({
      _id: missingCounting.countingId,
    }),
    database.collection('tourCountings').updateOne(
      { _id: invalidCounting.countingId },
      { $set: { totalDueInCentimes: '200000' } },
    ),
    database.collection('cashPayments').insertOne({
      _id: new ObjectId(),
      amountInCentimes: 100_000,
      confirmationKey: randomUUID(),
      currency: 'EUR',
      reference: `VRS-${new ObjectId().toString().toUpperCase()}`,
      sourceTourCountingId: invalidPayment.countingId,
      tourId: invalidPayment.tourId,
    }),
    database.collection('cashPayments').insertOne({
      _id: new ObjectId(),
      amountInCentimes: 450_000,
      confirmationKey: randomUUID(),
      currency: CASH_CURRENCY,
      reference: `VRS-${new ObjectId().toString().toUpperCase()}`,
      sourceTourCountingId: overpaid.countingId,
      tourId: overpaid.tourId,
    }),
  ]);
  const result = await listCashRemainders({
    userId: cashierId.toString(),
  });

  assert.equal(result.totalItems, 0);
  assert.equal(result.totalRemainingDueInCentimes, 0);
  assert.equal(result.anomalyCount, 4);
  assert.deepEqual(
    new Set(result.anomalies.map(({ code }) => code)),
    new Set([
      'INVALID_COUNTING',
      'INVALID_PAYMENTS',
      'MISSING_COUNTING',
      'OVERPAID',
    ]),
  );
});

test('signale les affectations explicites invalides sans utiliser leur repli historique', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tours = await Promise.all([
    insertTour({
      delivererCode: 'LIV-ALLOC-NULL',
      delivererName: 'Allocations nulles',
      totalDueInCentimes: 100_000,
    }),
    insertTour({
      delivererCode: 'LIV-ALLOC-VIDE',
      delivererName: 'Allocations vides',
      totalDueInCentimes: 100_000,
    }),
    insertTour({
      delivererCode: 'LIV-ALLOC-SOMME',
      delivererName: 'Somme incohérente',
      totalDueInCentimes: 100_000,
    }),
    insertTour({
      delivererCode: 'LIV-ALLOC-DOUBLON',
      delivererName: 'Tournée dupliquée',
      totalDueInCentimes: 100_000,
    }),
    insertTour({
      delivererCode: 'LIV-ALLOC-COMPTAGE',
      delivererName: 'Comptage incohérent',
      totalDueInCentimes: 100_000,
    }),
  ]);
  const explicitAllocations = [
    null,
    [],
    [{
      allocatedAmountInCentimes: 50_000,
      sourceTourCountingId: tours[2].countingId,
      tourId: tours[2].tourId,
    }],
    [
      {
        allocatedAmountInCentimes: 50_000,
        sourceTourCountingId: tours[3].countingId,
        tourId: tours[3].tourId,
      },
      {
        allocatedAmountInCentimes: 50_000,
        sourceTourCountingId: tours[3].countingId,
        tourId: tours[3].tourId,
      },
    ],
    [{
      allocatedAmountInCentimes: 100_000,
      sourceTourCountingId: new ObjectId(),
      tourId: tours[4].tourId,
    }],
  ];

  await database.collection('cashPayments').insertMany(tours.map((tour, index) => ({
    _id: new ObjectId(),
    allocations: explicitAllocations[index],
    amountInCentimes: 100_000,
    confirmationKey: randomUUID(),
    currency: CASH_CURRENCY,
    delivererId: tour.delivererId,
    reference: `VRS-${new ObjectId().toString().toUpperCase()}`,
    sourceTourCountingId: tour.countingId,
    tourId: tour.tourId,
  })));
  const result = await listCashRemainders({
    userId: cashierId.toString(),
  });

  assert.equal(result.totalItems, 0);
  assert.equal(result.totalRemainingDueInCentimes, 0);
  assert.equal(result.anomalyCount, 5);
  assert.deepEqual(
    result.anomalies.map(({ code, count }) => ({ code, count })),
    [{ code: 'INVALID_PAYMENTS', count: 5 }],
  );

  const preview = await getTourPaymentPreview({
    tourId: tours[0].tourId.toString(),
    userId: cashierId.toString(),
  });
  const unitPayment = await submitPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    expectedRemainingDueInCentimes: 100_000,
    tourId: tours[0].tourId,
  });

  assert.match(preview.errors.form, /versements enregistrés/u);
  assert.match(unitPayment.errors.form, /versements enregistrés/u);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 5);
});

test('annule les verrous et le versement si son insertion échoue', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour();
  const cashRegisterObjectId = new ObjectId(cashRegister.id);

  await database.collection('cashPayments').createIndex(
    { receivedBy: 1 },
    { name: 'force_cash_payment_failure', unique: true },
  );
  await database.collection('cashPayments').insertOne({
    _id: new ObjectId(),
    amountInCentimes: 1,
    confirmationKey: randomUUID(),
    currency: CASH_CURRENCY,
    receivedBy: cashierId,
    reference: `VRS-${new ObjectId().toString().toUpperCase()}`,
  });

  try {
    await assert.rejects(
      submitPayment({
        amount: '1000',
        cashRegisterId: cashRegister.id,
        tourId: tour.tourId,
      }),
      (error) => error?.code === 11000,
    );

    const [storedTour, storedCashRegister, payments] = await Promise.all([
      database.collection('tours').findOne({ _id: tour.tourId }),
      database.collection('cashRegisters').findOne({
        _id: cashRegisterObjectId,
      }),
      database.collection('cashPayments').find({
        tourId: tour.tourId,
      }).toArray(),
    ]);

    assert.equal(storedTour.cashPaymentReferenceVersion, undefined);
    assert.equal(storedCashRegister.paymentReferenceVersion, undefined);
    assert.equal(payments.length, 0);
  } finally {
    await database.collection('cashPayments').dropIndex(
      'force_cash_payment_failure',
    );
  }
});

test('enregistre un versement global unique avec ses affectations et alimente toutes les lectures', async () => {
  const cashRegister = await initializeMainCashRegister();
  const first = await insertTour({
    countedAt: new Date('2026-09-01T08:00:00.000Z'),
    delivererCode: 'LIV-GLOBAL',
    delivererName: 'Livreur global',
    totalDueInCentimes: 200_000,
  });
  const second = await insertTour({
    countedAt: new Date('2026-09-02T08:00:00.000Z'),
    deliverer: first,
    totalDueInCentimes: 400_000,
  });
  const request = await prepareDelivererPayment({
    amount: '5000',
    cashRegisterId: cashRegister.id,
    delivererId: first.delivererId,
  });
  const result = await recordDelivererCashPayment({
    ...request,
    note: 'Remise groupée',
  });
  const [storedPayments, journal, remainder, firstPreview, secondPreview,
    firstClosure] = await Promise.all([
    database.collection('cashPayments').find({}).toArray(),
    listCashPayments({ userId: cashierId.toString() }),
    readDelivererRemainder(first.delivererId),
    getTourPaymentPreview({
      tourId: first.tourId.toString(),
      userId: cashierId.toString(),
    }),
    getTourPaymentPreview({
      tourId: second.tourId.toString(),
      userId: cashierId.toString(),
    }),
    getTourClosurePreview({
      tourId: first.tourId.toString(),
      userId: cashierId.toString(),
    }),
  ]);

  assert.equal(result.replayed, false);
  assert.equal(storedPayments.length, 1);
  assert.equal(storedPayments[0].amountInCentimes, 500_000);
  assert.equal(storedPayments[0].note, 'Remise groupée');
  assert.equal(storedPayments[0].requestDigest.length, 64);
  assert.equal(storedPayments[0].allocationSummaryDigest.length, 64);
  assert.equal(
    storedPayments[0].allocationSummaryDigest,
    createDelivererCashPaymentSummaryDigest(request.expectedSummary),
  );
  assert.deepEqual(
    storedPayments[0].allocations.map((allocation) =>
      allocation.allocatedAmountInCentimes),
    [200_000, 300_000],
  );
  assert.ok(storedPayments[0].allocations.every((allocation) =>
    allocation.countedAt instanceof Date
    && allocation.sourceTourCountingId instanceof ObjectId
    && Number.isSafeInteger(allocation.remainingBeforePaymentInCentimes)
    && Number.isSafeInteger(allocation.remainingAfterPaymentInCentimes)));
  assert.equal(Object.hasOwn(storedPayments[0], 'tourId'), false);
  assert.deepEqual(
    result.payment.allocations.map((allocation) =>
      allocation.allocatedAmountInCentimes),
    [200_000, 300_000],
  );
  assert.equal(journal.totalItems, 1);
  assert.deepEqual(
    journal.payments[0].allocations.map((allocation) =>
      allocation.amountInCentimes),
    [200_000, 300_000],
  );
  assert.equal(remainder.remainingDueInCentimes, 100_000);
  assert.equal(remainder.tours.length, 1);
  assert.equal(remainder.tours[0].id, second.tourId.toString());
  assert.equal(firstPreview.amountPaidInCentimes, 200_000);
  assert.equal(firstPreview.remainingDueInCentimes, 0);
  assert.equal(secondPreview.amountPaidInCentimes, 300_000);
  assert.equal(secondPreview.remainingDueInCentimes, 100_000);
  assert.equal(firstClosure.amountPaidInCentimes, 200_000);
  assert.equal(firstClosure.remainingDueInCentimes, 0);
});

test('gère le paiement partiel de la première tournée puis le règlement exact de toutes les tournées', async () => {
  const cashRegister = await initializeMainCashRegister();
  const first = await insertTour({ totalDueInCentimes: 200_000 });
  const second = await insertTour({
    countedAt: new Date('2026-09-02T08:00:00.000Z'),
    deliverer: first,
    totalDueInCentimes: 400_000,
  });
  const partialRequest = await prepareDelivererPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    delivererId: first.delivererId,
  });
  const partial = await recordDelivererCashPayment(partialRequest);
  const exactRequest = await prepareDelivererPayment({
    amount: '5000',
    cashRegisterId: cashRegister.id,
    delivererId: first.delivererId,
  });
  const exact = await recordDelivererCashPayment(exactRequest);

  assert.deepEqual(
    partial.payment.allocations.map((allocation) =>
      allocation.allocatedAmountInCentimes),
    [100_000],
  );
  assert.deepEqual(
    exact.payment.allocations.map((allocation) =>
      allocation.allocatedAmountInCentimes),
    [100_000, 400_000],
  );
  assert.equal(await readDelivererRemainder(first.delivererId), null);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 2);
  assert.equal(
    await database.collection('cashPayments').countDocuments({
      allocations: { $exists: true },
    }),
    2,
  );
  assert.ok(second.tourId instanceof ObjectId);
});

test('encaisse un livreur désactivé et ses tournées terminées', async () => {
  const cashRegister = await initializeMainCashRegister();
  const first = await insertTour({
    delivererActive: false,
    status: 'CLOSED',
    totalDueInCentimes: 200_000,
  });
  await insertTour({
    countedAt: new Date('2026-09-02T08:00:00.000Z'),
    deliverer: first,
    status: 'CLOSED',
    totalDueInCentimes: 400_000,
  });
  const request = await prepareDelivererPayment({
    amount: '6000',
    cashRegisterId: cashRegister.id,
    delivererId: first.delivererId,
  });
  const result = await recordDelivererCashPayment(request);

  assert.equal(result.replayed, false);
  assert.equal(result.payment.allocations.length, 2);
  assert.equal(result.summary.totalRemainingAfterPaymentInCentimes, 0);
});

test('refuse les entrées globales invalides, les anomalies, les droits absents et la caisse indisponible', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour({ totalDueInCentimes: 200_000 });
  const validRequest = await prepareDelivererPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    delivererId: tour.delivererId,
  });
  const invalidAmount = await recordDelivererCashPayment({
    ...validRequest,
    amount: '0',
  });
  const unauthorizedId = await createUser([CASH_READ_PERMISSION]);

  await assert.rejects(
    recordDelivererCashPayment({
      ...validRequest,
      receivedBy: unauthorizedId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_PAYMENT_CREATE_PERMISSION,
  );

  await database.collection('tourCountings').updateOne(
    { _id: tour.countingId },
    { $set: { totalDueInCentimes: 50_000 } },
  );
  const overLimit = await recordDelivererCashPayment(validRequest);
  await database.collection('tourCountings').updateOne(
    { _id: tour.countingId },
    { $set: { totalDueInCentimes: 200_000 } },
  );

  await database.collection('tourCountings').deleteOne({
    _id: tour.countingId,
  });
  const anomalous = await recordDelivererCashPayment(validRequest);

  await database.collection('tourCountings').insertOne({
    _id: tour.countingId,
    countedAt: new Date('2026-09-01T08:00:00.000Z'),
    totalDueInCentimes: 200_000,
    tourId: tour.tourId,
  });
  await database.collection('cashRegisters').updateOne(
    { _id: new ObjectId(cashRegister.id) },
    { $set: { active: false } },
  );
  const unavailableCashRegister = await recordDelivererCashPayment(
    validRequest,
  );

  assert.ok(invalidAmount.errors.amount);
  assert.equal(overLimit.stale, true);
  assert.match(overLimit.errors.form, /dépasser/u);
  assert.equal(anomalous.stale, true);
  assert.match(anomalous.errors.form, /anomalies financières/u);
  assert.equal(anomalous.summary.blocked, true);
  assert.equal(unavailableCashRegister.stale, true);
  assert.match(unavailableCashRegister.errors.form, /caisse/u);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('rejoue exactement un versement global soldé et refuse une clé détournée', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour({ totalDueInCentimes: 200_000 });
  const request = await prepareDelivererPayment({
    amount: '2000',
    cashRegisterId: cashRegister.id,
    delivererId: tour.delivererId,
  });
  const concurrentResults = await Promise.all([
    recordDelivererCashPayment(request),
    recordDelivererCashPayment(request),
  ]);
  const first = concurrentResults.find((result) => result.replayed === false);
  const concurrentReplay = concurrentResults.find((result) =>
    result.replayed === true);
  const replay = await recordDelivererCashPayment(request);
  const diverted = await recordDelivererCashPayment({
    ...request,
    note: 'Contenu différent',
  });

  assert.equal(first.replayed, false);
  assert.equal(concurrentReplay.payment.id, first.payment.id);
  assert.equal(replay.replayed, true);
  assert.equal(replay.payment.id, first.payment.id);
  assert.deepEqual(replay.payment.allocations, first.payment.allocations);
  assert.match(diverted.errors.form, /contenu différent/u);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});

test('sérialise deux versements globaux concurrents sans dépasser le reste', async () => {
  const cashRegister = await initializeMainCashRegister();
  const first = await insertTour({ totalDueInCentimes: 200_000 });
  await insertTour({ deliverer: first, totalDueInCentimes: 400_000 });
  const firstRequest = await prepareDelivererPayment({
    amount: '4000',
    cashRegisterId: cashRegister.id,
    delivererId: first.delivererId,
  });
  const secondRequest = {
    ...firstRequest,
    confirmationKey: randomUUID(),
  };
  const results = await Promise.all([
    recordDelivererCashPayment(firstRequest),
    recordDelivererCashPayment(secondRequest),
  ]);
  const accepted = results.filter((result) => !result.errors);
  const refused = results.filter((result) => result.errors);
  const stored = await database.collection('cashPayments').find({}).toArray();

  assert.equal(accepted.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].stale, true);
  assert.equal(refused[0].summary.totalRemainingDueInCentimes, 200_000);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].amountInCentimes, 400_000);
});

test('sérialise un versement global concurrent avec un versement unitaire', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour({ totalDueInCentimes: 500_000 });
  const globalRequest = await prepareDelivererPayment({
    amount: '4000',
    cashRegisterId: cashRegister.id,
    delivererId: tour.delivererId,
  });
  const [globalResult, unitResult] = await Promise.all([
    recordDelivererCashPayment(globalRequest),
    submitPayment({
      amount: '4000',
      cashRegisterId: cashRegister.id,
      expectedRemainingDueInCentimes: 500_000,
      tourId: tour.tourId,
    }),
  ]);
  const accepted = [globalResult, unitResult].filter((result) => !result.errors);
  const stored = await database.collection('cashPayments').find({}).toArray();

  assert.equal(accepted.length, 1);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].amountInCentimes, 400_000);
  assert.equal((await readDelivererRemainder(tour.delivererId))
    .remainingDueInCentimes, 100_000);
});

test('refuse un récapitulatif global périmé après un versement unitaire et retourne la nouvelle répartition', async () => {
  const cashRegister = await initializeMainCashRegister();
  const first = await insertTour({ totalDueInCentimes: 200_000 });
  const second = await insertTour({
    countedAt: new Date('2026-09-02T08:00:00.000Z'),
    deliverer: first,
    totalDueInCentimes: 400_000,
  });
  const globalRequest = await prepareDelivererPayment({
    amount: '5000',
    cashRegisterId: cashRegister.id,
    delivererId: first.delivererId,
  });

  await submitPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    expectedRemainingDueInCentimes: 200_000,
    tourId: first.tourId,
  });

  const stale = await recordDelivererCashPayment(globalRequest);

  assert.equal(stale.stale, true);
  assert.match(stale.errors.form, /répartition a changé/u);
  assert.deepEqual(
    stale.summary.allocations.map((allocation) => ({
      amount: allocation.allocatedAmountInCentimes,
      tourId: allocation.tourId,
    })),
    [
      { amount: 100_000, tourId: first.tourId.toString() },
      { amount: 400_000, tourId: second.tourId.toString() },
    ],
  );
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
  assert.equal(await database.collection('cashPayments').countDocuments({
    allocations: { $exists: true },
  }), 0);
});

test('coordonne un nouveau comptage avec le global sans modifier silencieusement la répartition confirmée', async () => {
  const cashRegister = await initializeMainCashRegister();
  const existing = await insertTour({
    countedAt: new Date('2027-01-01T08:00:00.000Z'),
    totalDueInCentimes: 200_000,
  });
  const loaded = await insertLoadedTour({
    deliverer: existing,
    totalDueInCentimes: 100_000,
  });
  const counterId = await createUser([
    'pricing.read',
    'tours.count.confirm',
    'tours.count.prepare',
    'tours.read',
  ]);
  const sheet = await getTourCountingSheet({
    tourId: loaded.tourId.toString(),
    userId: counterId.toString(),
  });
  const globalRequest = await prepareDelivererPayment({
    amount: '1500',
    cashRegisterId: cashRegister.id,
    delivererId: existing.delivererId,
  });
  const [paymentResult, countingResult] = await Promise.all([
    recordDelivererCashPayment(globalRequest),
    confirmTourCounting({
      confirmationKey: randomUUID(),
      countedBy: counterId.toString(),
      expectedSheetDigest: sheet.digest,
      lines: [{
        lineId: loaded.reservationId.toString(),
        returnedQuantity: '0',
      }],
      tourId: loaded.tourId.toString(),
    }),
  ]);
  const storedPayments = await database.collection('cashPayments').find({
    delivererId: existing.delivererId,
  }).toArray();

  assert.equal(countingResult.replayed, false);

  if (paymentResult.errors) {
    assert.equal(paymentResult.stale, true);
    assert.equal(storedPayments.length, 0);
    assert.equal(
      paymentResult.summary.allocations[0].tourId,
      loaded.tourId.toString(),
    );
  } else {
    assert.equal(storedPayments.length, 1);
    assert.deepEqual(
      storedPayments[0].allocations.map((allocation) =>
        allocation.tourId.toString()),
      globalRequest.expectedSummary.allocations.map((allocation) =>
        allocation.tourId),
    );
  }
});

test('annule le versement global et toutes ses écritures de coordination si l’insertion échoue', async () => {
  const cashRegister = await initializeMainCashRegister();
  const tour = await insertTour({ totalDueInCentimes: 200_000 });
  const request = await prepareDelivererPayment({
    amount: '1000',
    cashRegisterId: cashRegister.id,
    delivererId: tour.delivererId,
  });

  await database.collection('cashPayments').createIndex(
    { receivedBy: 1 },
    { name: 'force_global_cash_payment_failure', unique: true },
  );
  await database.collection('cashPayments').insertOne({
    _id: new ObjectId(),
    amountInCentimes: 1,
    confirmationKey: randomUUID(),
    currency: CASH_CURRENCY,
    receivedBy: cashierId,
    reference: `VRS-${new ObjectId().toString().toUpperCase()}`,
  });

  try {
    await assert.rejects(
      recordDelivererCashPayment(request),
      (error) => error?.code === 11000,
    );
    const [deliverer, storedTour, storedCashRegister] = await Promise.all([
      database.collection('deliverers').findOne({ _id: tour.delivererId }),
      database.collection('tours').findOne({ _id: tour.tourId }),
      database.collection('cashRegisters').findOne({
        _id: new ObjectId(cashRegister.id),
      }),
    ]);

    assert.equal(deliverer.cashPaymentReferenceVersion, undefined);
    assert.equal(storedTour.cashPaymentReferenceVersion, undefined);
    assert.equal(storedCashRegister.paymentReferenceVersion, undefined);
    assert.equal(await database.collection('cashPayments').countDocuments({
      delivererId: tour.delivererId,
    }), 0);
  } finally {
    await database.collection('cashPayments').dropIndex(
      'force_global_cash_payment_failure',
    );
  }
});
