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
  CASH_PAYMENT_CREATE_PERMISSION,
  CASH_PAYMENT_MODE,
  CASH_READ_PERMISSION,
  getTourPaymentPreview,
  recordTourCashPayment,
} = await import('../lib/cash-payments.js');
const {
  CASH_CURRENCY,
  MAIN_CASH_REGISTER_CODE,
  MAIN_CASH_REGISTER_NAME,
  initializeMainCashRegister,
} = await import('../lib/cash-registers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');

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
  delivererActive = true,
  status = 'COUNTED',
  totalDueInCentimes = 750_000,
} = {}) => {
  const countingId = new ObjectId();
  const delivererId = new ObjectId();
  const tourId = new ObjectId();
  const delivererCode = `LIV-${delivererId.toString().slice(-6)}`;
  const delivererName = 'Livreur caisse';
  const tourReference = `TRN-${tourId.toString().toUpperCase()}`;

  await Promise.all([
    database.collection('deliverers').insertOne({
      _id: delivererId,
      active: delivererActive,
      code: delivererCode,
      name: delivererName,
    }),
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
      delivererId,
      lines: [{ amountDueInCentimes: totalDueInCentimes }],
      totalDueInCentimes,
      tourId,
    }),
  ]);

  return {
    countingId,
    delivererId,
    tourId,
    tourReference,
  };
};

const submitPayment = async ({
  amount,
  cashRegisterId,
  confirmationKey = randomUUID(),
  note = '',
  tourId,
  userId = cashierId,
}) => recordTourCashPayment({
  amount,
  confirmationKey,
  expectedCashRegisterId: cashRegisterId.toString(),
  note,
  receivedBy: userId.toString(),
  tourId: tourId.toString(),
});

before(async () => {
  database = await getDatabase();
  cashierId = await createUser([
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
    'tours.read',
  ], 'caissier-test');
});

beforeEach(async () => {
  await Promise.all([
    database.collection('cashPayments').deleteMany({}),
    database.collection('cashRegisters').deleteMany({}),
    database.collection('deliverers').deleteMany({}),
    database.collection('stockMovements').deleteMany({}),
    database.collection('tourCountings').deleteMany({}),
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
  assert.equal(storedTour.status, 'COUNTED');
  assert.deepEqual(countingAfter, countingBefore);
  assert.deepEqual(stockAfter, stockBefore);
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
      tourId: tour.tourId,
    }),
    submitPayment({
      amount: '5000',
      cashRegisterId: cashRegister.id,
      tourId: tour.tourId,
    }),
  ]);
  const accepted = first.payment ? first : second;
  const refused = first.errors ? first : second;
  const payments = await database.collection('cashPayments').find({
    tourId: tour.tourId,
  }).toArray();

  assert.ok(accepted.payment);
  assert.match(refused.errors.amount, /dépasser le reste dû/u);
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
