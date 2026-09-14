import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_cash_withdrawals_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  CASH_WITHDRAWAL_CREATE_PERMISSION,
  getCashWithdrawalPreviewData,
} = await import('../lib/cash-withdrawals.js');

let database;

const createUser = async (permissions) => {
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
      username: `withdrawal-${userId.toString()}`,
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
    database.collection('roles').deleteMany({}),
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
  assert.equal(preview.recordedReceiptsInCentimes, 200_000);
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
