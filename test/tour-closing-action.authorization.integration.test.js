import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_close_action_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
const { CASH_READ_PERMISSION } = await import('../lib/cash-payments.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  TOUR_CLOSE_PERMISSION,
  getTourClosurePreview,
} = await import('../lib/tour-closures.js');
const { closeTour } = await import(
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
      lines: [],
      totalDueInCentimes: 750_000,
      tourId,
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      countingId,
      delivererCode: 'LIV-ACTION-CLOTURE',
      delivererId,
      delivererName: 'Livreur action clôture',
      reference: `TRN-${tourId.toString().toUpperCase()}`,
      status: 'COUNTED',
    }),
  ]);

  return { countingId, tourId };
};

const createClosureFormData = (digest) => {
  const formData = new FormData();

  formData.set('closureDigest', digest);
  formData.set('amountDueInCentimes', '1');
  formData.set('amountPaidInCentimes', '1');
  formData.set('remainingDueInCentimes', '0');
  formData.set('closedBy', new ObjectId().toString());

  return formData;
};

before(async () => {
  database = await getDatabase();
});

beforeEach(async () => {
  await Promise.all([
    database.collection('cashPayments').deleteMany({}),
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

test('la Server Action exige clôture, lecture tournée et lecture caisse', async () => {
  const { tourId } = await insertCountedTour();
  const missingClose = await createUserSession('sans-cloture', [
    'tours.read',
    CASH_READ_PERMISSION,
  ]);
  const missingTourRead = await createUserSession('sans-lecture-tournee', [
    TOUR_CLOSE_PERMISSION,
    CASH_READ_PERMISSION,
  ]);
  const missingCashRead = await createUserSession('sans-lecture-caisse', [
    TOUR_CLOSE_PERMISSION,
    'tours.read',
  ]);
  const callAction = (token) => callWithSession(token, () => closeTour(
    tourId.toString(),
    { revision: 0 },
    createClosureFormData('a'.repeat(64)),
  ));

  await assert.rejects(
    callAction(missingClose.token),
    (error) => error instanceof PermissionDeniedError
      && error.permission === TOUR_CLOSE_PERMISSION,
  );
  await assert.rejects(
    callAction(missingTourRead.token),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'tours.read',
  );
  await assert.rejects(
    callAction(missingCashRead.token),
    (error) => error instanceof PermissionDeniedError
      && error.permission === CASH_READ_PERMISSION,
  );
  assert.equal((await database.collection('tours').findOne({
    _id: tourId,
  })).status, 'COUNTED');
});

test('la Server Action prend les montants et l’auteur depuis le serveur et rejoue la réussite', async () => {
  const { countingId, tourId } = await insertCountedTour();
  const { token, userId } = await createUserSession('responsable-action', [
    TOUR_CLOSE_PERMISSION,
    'tours.read',
    CASH_READ_PERMISSION,
  ]);
  const preview = await getTourClosurePreview({
    tourId: tourId.toString(),
    userId: userId.toString(),
  });
  const formData = createClosureFormData(preview.digest);
  const first = await callWithSession(token, () => closeTour(
    tourId.toString(),
    { revision: 0 },
    formData,
  ));
  const storedAfterFirst = await database.collection('tours').findOne({
    _id: tourId,
  });
  const replay = await callWithSession(token, () => closeTour(
    tourId.toString(),
    first,
    formData,
  ));
  const [storedAfterReplay, counting] = await Promise.all([
    database.collection('tours').findOne({ _id: tourId }),
    database.collection('tourCountings').findOne({ _id: countingId }),
  ]);

  assert.equal(first.succeeded, true);
  assert.equal(first.replayed, false);
  assert.equal(replay.succeeded, true);
  assert.equal(replay.replayed, true);
  assert.equal(storedAfterFirst.status, 'CLOSED');
  assert.equal(storedAfterFirst.closedBy.toString(), userId.toString());
  assert.equal(
    storedAfterReplay.closedAt.toISOString(),
    storedAfterFirst.closedAt.toISOString(),
  );
  assert.equal(storedAfterReplay.closedBy.toString(), userId.toString());
  assert.equal(counting.totalDueInCentimes, 750_000);
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
});
