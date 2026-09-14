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
const {
  listCashRemainders,
  recordTourCashPayment,
} = await import('../lib/cash-payments.js');
const { initializeMainCashRegister } = await import('../lib/cash-registers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  TOUR_EXPENSE_DECLARE_PERMISSION,
  TOUR_EXPENSE_READ_PERMISSION,
  getTourExpensePreview,
  recordTourExpenseDeclaration,
} = await import('../lib/tour-expenses.js');

let database;

const expensePermissions = [
  TOUR_EXPENSE_READ_PERMISSION,
  TOUR_EXPENSE_DECLARE_PERMISSION,
  'tours.read',
  'cash.read',
];

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

const insertPayment = async ({
  amountInCentimes,
  countingId,
  delivererId,
  tourId,
}) => {
  await database.collection('cashPayments').insertOne({
    _id: new ObjectId(),
    amountInCentimes,
    currency: 'DZD',
    delivererId,
    receivedAt: new Date(),
    sourceTourCountingId: countingId,
    tourId,
  });
};

const declareFromPreview = async ({
  choice = 'DECLARE',
  confirmationKey = randomUUID(),
  expenses = [{ amount: '2200', reason: 'Carburant' }],
  preview,
  tourId,
  userId,
}) => recordTourExpenseDeclaration({
  choice,
  confirmationKey,
  declaredBy: userId,
  expectedDigest: preview.digest,
  expenses,
  tourId: tourId.toString(),
});

before(async () => {
  database = await getDatabase();
});

beforeEach(async () => {
  await Promise.all([
    database.collection('cashPayments').deleteMany({}),
    database.collection('cashRegisters').deleteMany({}),
    database.collection('cashWithdrawals').deleteMany({}),
    database.collection('deliverers').deleteMany({}),
    database.collection('roles').deleteMany({}),
    database.collection('tourCountings').deleteMany({}),
    database.collection('tourExpenses').deleteMany({}),
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

test('signale une tournée CLOSED sans déclaration comme historique', async () => {
  const userId = await createUser([
    TOUR_EXPENSE_READ_PERMISSION,
    'tours.read',
    'cash.read',
  ]);
  const { tourId } = await insertCountedTour({ status: 'CLOSED' });

  const preview = await getTourExpensePreview({
    tourId: tourId.toString(),
    userId,
  });

  assert.equal(preview.declaration, null);
  assert.equal(preview.declarationStatus, 'HISTORICAL_MISSING');
  assert.equal(preview.netDueInCentimes, preview.grossSalesInCentimes);
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

test('enregistre 2 200 DA, conserve les lignes serveur et calcule le net commun', async () => {
  const userId = await createUser(expensePermissions);
  const tour = await insertCountedTour();

  await insertPayment({
    amountInCentimes: 300_000,
    ...tour,
  });

  const preview = await getTourExpensePreview({
    tourId: tour.tourId.toString(),
    userId,
  });
  const before = {
    cashPayments: await database.collection('cashPayments').find({}).toArray(),
    cashWithdrawals: await database.collection('cashWithdrawals').find({}).toArray(),
    counting: await database.collection('tourCountings').findOne({
      _id: tour.countingId,
    }),
    tour: await database.collection('tours').findOne({ _id: tour.tourId }),
  };
  const result = await declareFromPreview({
    expenses: [{ amount: '2200', reason: '  Carburant  ' }],
    preview,
    tourId: tour.tourId,
    userId,
  });
  const stored = await database.collection('tourExpenses').findOne({
    tourId: tour.tourId,
  });
  const after = await getTourExpensePreview({
    tourId: tour.tourId.toString(),
    userId,
  });

  assert.equal(result.replayed, false);
  assert.equal(stored.totalInCentimes, 220_000);
  assert.deepEqual(stored.lines, [{
    amountInCentimes: 220_000,
    reason: 'Carburant',
  }]);
  assert.ok(stored.declaredAt instanceof Date);
  assert.ok(stored.declaredBy.equals(new ObjectId(userId)));
  assert.equal(after.grossSalesInCentimes, 750_000);
  assert.equal(after.netDueInCentimes, 530_000);
  assert.equal(after.remainingDueInCentimes, 230_000);
  assert.equal(after.declaration.declaredBy, `expense-${userId}`);
  assert.deepEqual(
    await database.collection('cashPayments').find({}).toArray(),
    before.cashPayments,
  );
  assert.deepEqual(
    await database.collection('cashWithdrawals').find({}).toArray(),
    before.cashWithdrawals,
  );
  assert.deepEqual(
    await database.collection('tourCountings').findOne({ _id: tour.countingId }),
    before.counting,
  );
  const tourAfter = await database.collection('tours').findOne({
    _id: tour.tourId,
  });
  assert.equal(tourAfter.status, before.tour.status);
  assert.ok(!tourAfter.closedAt);
});

test('autorise l’égalité à 4 500 DA et refuse 5 000 DA sans écriture partielle', async () => {
  const userId = await createUser(expensePermissions);
  const equalTour = await insertCountedTour();
  const refusedTour = await insertCountedTour();

  for (const tour of [equalTour, refusedTour]) {
    await insertPayment({ amountInCentimes: 300_000, ...tour });
  }

  const equalPreview = await getTourExpensePreview({
    tourId: equalTour.tourId.toString(),
    userId,
  });
  const equalResult = await declareFromPreview({
    expenses: [{ amount: '4500', reason: 'Frais au maximum' }],
    preview: equalPreview,
    tourId: equalTour.tourId,
    userId,
  });
  const refusedPreview = await getTourExpensePreview({
    tourId: refusedTour.tourId.toString(),
    userId,
  });
  const refusedResult = await declareFromPreview({
    expenses: [{ amount: '5000', reason: 'Trop élevé' }],
    preview: refusedPreview,
    tourId: refusedTour.tourId,
    userId,
  });

  assert.equal(equalResult.declaration.totalExpensesInCentimes, 450_000);
  assert.equal((await getTourExpensePreview({
    tourId: equalTour.tourId.toString(),
    userId,
  })).remainingDueInCentimes, 0);
  assert.match(refusedResult.errors.form, /maximum actuellement déclarable/u);
  assert.equal(await database.collection('tourExpenses').countDocuments({
    tourId: refusedTour.tourId,
  }), 0);
});

test('conserve une déclaration explicite sans frais distincte de l’absence', async () => {
  const userId = await createUser(expensePermissions);
  const { tourId } = await insertCountedTour();
  const preview = await getTourExpensePreview({
    tourId: tourId.toString(),
    userId,
  });
  const result = await declareFromPreview({
    choice: 'NONE',
    expenses: [{ amount: '999', reason: 'Ignorée' }],
    preview,
    tourId,
    userId,
  });
  const after = await getTourExpensePreview({
    tourId: tourId.toString(),
    userId,
  });

  assert.equal(result.declaration.choice, 'NONE');
  assert.equal(after.declarationStatus, 'DECLARED');
  assert.equal(after.declaration.totalExpensesInCentimes, 0);
  assert.deepEqual(after.declaration.lines, []);
});

test('rejoue une demande identique et refuse tout contenu ou toute seconde clé', async () => {
  const userId = await createUser(expensePermissions);
  const { tourId } = await insertCountedTour();
  const preview = await getTourExpensePreview({
    tourId: tourId.toString(),
    userId,
  });
  const confirmationKey = randomUUID();
  const request = {
    confirmationKey,
    preview,
    tourId,
    userId,
  };
  const first = await declareFromPreview(request);
  const replay = await declareFromPreview(request);
  const changed = await declareFromPreview({
    ...request,
    expenses: [{ amount: '2100', reason: 'Autre' }],
  });
  const secondKey = await declareFromPreview({
    ...request,
    confirmationKey: randomUUID(),
  });
  await database.collection('tours').updateOne(
    { _id: tourId },
    { $set: { status: 'CLOSED' } },
  );
  const replayAfterClosure = await declareFromPreview(request);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.declaration.id, first.declaration.id);
  assert.equal(replayAfterClosure.replayed, true);
  assert.match(changed.errors.form, /contenu différent/u);
  assert.match(secondKey.errors.form, /existe déjà/u);
  assert.equal(await database.collection('tourExpenses').countDocuments({}), 1);
});

test('refuse un récapitulatif périmé après paiement concurrent', async () => {
  const userId = await createUser(expensePermissions);
  const tour = await insertCountedTour();
  const preview = await getTourExpensePreview({
    tourId: tour.tourId.toString(),
    userId,
  });

  await insertPayment({ amountInCentimes: 300_000, ...tour });

  const result = await declareFromPreview({
    expenses: [{ amount: '5000', reason: 'Dépassement concurrent' }],
    preview,
    tourId: tour.tourId,
    userId,
  });

  assert.equal(result.stale, true);
  assert.match(result.errors.form, /maximum actuellement déclarable/u);
  assert.equal(await database.collection('tourExpenses').countDocuments({}), 0);
});

test('sérialise un paiement et une déclaration concurrents sans reste négatif', async () => {
  const userId = await createUser([
    ...expensePermissions,
    'cash.payments.create',
  ]);
  const tour = await insertCountedTour();
  const cashRegister = await initializeMainCashRegister();
  const preview = await getTourExpensePreview({
    tourId: tour.tourId.toString(),
    userId,
  });

  const [declarationResult, paymentResult] = await Promise.all([
    declareFromPreview({
      expenses: [{ amount: '5000', reason: 'Frais concurrents' }],
      preview,
      tourId: tour.tourId,
      userId,
    }),
    recordTourCashPayment({
      amount: '3000',
      confirmationKey: randomUUID(),
      expectedCashRegisterId: cashRegister.id,
      expectedRemainingDueInCentimes: '750000',
      note: '',
      receivedBy: userId,
      tourId: tour.tourId.toString(),
    }),
  ]);
  const storedDeclaration = await database.collection('tourExpenses').findOne({
    tourId: tour.tourId,
  });
  const storedPayments = await database.collection('cashPayments').find({
    tourId: tour.tourId,
  }).toArray();
  const paidInCentimes = storedPayments.reduce((total, payment) =>
    total + payment.amountInCentimes, 0);
  const expenseInCentimes = storedDeclaration?.totalInCentimes ?? 0;

  assert.equal(
    [declarationResult, paymentResult].filter((result) => !result.errors).length,
    1,
  );
  assert.ok(750_000 - expenseInCentimes - paidInCentimes >= 0);
  assert.ok(
    (storedDeclaration && storedPayments.length === 0)
    || (!storedDeclaration && storedPayments.length === 1),
  );
});

test('vérifie la permission de déclaration dans la transaction', async () => {
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

  await assert.rejects(
    declareFromPreview({ preview, tourId, userId }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === TOUR_EXPENSE_DECLARE_PERMISSION,
  );
  assert.equal(await database.collection('tourExpenses').countDocuments({}), 0);
});

test('annule la déclaration et les verrous si l’insertion échoue', async () => {
  const userId = await createUser(expensePermissions);
  const tour = await insertCountedTour();
  const preview = await getTourExpensePreview({
    tourId: tour.tourId.toString(),
    userId,
  });

  await database.collection('tourExpenses').createIndex(
    { declaredBy: 1 },
    { name: 'force_tour_expense_failure', unique: true },
  );
  await database.collection('tourExpenses').insertOne({
    _id: new ObjectId(),
    confirmationKey: randomUUID(),
    declaredBy: new ObjectId(userId),
    tourId: new ObjectId(),
  });

  try {
    await assert.rejects(
      declareFromPreview({
        preview,
        tourId: tour.tourId,
        userId,
      }),
      (error) => error?.code === 11000,
    );

    const [storedTour, storedDeliverer, declarations] = await Promise.all([
      database.collection('tours').findOne({ _id: tour.tourId }),
      database.collection('deliverers').findOne({ _id: tour.delivererId }),
      database.collection('tourExpenses').find({
        tourId: tour.tourId,
      }).toArray(),
    ]);

    assert.equal(storedTour.cashPaymentReferenceVersion, undefined);
    assert.equal(storedDeliverer.cashPaymentReferenceVersion, undefined);
    assert.equal(declarations.length, 0);
  } finally {
    await database.collection('tourExpenses').dropIndex(
      'force_tour_expense_failure',
    );
  }
});

test('signale une déclaration stockée incohérente sans corriger ses montants', async () => {
  const userId = await createUser(expensePermissions);
  const tour = await insertCountedTour();

  await database.collection('tourExpenses').insertOne({
    _id: new ObjectId(),
    choice: 'DECLARE',
    confirmationKey: randomUUID(),
    declaredAt: new Date(),
    declaredBy: new ObjectId(userId),
    delivererId: tour.delivererId,
    lines: [{ amountInCentimes: 100_000, reason: 'Montant réel' }],
    requestDigest: randomUUID(),
    sourceTourCountingId: tour.countingId,
    totalInCentimes: 50_000,
    tourId: tour.tourId,
  });

  const [preview, remainders] = await Promise.all([
    getTourExpensePreview({
      tourId: tour.tourId.toString(),
      userId,
    }),
    listCashRemainders({ userId }),
  ]);

  assert.match(preview.errors.form, /déclaration de frais enregistrée/u);
  assert.deepEqual(remainders.anomalies.map((anomaly) => anomaly.code), [
    'INVALID_EXPENSE_DECLARATION',
  ]);
  assert.equal((await database.collection('tourExpenses').findOne({
    tourId: tour.tourId,
  })).totalInCentimes, 50_000);
});
