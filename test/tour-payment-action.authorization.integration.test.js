import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_pay_action_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
const {
  CASH_PAYMENT_CREATE_PERMISSION,
  CASH_READ_PERMISSION,
} = await import('../lib/cash-payments.js');
const { initializeMainCashRegister } = await import('../lib/cash-registers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const { recordTourPayment } = await import(
  '../app/(protected)/tournees/[id]/actions.js'
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
    route: '/tournees/[id]',
  };

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, callback));
};

const insertCountedTour = async () => {
  const countingId = new ObjectId();
  const delivererId = new ObjectId();
  const tourId = new ObjectId();

  await Promise.all([
    database.collection('tourCountings').insertOne({
      _id: countingId,
      totalDueInCentimes: 750_000,
      tourId,
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      countingId,
      delivererCode: 'LIV-ACTION',
      delivererId,
      delivererName: 'Livreur action',
      reference: `TRN-${tourId.toString().toUpperCase()}`,
      status: 'COUNTED',
    }),
  ]);

  return { countingId, delivererId, tourId };
};

const createPaymentFormData = ({
  amount = '5000',
  cashRegisterId,
  confirmationKey,
}) => {
  const formData = new FormData();

  formData.set('amount', amount);
  formData.set('confirmationKey', confirmationKey);
  formData.set('expectedCashRegisterId', cashRegisterId);
  formData.set('note', 'Versement depuis la fiche');
  formData.set('receivedBy', new ObjectId().toString());
  formData.set('amountDueInCentimes', '1');
  formData.set('remainingDueInCentimes', '1');

  return formData;
};

before(async () => {
  database = await getDatabase();
});

beforeEach(async () => {
  await Promise.all([
    database.collection('cashPayments').deleteMany({}),
    database.collection('cashRegisters').deleteMany({}),
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

test('l’action exige le droit d’encaisser puis la lecture financière', async () => {
  const cashRegister = await initializeMainCashRegister();
  const { tourId } = await insertCountedTour();
  const withoutCreate = await createUserSession('sans-encaissement', [
    CASH_READ_PERMISSION,
    'tours.read',
  ]);
  const withoutRead = await createUserSession('sans-lecture-caisse', [
    CASH_PAYMENT_CREATE_PERMISSION,
    'tours.read',
  ]);
  const createCall = (token) => callWithSession(token, () =>
    recordTourPayment(
      tourId.toString(),
      { revision: 0 },
      createPaymentFormData({
        cashRegisterId: cashRegister.id,
        confirmationKey: randomUUID(),
      }),
    ));

  await assert.rejects(
    createCall(withoutCreate.token),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_PAYMENT_CREATE_PERMISSION,
  );
  await assert.rejects(
    createCall(withoutRead.token),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});

test('l’action prend auteur, dû et reste depuis le serveur', async () => {
  const cashRegister = await initializeMainCashRegister();
  const { tourId } = await insertCountedTour();
  const { token, userId } = await createUserSession('caissier-action', [
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
    'tours.read',
  ]);
  const confirmationKey = randomUUID();
  const result = await callWithSession(token, () => recordTourPayment(
    tourId.toString(),
    { revision: 0 },
    createPaymentFormData({
      cashRegisterId: cashRegister.id,
      confirmationKey,
    }),
  ));
  const payment = await database.collection('cashPayments').findOne({
    tourId,
  });

  assert.equal(result.succeeded, true);
  assert.match(result.paymentReference, /^VRS-/u);
  assert.notEqual(result.confirmationKey, confirmationKey);
  assert.equal(payment.receivedBy.toString(), userId.toString());
  assert.equal(payment.amountInCentimes, 500_000);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});

test('l’action conserve la clé après erreur et la renouvelle après réussite', async () => {
  const cashRegister = await initializeMainCashRegister();
  const { tourId } = await insertCountedTour();
  const { token } = await createUserSession('caissier-reprise', [
    CASH_READ_PERMISSION,
    CASH_PAYMENT_CREATE_PERMISSION,
    'tours.read',
  ]);
  const confirmationKey = randomUUID();
  const callAction = (amount, previousState) => callWithSession(token, () =>
    recordTourPayment(
      tourId.toString(),
      previousState,
      createPaymentFormData({
        amount,
        cashRegisterId: cashRegister.id,
        confirmationKey,
      }),
    ));
  const invalid = await callAction('8000', { revision: 0 });
  const valid = await callAction('5000', invalid);

  assert.equal(invalid.confirmationKey, confirmationKey);
  assert.equal(invalid.values.amount, '8000');
  assert.ok(invalid.errors.amount);
  assert.equal(valid.succeeded, true);
  assert.notEqual(valid.confirmationKey, confirmationKey);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 1);
});
