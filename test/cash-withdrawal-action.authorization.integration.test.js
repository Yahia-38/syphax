import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_wda_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
const { initializeMainCashRegister } = await import('../lib/cash-registers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const { CASH_WITHDRAWAL_CREATE_PERMISSION } = await import(
  '../lib/cash-withdrawals.js'
);
const { recordWithdrawal } = await import(
  '../app/(protected)/cash-withdrawal-actions.js'
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

const createWithdrawalFormData = ({ cashRegisterId, confirmationKey }) => {
  const formData = new FormData();

  formData.set('amount', '3000');
  formData.set('confirmationKey', confirmationKey);
  formData.set('expectedBalanceInCentimes', '1000000');
  formData.set('expectedCashRegisterId', cashRegisterId);
  formData.set('reason', 'Dépôt bancaire via action');
  formData.set('withdrawnBy', new ObjectId().toString());

  return formData;
};

before(async () => {
  database = await getDatabase();
});

beforeEach(async () => {
  await Promise.all([
    database.collection('cashPayments').deleteMany({}),
    database.collection('cashRegisters').deleteMany({}),
    database.collection('cashWithdrawals').deleteMany({}),
    database.collection('roles').deleteMany({}),
    database.collection('sessions').deleteMany({}),
    database.collection('users').deleteMany({}),
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('l’action exige création et lecture avant tout retrait', async () => {
  const cashRegister = await initializeMainCashRegister();
  await database.collection('cashPayments').insertOne({
    amountInCentimes: 1_000_000,
    cashRegisterId: new ObjectId(cashRegister.id),
    currency: 'DZD',
  });
  const withoutCreate = await createUserSession('sans-retrait', ['cash.read']);
  const withoutRead = await createUserSession('sans-lecture', [
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const call = (token) => callWithSession(token, () => recordWithdrawal(
    createWithdrawalFormData({
      cashRegisterId: cashRegister.id,
      confirmationKey: randomUUID(),
    }),
  ));

  await assert.rejects(
    call(withoutCreate.token),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_WITHDRAWAL_CREATE_PERMISSION,
  );
  await assert.rejects(
    call(withoutRead.token),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'cash.read',
  );
  assert.equal(await database.collection('cashWithdrawals').countDocuments({}), 0);
});

test('l’action prend l’auteur dans la session et retourne la référence', async () => {
  const cashRegister = await initializeMainCashRegister();
  await database.collection('cashPayments').insertOne({
    amountInCentimes: 1_000_000,
    cashRegisterId: new ObjectId(cashRegister.id),
    currency: 'DZD',
  });
  const { token, userId } = await createUserSession('caissier-retrait', [
    'cash.read',
    CASH_WITHDRAWAL_CREATE_PERMISSION,
  ]);
  const confirmationKey = randomUUID();
  const result = await callWithSession(token, () => recordWithdrawal(
    createWithdrawalFormData({
      cashRegisterId: cashRegister.id,
      confirmationKey,
    }),
  ));
  const stored = await database.collection('cashWithdrawals').findOne({
    confirmationKey,
  });

  assert.equal(result.succeeded, true);
  assert.match(result.withdrawal.reference, /^RTR-/u);
  assert.notEqual(result.nextConfirmationKey, confirmationKey);
  assert.equal(stored.withdrawnBy.toString(), userId.toString());
  assert.equal(stored.amountInCentimes, 300_000);
});
