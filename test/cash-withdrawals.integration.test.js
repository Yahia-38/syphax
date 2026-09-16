import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_cw_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { listCashPayments } = await import('../lib/cash-payments.js');
const {
  CASH_CURRENCY,
  MAIN_CASH_REGISTER_OPENING_BALANCE_REFERENCE,
  MAIN_CASH_REGISTER_OPENING_BALANCE_SOURCE,
  initializeMainCashRegister,
} = await import('../lib/cash-registers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  CASH_WITHDRAWAL_CREATE_PERMISSION,
  getCashWithdrawalPreviewData,
  getTrackedCashBalance,
  recordCashWithdrawal,
} = await import('../lib/cash-withdrawals.js');

let database;

const createOpeningBalance = (amountInCentimes = 0) => ({
  amountInCentimes,
  currency: CASH_CURRENCY,
  declaredAt: new Date('2026-09-01T00:00:00.000Z'),
  reference: MAIN_CASH_REGISTER_OPENING_BALANCE_REFERENCE,
  source: MAIN_CASH_REGISTER_OPENING_BALANCE_SOURCE,
});

const insertCashRegister = async ({ active = true, openingBalance = true } = {}) => {
  const cashRegisterId = new ObjectId();

  await database.collection('cashRegisters').insertOne({
    _id: cashRegisterId,
    active,
    code: 'MAIN',
    currency: CASH_CURRENCY,
    name: 'Caisse principale',
    ...(openingBalance ? { openingBalance: createOpeningBalance() } : {}),
  });

  return cashRegisterId;
};

const insertCashPayment = async ({
  amountInCentimes,
  cashRegisterId,
  delivererId = new ObjectId(),
  receivedAt = new Date(),
  reference = `VRS-${new ObjectId().toHexString().toUpperCase()}`,
} = {}) => {
  const tourId = new ObjectId();

  await database.collection('cashPayments').insertOne({
    allocations: [{
      allocatedAmountInCentimes: amountInCentimes,
      sourceTourCountingId: new ObjectId(),
      tourId,
      tourReference: `TR-${tourId.toHexString().slice(-6)}`,
    }],
    amountInCentimes,
    cashRegisterCode: 'MAIN',
    cashRegisterId,
    cashRegisterName: 'Caisse principale',
    currency: CASH_CURRENCY,
    delivererCode: 'LIV-TEST',
    delivererId,
    delivererName: 'Livreur test',
    note: 'Remise test',
    receivedAt,
    receivedBy: new ObjectId(),
    reference,
  });

  return { delivererId, reference };
};

const withdrawalRequest = ({
  amount = '3000',
  balanceInCentimes = 1_000_000,
  cashRegisterId,
  confirmationKey = randomUUID(),
  reason = 'Dépôt bancaire',
  userId,
}) => ({
  amount,
  confirmationKey,
  expectedBalanceInCentimes: String(balanceInCentimes),
  expectedCashRegisterId: cashRegisterId.toString(),
  reason,
  withdrawnBy: userId,
});

const createUser = async (
  permissions,
  username = `withdrawal-${randomUUID()}`,
) => {
  const roleId = new ObjectId();
  const userId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      key: `cash-withdrawal-${roleId.toString()}`,
      permissions,
    }),
    database.collection('users').insertOne({
      _id: userId,
      active: true,
      roleIds: [roleId],
      username,
    }),
  ]);

  return userId.toString();
};

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
    database.collection('stockMovements').deleteMany({}),
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

test('identifie l’unique caisse active et totalise seulement ses encaissements enregistrés', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = new ObjectId();
  const otherCashRegisterId = new ObjectId();

  await database.collection('cashRegisters').insertMany([
    {
      _id: cashRegisterId,
      active: true,
      code: 'MAIN',
      currency: 'DZD',
      name: 'Caisse principale',
      openingBalance: createOpeningBalance(),
    },
    {
      _id: otherCashRegisterId,
      active: false,
      code: 'OLD',
      currency: 'DZD',
      name: 'Ancienne caisse',
    },
  ]);
  await database.collection('cashPayments').insertMany([
    {
      amountInCentimes: 125_050,
      cashRegisterId,
      currency: 'DZD',
    },
    {
      amountInCentimes: 74_950,
      cashRegisterId,
      currency: 'DZD',
    },
    {
      amountInCentimes: 999_999,
      cashRegisterId: otherCashRegisterId,
      currency: 'DZD',
    },
  ]);
  const before = {
    payments: await database.collection('cashPayments').countDocuments({}),
    registers: await database.collection('cashRegisters').countDocuments({}),
  };

  const preview = await getCashWithdrawalPreviewData({ userId });

  assert.deepEqual(preview.cashRegister, {
    code: 'MAIN',
    id: cashRegisterId.toString(),
    name: 'Caisse principale',
  });
  assert.equal(preview.balanceInCentimes, 200_000);
  assert.equal(preview.openingBalanceInCentimes, 0);
  assert.equal(preview.recordedReceiptsInCentimes, 200_000);
  assert.equal(preview.recordedWithdrawalsInCentimes, 0);
  assert.equal(preview.error, null);
  assert.deepEqual({
    payments: await database.collection('cashPayments').countDocuments({}),
    registers: await database.collection('cashRegisters').countDocuments({}),
  }, before);
  assert.equal(
    (await database.listCollections().toArray()).some(
      ({ name }) => name.toLocaleLowerCase('en').includes('withdrawal'),
    ),
    false,
  );
});

test('refuse avant toute lecture financière si une permission manque', async () => {
  const readOnlyUserId = await createUser(['cash.read']);
  const withdrawalOnlyUserId = await createUser([
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = new ObjectId();

  await database.collection('cashRegisters').insertOne({
    _id: cashRegisterId,
    active: true,
    code: 'SECRET',
      currency: 'DZD',
      name: 'Caisse confidentielle',
      openingBalance: createOpeningBalance(),
  });
  await database.collection('cashPayments').insertOne({
    amountInCentimes: 500_000,
    cashRegisterId,
    currency: 'DZD',
  });

  await assert.rejects(
    getCashWithdrawalPreviewData({ userId: readOnlyUserId }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_WITHDRAWAL_CREATE_PERMISSION,
  );
  await assert.rejects(
    getCashWithdrawalPreviewData({ userId: withdrawalOnlyUserId }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'cash.read',
  );
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});

test('ne choisit pas arbitrairement entre plusieurs caisses actives', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);

  await database.collection('cashRegisters').insertMany([
    {
      _id: new ObjectId(),
      active: true,
      code: 'FIRST',
      currency: 'DZD',
      name: 'Première caisse',
    },
    {
      _id: new ObjectId(),
      active: true,
      code: 'SECOND',
      currency: 'DZD',
      name: 'Deuxième caisse',
    },
  ]);

  const preview = await getCashWithdrawalPreviewData({ userId });

  assert.equal(preview.cashRegister, null);
  assert.equal(preview.recordedReceiptsInCentimes, null);
  assert.match(preview.error, /Plusieurs caisses/u);
});

test('configure explicitement et une seule fois le fonds initial nul de MAIN', async () => {
  const first = await initializeMainCashRegister();
  const firstStored = await database.collection('cashRegisters').findOne({
    _id: new ObjectId(first.id),
  });
  const second = await initializeMainCashRegister();
  const secondStored = await database.collection('cashRegisters').findOne({
    _id: new ObjectId(first.id),
  });

  assert.equal(first.openingBalance.amountInCentimes, 0);
  assert.deepEqual(second.openingBalance, first.openingBalance);
  assert.deepEqual(secondStored.openingBalance, firstStored.openingBalance);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 0);
});

test('ne donne aucune base implicite à une future caisse non configurée', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  await insertCashRegister({ openingBalance: false });

  const preview = await getCashWithdrawalPreviewData({ userId });

  assert.equal(preview.balanceInCentimes, null);
  assert.match(preview.error, /fonds initial/u);
});

test('suit 10 000 DA, retire 3 000 DA puis autorise le retrait exact des 7 000 DA restants', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = await insertCashRegister();
  await insertCashPayment({
    amountInCentimes: 1_000_000,
    cashRegisterId,
  });

  const first = await recordCashWithdrawal(withdrawalRequest({
    cashRegisterId,
    userId,
  }));
  const afterFirst = await getTrackedCashBalance({ userId });
  const second = await recordCashWithdrawal(withdrawalRequest({
    amount: '7000',
    balanceInCentimes: 700_000,
    cashRegisterId,
    reason: 'Retrait du solde restant',
    userId,
  }));
  const afterSecond = await getTrackedCashBalance({ userId });

  assert.equal(first.balanceAfterWithdrawalInCentimes, 700_000);
  assert.equal(afterFirst.balanceInCentimes, 700_000);
  assert.equal(second.balanceAfterWithdrawalInCentimes, 0);
  assert.equal(afterSecond.balanceInCentimes, 0);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 2);
});

test('refuse un montant supérieur au solde et annule aussi la coordination', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = await insertCashRegister();
  await insertCashPayment({ amountInCentimes: 700_000, cashRegisterId });
  const before = await database.collection('cashRegisters').findOne({
    _id: cashRegisterId,
  });

  const result = await recordCashWithdrawal(withdrawalRequest({
    amount: '7000,01',
    balanceInCentimes: 700_000,
    cashRegisterId,
    userId,
  }));
  const after = await database.collection('cashRegisters').findOne({
    _id: cashRegisterId,
  });

  assert.match(result.errors.amount, /dépasse/u);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 0);
  assert.equal(after.paymentReferenceVersion, before.paymentReferenceVersion);
});

test('annule le retrait et la coordination si son insertion échoue', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = await insertCashRegister();
  await insertCashPayment({ amountInCentimes: 200_000, cashRegisterId });
  await database.collection('cashWithdrawals').insertOne({
    _id: new ObjectId(),
    amountInCentimes: 50_000,
    cashRegisterId,
    currency: CASH_CURRENCY,
  });
  await database.collection('cashWithdrawals').createIndex(
    { currency: 1 },
    { name: 'forced_withdrawal_failure', unique: true },
  );
  const before = await database.collection('cashRegisters').findOne({
    _id: cashRegisterId,
  });

  try {
    await assert.rejects(recordCashWithdrawal(withdrawalRequest({
      amount: '500',
      balanceInCentimes: 150_000,
      cashRegisterId,
      userId,
    })));
  } finally {
    await database.collection('cashWithdrawals').dropIndex(
      'forced_withdrawal_failure',
    );
  }

  const after = await database.collection('cashRegisters').findOne({
    _id: cashRegisterId,
  });

  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 1);
  assert.equal(after.paymentReferenceVersion, before.paymentReferenceVersion);
});

test('sérialise deux retraits concurrents de 6 000 DA sur un solde de 10 000 DA', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = await insertCashRegister();
  await insertCashPayment({ amountInCentimes: 1_000_000, cashRegisterId });

  const [first, second] = await Promise.all([
    recordCashWithdrawal(withdrawalRequest({
      amount: '6000',
      cashRegisterId,
      reason: 'Premier retrait concurrent',
      userId,
    })),
    recordCashWithdrawal(withdrawalRequest({
      amount: '6000',
      cashRegisterId,
      reason: 'Second retrait concurrent',
      userId,
    })),
  ]);
  const results = [first, second];
  const balance = await getTrackedCashBalance({ userId });

  assert.equal(results.filter((result) => result.withdrawal).length, 1);
  assert.equal(results.filter((result) => result.errors).length, 1);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 1);
  assert.equal(balance.balanceInCentimes, 400_000);
});

test('rejoue une demande réussie avant de recontrôler le solde et refuse le même identifiant avec un autre contenu', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = await insertCashRegister();
  await insertCashPayment({ amountInCentimes: 300_000, cashRegisterId });
  const confirmationKey = randomUUID();
  const request = withdrawalRequest({
    balanceInCentimes: 300_000,
    cashRegisterId,
    confirmationKey,
    userId,
  });

  const first = await recordCashWithdrawal(request);
  const replay = await recordCashWithdrawal(request);
  const conflicting = await recordCashWithdrawal({
    ...request,
    reason: 'Contenu différent',
  });

  assert.equal(replay.replayed, true);
  assert.equal(replay.withdrawal.reference, first.withdrawal.reference);
  assert.match(conflicting.errors.form, /autre demande/u);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 1);
});

test('demande une nouvelle confirmation après un encaissement concurrent ou une désactivation', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = await insertCashRegister();
  await insertCashPayment({ amountInCentimes: 1_000_000, cashRegisterId });
  const preparedRequest = withdrawalRequest({ cashRegisterId, userId });
  await insertCashPayment({ amountInCentimes: 100_000, cashRegisterId });

  const changedBalance = await recordCashWithdrawal(preparedRequest);

  assert.equal(changedBalance.stale, true);
  assert.equal(changedBalance.summary.balanceInCentimes, 1_100_000);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 0);

  await database.collection('cashRegisters').updateOne(
    { _id: cashRegisterId },
    { $set: { active: false } },
  );
  const deactivated = await recordCashWithdrawal(withdrawalRequest({
    balanceInCentimes: 1_100_000,
    cashRegisterId,
    userId,
  }));

  assert.equal(deactivated.stale, true);
  assert.match(deactivated.errors.form, /caisse/u);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 0);
});

test('refuse les permissions ou champs invalides sans aucune écriture', async () => {
  const readOnlyUserId = await createUser(['cash.read']);
  const allowedUserId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = await insertCashRegister();
  await insertCashPayment({ amountInCentimes: 100_000, cashRegisterId });

  await assert.rejects(
    recordCashWithdrawal(withdrawalRequest({
      amount: '100',
      balanceInCentimes: 100_000,
      cashRegisterId,
      userId: readOnlyUserId,
    })),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_WITHDRAWAL_CREATE_PERMISSION,
  );
  const invalidAmount = await recordCashWithdrawal(withdrawalRequest({
    amount: '0',
    balanceInCentimes: 100_000,
    cashRegisterId,
    userId: allowedUserId,
  }));
  const invalidReason = await recordCashWithdrawal(withdrawalRequest({
    amount: '100',
    balanceInCentimes: 100_000,
    cashRegisterId,
    reason: '   ',
    userId: allowedUserId,
  }));

  assert.match(invalidAmount.errors.amount, /strictement positif/u);
  assert.match(invalidReason.errors.reason, /obligatoire/u);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 0);
});

test('compte un versement multi-tournées une seule fois dans le solde', async () => {
  const userId = await createUser(['cash.read']);
  const cashRegisterId = await insertCashRegister();
  const firstTourId = new ObjectId();
  const secondTourId = new ObjectId();

  await database.collection('cashPayments').insertOne({
    allocations: [
      {
        allocatedAmountInCentimes: 600_000,
        sourceTourCountingId: new ObjectId(),
        tourId: firstTourId,
        tourReference: 'TR-1',
      },
      {
        allocatedAmountInCentimes: 400_000,
        sourceTourCountingId: new ObjectId(),
        tourId: secondTourId,
        tourReference: 'TR-2',
      },
    ],
    amountInCentimes: 1_000_000,
    cashRegisterId,
    currency: CASH_CURRENCY,
  });

  const balance = await getTrackedCashBalance({ userId });

  assert.equal(balance.recordedReceiptsInCentimes, 1_000_000);
  assert.equal(balance.balanceInCentimes, 1_000_000);
});

test('signale une donnée financière incohérente sans la remplacer par zéro', async () => {
  const userId = await createUser(['cash.read']);
  const cashRegisterId = await insertCashRegister();
  await database.collection('cashPayments').insertOne({
    amountInCentimes: '100000',
    cashRegisterId,
    currency: CASH_CURRENCY,
  });

  const balance = await getTrackedCashBalance({ userId });
  const journal = await listCashPayments({ userId });

  assert.equal(balance.balanceInCentimes, null);
  assert.match(balance.error, /incohérente/u);
  assert.equal(journal.totalEntriesInCentimes, null);
  assert.equal(journal.netVariationInCentimes, null);
  assert.match(journal.financialDataError, /incohérente/u);
});

test('produit un journal mixte paginé, recherché et filtré avec des totaux séparés', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ], 'caissier-journal');
  const cashRegisterId = await insertCashRegister();
  const delivererId = new ObjectId();
  await insertCashPayment({
    amountInCentimes: 500_000,
    cashRegisterId,
    delivererId,
    receivedAt: new Date('2026-09-10T08:00:00.000Z'),
    reference: 'VRS-JOURNAL-1',
  });
  await insertCashPayment({
    amountInCentimes: 500_000,
    cashRegisterId,
    receivedAt: new Date('2026-09-11T08:00:00.000Z'),
    reference: 'VRS-JOURNAL-2',
  });
  const withdrawal = await recordCashWithdrawal(withdrawalRequest({
    amount: '3000',
    cashRegisterId,
    reason: 'Dépôt bancaire journal',
    userId,
  }));

  await database.collection('cashWithdrawals').updateOne(
    { _id: new ObjectId(withdrawal.withdrawal.id) },
    { $set: { withdrawnAt: new Date('2026-09-12T08:00:00.000Z') } },
  );

  const firstPage = await listCashPayments({ pageSize: 2, userId });
  const secondPage = await listCashPayments({ page: 2, pageSize: 2, userId });
  const searched = await listCashPayments({
    query: 'bancaire journal',
    userId,
  });
  const byDeliverer = await listCashPayments({
    delivererId: delivererId.toString(),
    userId,
  });

  assert.equal(firstPage.totalItems, 3);
  assert.deepEqual(firstPage.payments.map(({ type }) => type), [
    'WITHDRAWAL',
    'PAYMENT',
  ]);
  assert.equal(secondPage.payments[0].reference, 'VRS-JOURNAL-1');
  assert.equal(firstPage.totalEntriesInCentimes, 1_000_000);
  assert.equal(firstPage.totalWithdrawalsInCentimes, 300_000);
  assert.equal(firstPage.netVariationInCentimes, 700_000);
  assert.equal(searched.totalItems, 1);
  assert.equal(searched.payments[0].type, 'WITHDRAWAL');
  assert.equal(byDeliverer.totalItems, 1);
  assert.equal(byDeliverer.payments[0].type, 'PAYMENT');
  assert.equal(byDeliverer.totalWithdrawalsInCentimes, 0);
});

test('ne modifie ni dettes, ni affectations, ni ventes, ni stock', async () => {
  const userId = await createUser([
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const cashRegisterId = await insertCashRegister();
  const delivererId = new ObjectId();
  const tourId = new ObjectId();
  const paymentId = new ObjectId();
  const allocation = {
    allocatedAmountInCentimes: 100_000,
    sourceTourCountingId: new ObjectId(),
    tourId,
    tourReference: 'TR-IMMUTABLE',
  };
  await database.collection('deliverers').insertOne({
    _id: delivererId,
    debtInCentimes: 55_000,
  });
  await database.collection('tours').insertOne({
    _id: tourId,
    salesTotalInCentimes: 100_000,
  });
  await database.collection('cashPayments').insertOne({
    _id: paymentId,
    allocations: [allocation],
    amountInCentimes: 100_000,
    cashRegisterId,
    currency: CASH_CURRENCY,
  });
  await database.collection('stockMovements').insertOne({
    _id: new ObjectId(),
    quantity: 7,
    tourId,
  });
  const before = {
    deliverer: await database.collection('deliverers').findOne({ _id: delivererId }),
    payment: await database.collection('cashPayments').findOne({ _id: paymentId }),
    stock: await database.collection('stockMovements').findOne({ tourId }),
    tour: await database.collection('tours').findOne({ _id: tourId }),
  };

  await recordCashWithdrawal(withdrawalRequest({
    amount: '500',
    balanceInCentimes: 100_000,
    cashRegisterId,
    userId,
  }));
  const after = {
    deliverer: await database.collection('deliverers').findOne({ _id: delivererId }),
    payment: await database.collection('cashPayments').findOne({ _id: paymentId }),
    stock: await database.collection('stockMovements').findOne({ tourId }),
    tour: await database.collection('tours').findOne({ _id: tourId }),
  };

  assert.deepEqual(after, before);
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 1);
});
