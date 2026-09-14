import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_deliverer_credit_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const {
  getDelivererCreditLimit,
  updateDelivererCreditLimit,
  validateDelivererCreditLimit,
} = await import('../lib/deliverer-credit-limits.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');

let database;
let updaterId;

before(async () => {
  database = await getDatabase();
  updaterId = new ObjectId();
  const roleId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      key: 'deliverer-credit-test',
      permissions: [
        'deliverers.credit-limit.read',
        'deliverers.credit-limit.update',
      ],
    }),
    database.collection('users').insertOne({
      _id: updaterId,
      active: true,
      roleIds: [roleId],
      username: 'responsable-credit',
    }),
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

const insertDeliverer = async () => {
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: `LIV-${delivererId.toHexString().slice(-6)}`,
    name: 'Livreur crédit',
  });

  return delivererId;
};

const readLimit = (delivererId, userId = updaterId) =>
  getDelivererCreditLimit({
    delivererId: delivererId.toString(),
    userId: userId.toString(),
  });

const updateLimit = ({
  amount,
  delivererId,
  expectedVersion,
  userId = updaterId,
}) => updateDelivererCreditLimit({
  amount,
  delivererId: delivererId.toString(),
  expectedVersion,
  updatedBy: userId.toString(),
});

test('conserve un livreur existant sans limite comme non configuré', async () => {
  const delivererId = await insertDeliverer();
  const result = await readLimit(delivererId);
  const stored = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.deepEqual(result.creditLimit, {
    amountInCentimes: null,
    configured: false,
    updatedAt: null,
    updatedBy: null,
    version: 0,
  });
  assert.equal('creditLimit' in stored, false);
  assert.equal('creditLimitHistory' in stored, false);
});

test('enregistre puis modifie la limite, avec zéro distinct de l’absence et une traçabilité serveur', async () => {
  const delivererId = await insertDeliverer();
  const startedAt = new Date();
  const first = await updateLimit({
    amount: '150000,25',
    delivererId,
    expectedVersion: 0,
  });
  const second = await updateLimit({
    amount: '0',
    delivererId,
    expectedVersion: 1,
  });
  const [read, stored] = await Promise.all([
    readLimit(delivererId),
    database.collection('deliverers').findOne({ _id: delivererId }),
  ]);

  assert.equal(first.changed, true);
  assert.equal(first.creditLimit.amountInCentimes, 15_000_025);
  assert.equal(second.changed, true);
  assert.equal(read.creditLimit.configured, true);
  assert.equal(read.creditLimit.amountInCentimes, 0);
  assert.equal(read.creditLimit.version, 2);
  assert.equal(read.creditLimit.updatedBy, 'responsable-credit');
  assert.ok(new Date(read.creditLimit.updatedAt) >= startedAt);
  assert.equal(stored.creditLimit.amountInCentimes, 0);
  assert.ok(stored.creditLimit.updatedBy.equals(updaterId));
  assert.ok(stored.creditLimit.updatedAt >= startedAt);
  assert.deepEqual(
    stored.creditLimitHistory.map((change) => ({
      newAmountInCentimes: change.newAmountInCentimes,
      previousAmountInCentimes: change.previousAmountInCentimes,
    })),
    [
      { newAmountInCentimes: 15_000_025, previousAmountInCentimes: null },
      { newAmountInCentimes: 0, previousAmountInCentimes: 15_000_025 },
    ],
  );
  assert.ok(stored.creditLimitHistory.every((change) =>
    change.changedAt >= startedAt && change.changedBy.equals(updaterId)));
});

test('n’ajoute aucune trace lors d’une confirmation sans changement', async () => {
  const delivererId = await insertDeliverer();

  await updateLimit({ amount: '2500.50', delivererId, expectedVersion: 0 });

  const beforeReplay = await database.collection('deliverers').findOne({
    _id: delivererId,
  });
  const replay = await updateLimit({
    amount: '2500,50',
    delivererId,
    expectedVersion: 1,
  });
  const afterReplay = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.equal(replay.changed, false);
  assert.equal(afterReplay.creditLimitHistory.length, 1);
  assert.equal(
    afterReplay.creditLimit.updatedAt.getTime(),
    beforeReplay.creditLimit.updatedAt.getTime(),
  );
  assert.equal(afterReplay.creditLimit.version, 1);
});

test('refuse les montants absents, négatifs, invalides, trop précis ou hors limite numérique', async () => {
  const invalidAmounts = [
    '',
    '-1',
    '12.345',
    'abc',
    '90071992547410',
  ];

  for (const amount of invalidAmounts) {
    const validation = validateDelivererCreditLimit(amount);

    assert.ok(validation.errors.amount);
  }

  assert.equal(
    validateDelivererCreditLimit('90071992547409.91').data.amountInCentimes,
    Number.MAX_SAFE_INTEGER,
  );

  const delivererId = await insertDeliverer();

  for (const amount of invalidAmounts) {
    const result = await updateLimit({
      amount,
      delivererId,
      expectedVersion: 0,
    });

    assert.ok(result.errors.amount);
  }

  const stored = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.equal('creditLimit' in stored, false);
  assert.equal('creditLimitHistory' in stored, false);
});

test('refuse l’écrasement concurrent et ne garde que la première trace', async () => {
  const delivererId = await insertDeliverer();
  const [first, second] = await Promise.all([
    updateLimit({ amount: '1000', delivererId, expectedVersion: 0 }),
    updateLimit({ amount: '2000', delivererId, expectedVersion: 0 }),
  ]);
  const stored = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.equal([first, second].filter((result) => result.changed).length, 1);
  assert.equal([first, second].filter((result) => result.stale).length, 1);
  assert.equal(stored.creditLimit.version, 1);
  assert.equal(stored.creditLimitHistory.length, 1);
  assert.ok([100_000, 200_000].includes(stored.creditLimit.amountInCentimes));
});

test('protège séparément lecture et modification sans aucun effet métier annexe', async () => {
  const delivererId = await insertDeliverer();
  const unauthorizedId = new ObjectId();
  const unrelatedRoleId = new ObjectId();
  const tourId = new ObjectId();
  const productId = new ObjectId();
  const reservationId = new ObjectId();
  const paymentId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: unrelatedRoleId,
      permissions: [
        'cash.payments.create',
        'deliverers.read',
        'deliverers.update',
      ],
    }),
    database.collection('users').insertOne({
      _id: unauthorizedId,
      active: true,
      roleIds: [unrelatedRoleId],
      username: 'sans-droits-credit',
    }),
    database.collection('products').insertOne({
      _id: productId,
      code: 'PRD-CREDIT-INCHANGE',
      stockReferenceVersion: 4,
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      delivererId,
      status: 'PREPARATION',
    }),
    database.collection('tourReservations').insertOne({
      _id: reservationId,
      productId,
      quantityInBaseUnits: 10,
      status: 'ACTIVE',
      tourId,
    }),
    database.collection('cashPayments').insertOne({
      _id: paymentId,
      amountInCentimes: 50_000,
      delivererId,
    }),
  ]);

  await assert.rejects(
    readLimit(delivererId, unauthorizedId),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.credit-limit.read',
  );
  await assert.rejects(
    updateLimit({
      amount: '5000',
      delivererId,
      expectedVersion: 0,
      userId: unauthorizedId,
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.credit-limit.update',
  );

  const [productBefore, tourBefore, reservationBefore, paymentBefore] =
    await Promise.all([
      database.collection('products').findOne({ _id: productId }),
      database.collection('tours').findOne({ _id: tourId }),
      database.collection('tourReservations').findOne({ _id: reservationId }),
      database.collection('cashPayments').findOne({ _id: paymentId }),
    ]);

  await updateLimit({ amount: '5000', delivererId, expectedVersion: 0 });

  const [productAfter, tourAfter, reservationAfter, paymentAfter] =
    await Promise.all([
      database.collection('products').findOne({ _id: productId }),
      database.collection('tours').findOne({ _id: tourId }),
      database.collection('tourReservations').findOne({ _id: reservationId }),
      database.collection('cashPayments').findOne({ _id: paymentId }),
    ]);

  assert.deepEqual(productAfter, productBefore);
  assert.deepEqual(tourAfter, tourBefore);
  assert.deepEqual(reservationAfter, reservationBefore);
  assert.deepEqual(paymentAfter, paymentBefore);
});
