import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_dpa_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { workAsyncStorage } = await import(
  'next/dist/server/app-render/work-async-storage.external.js'
);
const { workUnitAsyncStorage } = await import(
  'next/dist/server/app-render/work-unit-async-storage.external.js'
);
const { RequestCookies } = await import(
  'next/dist/server/web/spec-extension/cookies.js'
);
const { PermissionDeniedError } = await import('../lib/access.js');
const { calculateDelivererCashAllocationPreview } = await import(
  '../lib/cash-payment-calculations.js'
);
const {
  CASH_PAYMENT_CREATE_PERMISSION,
  CASH_READ_PERMISSION,
  listCashPayments,
  listCashRemainders,
  recordTourCashPayment,
} = await import('../lib/cash-payments.js');
const { initializeMainCashRegister } = await import(
  '../lib/cash-registers.js'
);
const { closeMongoConnection, getDatabase } = await import(
  '../lib/mongodb.js'
);
const { recordDelivererPayment } = await import(
  '../app/(protected)/cash-payment-actions.js'
);

let database;

const createUserSession = async (username, permissions) => {
  const roleId = new ObjectId();
  const token = randomBytes(32).toString('base64url');
  const userId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      permissions,
    }),
    database.collection('sessions').insertOne({
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId,
    }),
    database.collection('users').insertOne({
      _id: userId,
      active: true,
      roleIds: [roleId],
      username,
    }),
  ]);

  return { token, userId };
};

const callWithSession = async (token, callback) => {
  const cookies = new RequestCookies(new Headers({
    cookie: `syphax-session=${token}`,
  }));
  const requestStore = {
    cookies,
    phase: 'action',
    type: 'request',
    userspaceMutableCookies: cookies,
  };
  const workStore = {
    incrementalCache: {},
    route: '/caisse',
  };

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, callback));
};

const insertDeliverer = async (label = 'GLOBAL') => {
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: `LIV-${label}`,
    name: `Livreur ${label}`,
  });

  return {
    code: `LIV-${label}`,
    id: delivererId,
    name: `Livreur ${label}`,
  };
};

const insertCountedTour = async ({
  countedAt,
  deliverer,
  dueInCentimes,
  label,
}) => {
  const countingId = new ObjectId();
  const tourId = new ObjectId();
  const reference = `TRN-${label}-${tourId.toHexString().slice(-6).toUpperCase()}`;

  await Promise.all([
    database.collection('tourCountings').insertOne({
      _id: countingId,
      countedAt,
      totalDueInCentimes: dueInCentimes,
      tourId,
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      countingId,
      delivererCode: deliverer.code,
      delivererId: deliverer.id,
      delivererName: deliverer.name,
      reference,
      status: 'COUNTED',
    }),
  ]);

  return { countingId, id: tourId, reference };
};

const readRemainder = async ({ delivererId, userId }) => {
  const result = await listCashRemainders({
    pageSize: 100,
    userId: userId.toString(),
  });

  return result.remainders.find((remainder) =>
    remainder.deliverer.id === delivererId.toString()) ?? null;
};

const createSummary = ({ amount, remainder }) =>
  calculateDelivererCashAllocationPreview({
    amount,
    blockingAnomalies: remainder.blockingAnomalies,
    tours: remainder.tours,
  });

const createPaymentFormData = ({
  amount,
  cashRegisterId,
  confirmationKey = randomUUID(),
  delivererId,
  note = 'Remise globale isolée',
  summary,
}) => {
  const formData = new FormData();

  formData.set('amount', amount);
  formData.set('confirmationKey', confirmationKey);
  formData.set('delivererId', delivererId.toString());
  formData.set('expectedCashRegisterId', cashRegisterId);
  formData.set('expectedSummary', JSON.stringify(summary));
  formData.set('note', note);
  formData.set('receivedBy', new ObjectId().toString());

  return formData;
};

const insertTwoTourSituation = async () => {
  const deliverer = await insertDeliverer();
  const first = await insertCountedTour({
    countedAt: new Date('2026-09-01T08:00:00.000Z'),
    deliverer,
    dueInCentimes: 200_000,
    label: 'A',
  });
  const second = await insertCountedTour({
    countedAt: new Date('2026-09-02T08:00:00.000Z'),
    deliverer,
    dueInCentimes: 400_000,
    label: 'B',
  });

  return { deliverer, first, second };
};

before(async () => {
  database = await getDatabase();
});

beforeEach(async () => {
  await Promise.all([
    database.collection('cashPayments').deleteMany({}),
    database.collection('cashRegisters').deleteMany({}),
    database.collection('deliverers').deleteMany({}),
    database.collection('roles').deleteMany({}),
    database.collection('sessions').deleteMany({}),
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

test('l’action globale exige création et lecture caisse, sans droit livreur ou tournée', async () => {
  const cashRegister = await initializeMainCashRegister();
  const { deliverer } = await insertTwoTourSituation();
  const withoutCreate = await createUserSession('global-sans-create', [
    CASH_READ_PERMISSION,
  ]);
  const withoutRead = await createUserSession('global-sans-read', [
    CASH_PAYMENT_CREATE_PERMISSION,
  ]);
  const summary = calculateDelivererCashAllocationPreview({
    amount: '5000',
    tours: [{
      countedAt: new Date('2026-09-01T08:00:00.000Z').toISOString(),
      id: new ObjectId().toString(),
      reference: 'TRN-FORME',
      remainingDueInCentimes: 600_000,
    }],
  });
  const formData = createPaymentFormData({
    amount: '5000',
    cashRegisterId: cashRegister.id,
    delivererId: deliverer.id,
    summary,
  });

  await assert.rejects(
    callWithSession(withoutCreate.token, () =>
      recordDelivererPayment(formData)),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_PAYMENT_CREATE_PERMISSION,
  );
  await assert.rejects(
    callWithSession(withoutRead.token, () =>
      recordDelivererPayment(formData)),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('l’action valide la forme avant le service et ignore tout auteur envoyé', async () => {
  const { token } = await createUserSession('global-forme', [
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
  ]);
  const invalid = new FormData();

  invalid.set('amount', '5000');
  invalid.set('confirmationKey', randomUUID());
  invalid.set('delivererId', new ObjectId().toString());
  invalid.set('expectedCashRegisterId', new ObjectId().toString());
  invalid.set('expectedSummary', '{illisible');
  invalid.set('note', 'Forme invalide');

  const result = await callWithSession(token, () =>
    recordDelivererPayment(invalid));

  assert.equal(result.succeeded, false);
  assert.equal(result.uncertain, false);
  assert.match(result.errors.form, /récapitulatif.*illisible/u);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('encaisse 5 000 DA sur A puis B avec une seule référence et l’auteur de session', async () => {
  const cashRegister = await initializeMainCashRegister();
  const { deliverer, first, second } = await insertTwoTourSituation();
  const { token, userId } = await createUserSession('global-minimal', [
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
  ]);
  const remainder = await readRemainder({ delivererId: deliverer.id, userId });
  const summary = createSummary({ amount: '5000', remainder });
  const formData = createPaymentFormData({
    amount: '5000',
    cashRegisterId: cashRegister.id,
    delivererId: deliverer.id,
    summary,
  });
  const result = await callWithSession(token, () =>
    recordDelivererPayment(formData));
  const [journal, updatedRemainder, payments] = await Promise.all([
    listCashPayments({ userId: userId.toString() }),
    readRemainder({ delivererId: deliverer.id, userId }),
    database.collection('cashPayments').find({}).toArray(),
  ]);

  assert.equal(result.succeeded, true);
  assert.match(result.payment.reference, /^VRS-/u);
  assert.equal(result.payment.amountInCentimes, 500_000);
  assert.equal(result.payment.allocations.length, 2);
  assert.deepEqual(
    result.payment.allocations.map((allocation) => ({
      amount: allocation.allocatedAmountInCentimes,
      tourId: allocation.tourId,
    })),
    [
      { amount: 200_000, tourId: first.id.toString() },
      { amount: 300_000, tourId: second.id.toString() },
    ],
  );
  assert.equal(journal.totalItems, 1);
  assert.equal(journal.payments[0].amountInCentimes, 500_000);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].receivedBy.toString(), userId.toString());
  assert.equal(updatedRemainder.remainingDueInCentimes, 100_000);
  assert.equal(updatedRemainder.tours.length, 1);
  assert.equal(updatedRemainder.tours[0].id, second.id.toString());
});

test('double clic et rejeu de la même demande ne créent qu’un versement', async () => {
  const cashRegister = await initializeMainCashRegister();
  const { deliverer } = await insertTwoTourSituation();
  const { token, userId } = await createUserSession('global-double', [
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
  ]);
  const remainder = await readRemainder({ delivererId: deliverer.id, userId });
  const confirmationKey = randomUUID();
  const request = {
    amount: '5000',
    cashRegisterId: cashRegister.id,
    confirmationKey,
    delivererId: deliverer.id,
    summary: createSummary({ amount: '5000', remainder }),
  };
  const [first, second] = await Promise.all([
    callWithSession(token, () => recordDelivererPayment(
      createPaymentFormData(request),
    )),
    callWithSession(token, () => recordDelivererPayment(
      createPaymentFormData(request),
    )),
  ]);
  const replay = await callWithSession(token, () => recordDelivererPayment(
    createPaymentFormData(request),
  ));

  assert.equal([first, second].filter((result) => result.replayed).length, 1);
  assert.equal(replay.succeeded, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.payment.reference, first.payment.reference);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});

test('un ancien récapitulatif est refusé avec la nouvelle répartition', async () => {
  const cashRegister = await initializeMainCashRegister();
  const { deliverer, first, second } = await insertTwoTourSituation();
  const { token, userId } = await createUserSession('global-stale', [
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
  ]);
  const remainder = await readRemainder({ delivererId: deliverer.id, userId });
  const staleRequest = {
    amount: '5000',
    cashRegisterId: cashRegister.id,
    confirmationKey: randomUUID(),
    delivererId: deliverer.id,
    summary: createSummary({ amount: '5000', remainder }),
  };

  await recordTourCashPayment({
    amount: '1000',
    confirmationKey: randomUUID(),
    expectedCashRegisterId: cashRegister.id,
    expectedRemainingDueInCentimes: '200000',
    note: 'Autre onglet',
    receivedBy: userId.toString(),
    tourId: first.id.toString(),
  });

  const stale = await callWithSession(token, () => recordDelivererPayment(
    createPaymentFormData(staleRequest),
  ));

  assert.equal(stale.succeeded, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.summary.totalRemainingDueInCentimes, 500_000);
  assert.deepEqual(
    stale.summary.allocations.map((allocation) => ({
      amount: allocation.allocatedAmountInCentimes,
      tourId: allocation.tourId,
    })),
    [
      { amount: 100_000, tourId: first.id.toString() },
      { amount: 400_000, tourId: second.id.toString() },
    ],
  );
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});

test('une caisse devenue indisponible refuse sans enregistrer', async () => {
  const cashRegister = await initializeMainCashRegister();
  const { deliverer } = await insertTwoTourSituation();
  const { token, userId } = await createUserSession('global-caisse', [
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
  ]);
  const remainder = await readRemainder({ delivererId: deliverer.id, userId });
  const request = {
    amount: '5000',
    cashRegisterId: cashRegister.id,
    delivererId: deliverer.id,
    summary: createSummary({ amount: '5000', remainder }),
  };

  await database.collection('cashRegisters').updateOne(
    { _id: new ObjectId(cashRegister.id) },
    { $set: { active: false } },
  );

  const result = await callWithSession(token, () => recordDelivererPayment(
    createPaymentFormData(request),
  ));

  assert.equal(result.succeeded, false);
  assert.equal(result.stale, true);
  assert.match(result.errors.form, /caisse/u);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('une réponse perdue est résolue en rejouant exactement la même demande', async () => {
  const cashRegister = await initializeMainCashRegister();
  const { deliverer } = await insertTwoTourSituation();
  const { token, userId } = await createUserSession('global-reponse', [
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
  ]);
  const remainder = await readRemainder({ delivererId: deliverer.id, userId });
  const request = {
    amount: '5000',
    cashRegisterId: cashRegister.id,
    confirmationKey: randomUUID(),
    delivererId: deliverer.id,
    note: 'Contenu figé',
    summary: createSummary({ amount: '5000', remainder }),
  };

  await callWithSession(token, () => recordDelivererPayment(
    createPaymentFormData(request),
  ));
  const recovered = await callWithSession(token, () =>
    recordDelivererPayment(createPaymentFormData(request)));

  assert.equal(recovered.succeeded, true);
  assert.equal(recovered.replayed, true);
  assert.match(recovered.message, /déjà été enregistré/u);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});

test('la demande confirme toutes les affectations au-delà de la première page', async () => {
  const cashRegister = await initializeMainCashRegister();
  const deliverer = await insertDeliverer('PAGINATION');
  const { token, userId } = await createUserSession('global-pagination', [
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
  ]);

  for (let index = 0; index < 6; index += 1) {
    await insertCountedTour({
      countedAt: new Date(Date.UTC(2026, 8, index + 1, 8)),
      deliverer,
      dueInCentimes: 100_000,
      label: String(index + 1),
    });
  }

  const remainder = await readRemainder({ delivererId: deliverer.id, userId });
  const summary = createSummary({ amount: '5500', remainder });
  const result = await callWithSession(token, () => recordDelivererPayment(
    createPaymentFormData({
      amount: '5500',
      cashRegisterId: cashRegister.id,
      delivererId: deliverer.id,
      summary,
    }),
  ));

  assert.equal(summary.allocations.length, 6);
  assert.equal(result.succeeded, true);
  assert.equal(result.payment.allocations.length, 6);
  assert.equal(
    result.payment.allocations.reduce((total, allocation) =>
      total + allocation.allocatedAmountInCentimes, 0),
    550_000,
  );
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});
