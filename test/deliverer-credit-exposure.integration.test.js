import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_credit_exposure_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const {
  compareDelivererCreditExposure,
  getDelivererCreditExposure,
  getDelivererCreditLimit,
} = await import('../lib/deliverer-credit-limits.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');

let database;
let readerId;

const createUser = async (permissions, username = `credit-${randomUUID()}`) => {
  const roleId = new ObjectId();
  const userId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      key: `credit-${roleId.toString()}`,
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

before(async () => {
  database = await getDatabase();
  readerId = await createUser([
    'cash.read',
    'deliverers.credit-limit.read',
    'pricing.read',
  ], 'responsable-engagement');
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

const insertDeliverer = async ({ limitInCentimes } = {}) => {
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: `LIV-${delivererId.toHexString().slice(-6)}`,
    name: 'Livreur engagement',
    ...(Number.isSafeInteger(limitInCentimes)
      ? {
          creditLimit: {
            amountInCentimes: limitInCentimes,
            updatedAt: new Date(),
            updatedBy: readerId,
            version: 1,
          },
        }
      : {}),
  });

  return delivererId;
};

const insertCountedTour = async ({
  delivererId,
  status = 'COUNTED',
  totalDueInCentimes,
}) => {
  const countingId = new ObjectId();
  const tourId = new ObjectId();
  const reference = `TRN-${tourId.toHexString().toUpperCase()}`;

  await Promise.all([
    database.collection('tours').insertOne({
      _id: tourId,
      countingId,
      delivererId,
      reference,
      status,
    }),
    database.collection('tourCountings').insertOne({
      _id: countingId,
      countedAt: new Date(),
      delivererId,
      totalDueInCentimes,
      tourId,
    }),
  ]);

  return { countingId, reference, tourId };
};

const insertLoadedTour = async ({
  delivererId,
  priceInCentimes,
  quantityInBaseUnits,
  status = 'LOADED',
}) => {
  const tourId = new ObjectId();
  const reference = `TRN-${tourId.toHexString().toUpperCase()}`;

  await database.collection('tours').insertOne({
    _id: tourId,
    delivererId,
    reference,
    status,
  });
  await database.collection('tourReservations').insertOne({
    _id: new ObjectId(),
    baseUnit: 'PIECE',
    currentSalePrice: {
      amountInCentimes: 99_999_999,
      currency: 'DZD',
      taxIncluded: true,
      unit: 'PIECE',
    },
    quantityInBaseUnits,
    ...(priceInCentimes === undefined
      ? {}
      : {
          salePriceAtLoading: priceInCentimes === null
            ? null
            : {
                amountInCentimes: priceInCentimes,
                currency: 'DZD',
                taxIncluded: true,
                unit: 'PIECE',
              },
        }),
    status: 'LOADED',
    tourId,
  });

  return { reference, tourId };
};

const readExposure = (delivererId, userId = readerId) =>
  getDelivererCreditExposure({
    delivererId: delivererId.toString(),
    userId: userId.toString(),
  });

test('additionne 40 000 DA dus et 90 000 DA chargés puis signale 5 000 DA de dépassement', async () => {
  const delivererId = await insertDeliverer({
    limitInCentimes: 12_500_000,
  });
  const firstCounted = await insertCountedTour({
    delivererId,
    status: 'COUNTED',
    totalDueInCentimes: 3_000_000,
  });
  const secondCounted = await insertCountedTour({
    delivererId,
    status: 'CLOSED',
    totalDueInCentimes: 3_000_000,
  });

  await Promise.all([
    database.collection('cashPayments').insertOne({
      _id: new ObjectId(),
      amountInCentimes: 1_000_000,
      currency: 'DZD',
      sourceTourCountingId: firstCounted.countingId,
      tourId: firstCounted.tourId,
    }),
    database.collection('cashPayments').insertOne({
      _id: new ObjectId(),
      allocations: [{
        allocatedAmountInCentimes: 1_000_000,
        sourceTourCountingId: secondCounted.countingId,
        tourId: secondCounted.tourId,
      }],
      amountInCentimes: 1_000_000,
      currency: 'DZD',
      delivererId,
    }),
    insertLoadedTour({
      delivererId,
      priceInCentimes: 1_500_000,
      quantityInBaseUnits: 4,
    }),
    insertLoadedTour({
      delivererId,
      priceInCentimes: 1_500_000,
      quantityInBaseUnits: 2,
    }),
    insertLoadedTour({
      delivererId,
      priceInCentimes: 99_000_000,
      quantityInBaseUnits: 1,
      status: 'PREPARATION',
    }),
    insertLoadedTour({
      delivererId,
      priceInCentimes: 99_000_000,
      quantityInBaseUnits: 1,
      status: 'CANCELLED',
    }),
  ]);

  const result = await readExposure(delivererId);
  const storedDeliverer = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.equal(result.exposure.countedRemainderInCentimes, 4_000_000);
  assert.equal(result.exposure.loadedValueInCentimes, 9_000_000);
  assert.equal(result.exposure.engagementInCentimes, 13_000_000);
  assert.deepEqual(result.exposure.comparison, {
    amountInCentimes: 500_000,
    status: 'EXCEEDED',
  });
  assert.equal(result.exposure.reliable, true);
  assert.equal('creditExposure' in storedDeliverer, false);
  assert.equal('engagementInCentimes' in storedDeliverer, false);
});

test('compare les engagements inférieur, égal et supérieur, y compris avec une limite zéro', () => {
  assert.deepEqual(compareDelivererCreditExposure({
    engagementInCentimes: 100,
    limitInCentimes: 125,
  }), { amountInCentimes: 25, status: 'BELOW' });
  assert.deepEqual(compareDelivererCreditExposure({
    engagementInCentimes: 125,
    limitInCentimes: 125,
  }), { amountInCentimes: 0, status: 'REACHED' });
  assert.deepEqual(compareDelivererCreditExposure({
    engagementInCentimes: 130,
    limitInCentimes: 125,
  }), { amountInCentimes: 5, status: 'EXCEEDED' });
  assert.deepEqual(compareDelivererCreditExposure({
    engagementInCentimes: 1,
    limitInCentimes: 0,
  }), { amountInCentimes: 1, status: 'EXCEEDED' });
});

test('ne compare pas une limite absente mais compare une limite configurée à zéro', async () => {
  const withoutLimitId = await insertDeliverer();
  const zeroLimitId = await insertDeliverer({ limitInCentimes: 0 });

  await Promise.all([
    insertLoadedTour({
      delivererId: withoutLimitId,
      priceInCentimes: 100,
      quantityInBaseUnits: 1,
    }),
    insertLoadedTour({
      delivererId: zeroLimitId,
      priceInCentimes: 100,
      quantityInBaseUnits: 1,
    }),
  ]);

  const [withoutLimit, zeroLimit] = await Promise.all([
    readExposure(withoutLimitId),
    readExposure(zeroLimitId),
  ]);

  assert.equal(withoutLimit.creditLimit.configured, false);
  assert.equal(withoutLimit.exposure.engagementInCentimes, 100);
  assert.equal(withoutLimit.exposure.comparison, null);
  assert.equal(zeroLimit.creditLimit.configured, true);
  assert.deepEqual(zeroLimit.exposure.comparison, {
    amountInCentimes: 100,
    status: 'EXCEEDED',
  });
});

test('remplace la valeur LOADED par le reste COUNTED sans double comptage et suit les versements', async () => {
  const delivererId = await insertDeliverer({ limitInCentimes: 5_000_000 });
  const loaded = await insertLoadedTour({
    delivererId,
    priceInCentimes: 1_000_000,
    quantityInBaseUnits: 6,
  });
  const beforeCounting = await readExposure(delivererId);
  const countingId = new ObjectId();

  await database.collection('tourCountings').insertOne({
    _id: countingId,
    countedAt: new Date(),
    delivererId,
    totalDueInCentimes: 4_500_000,
    tourId: loaded.tourId,
  });
  await database.collection('tours').updateOne(
    { _id: loaded.tourId },
    { $set: { countingId, status: 'COUNTED' } },
  );

  const afterCounting = await readExposure(delivererId);

  await database.collection('cashPayments').insertOne({
    _id: new ObjectId(),
    amountInCentimes: 1_000_000,
    currency: 'DZD',
    sourceTourCountingId: countingId,
    tourId: loaded.tourId,
  });

  const afterPayment = await readExposure(delivererId);

  assert.equal(beforeCounting.exposure.engagementInCentimes, 6_000_000);
  assert.equal(afterCounting.exposure.loadedValueInCentimes, 0);
  assert.equal(afterCounting.exposure.countedRemainderInCentimes, 4_500_000);
  assert.equal(afterCounting.exposure.engagementInCentimes, 4_500_000);
  assert.equal(afterPayment.exposure.engagementInCentimes, 3_500_000);
  assert.deepEqual(afterPayment.exposure.comparison, {
    amountInCentimes: 1_500_000,
    status: 'BELOW',
  });
});

test('rend l’engagement non calculable sans remplacer un prix absent ou une anomalie financière par zéro', async () => {
  const missingPriceDelivererId = await insertDeliverer({
    limitInCentimes: 5_000_000,
  });
  const invalidCashDelivererId = await insertDeliverer({
    limitInCentimes: 5_000_000,
  });

  await Promise.all([
    insertLoadedTour({
      delivererId: missingPriceDelivererId,
      priceInCentimes: undefined,
      quantityInBaseUnits: 5,
    }),
    insertCountedTour({
      delivererId: invalidCashDelivererId,
      totalDueInCentimes: 'montant-invalide',
    }),
  ]);

  const [missingPrice, invalidCash] = await Promise.all([
    readExposure(missingPriceDelivererId),
    readExposure(invalidCashDelivererId),
  ]);

  assert.equal(missingPrice.exposure.loadedValueInCentimes, null);
  assert.equal(missingPrice.exposure.engagementInCentimes, null);
  assert.equal(missingPrice.exposure.comparison, null);
  assert.equal(missingPrice.exposure.reliable, false);
  assert.equal(
    missingPrice.exposure.anomalies[0].code,
    'MISSING_HISTORICAL_PRICE',
  );
  assert.equal(invalidCash.exposure.countedRemainderInCentimes, null);
  assert.equal(invalidCash.exposure.engagementInCentimes, null);
  assert.equal(invalidCash.exposure.comparison, null);
  assert.equal(invalidCash.exposure.reliable, false);
  assert.equal(invalidCash.exposure.anomalies[0].code, 'INVALID_COUNTING');
});

test('exige les trois lectures pour l’engagement sans modifier le droit de consulter la limite seule', async () => {
  const delivererId = await insertDeliverer({ limitInCentimes: 1_000_000 });
  const limitOnlyId = await createUser([
    'deliverers.credit-limit.read',
  ], 'limite-seule');
  const withoutCashId = await createUser([
    'deliverers.credit-limit.read',
    'pricing.read',
  ], 'sans-caisse');
  const withoutCreditLimitId = await createUser([
    'cash.read',
    'pricing.read',
  ], 'sans-limite');
  const withoutPricingId = await createUser([
    'cash.read',
    'deliverers.credit-limit.read',
  ], 'sans-tarifs');

  const limit = await getDelivererCreditLimit({
    delivererId: delivererId.toString(),
    userId: limitOnlyId.toString(),
  });

  assert.equal(limit.creditLimit.amountInCentimes, 1_000_000);
  await assert.rejects(
    readExposure(delivererId, withoutCreditLimitId),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.credit-limit.read',
  );
  await assert.rejects(
    readExposure(delivererId, limitOnlyId),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'cash.read',
  );
  await assert.rejects(
    readExposure(delivererId, withoutCashId),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'cash.read',
  );
  await assert.rejects(
    readExposure(delivererId, withoutPricingId),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'pricing.read',
  );
});
