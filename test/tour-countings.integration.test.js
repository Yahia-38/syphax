import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_count_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { seedValuedStockReceipt, seedValuedTourLoading } = await import('./helpers/stock-valuation-fixtures.js');
const { PermissionDeniedError } = await import('../lib/access.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  confirmTourCounting,
  getTourCountingSheet,
} = await import('../lib/tour-countings.js');
const {
  TOUR_RETURN_INPUT_KIND,
  getProductStockSummaries,
  listProductStockMovements,
} = await import('../lib/stock-movements.js');
const { formatTourStatus } = await import('../lib/tours.js');

let database;
let fullAccessUserId;

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
      username: `comptage-${userId.toHexString()}`,
    }),
  ]);

  return userId;
};

const insertLoadedTour = async ({ historicalPrice = true } = {}) => {
  const delivererId = new ObjectId();
  const productId = new ObjectId();
  const reservationId = new ObjectId();
  const tourId = new ObjectId();

  await Promise.all([
    database.collection('deliverers').insertOne({
      _id: delivererId,
      active: true,
      code: `LIV-${delivererId.toHexString().slice(-6)}`,
      name: 'Livreur comptage',
    }),
    database.collection('products').insertOne({
      _id: productId,
      active: true,
      baseUnit: 'BOUTEILLE',
      code: `PRD-${productId.toHexString().slice(-6)}`,
      designation: 'Bouteille test',
      salePrice: {
        amountInCentimes: 99_900,
        currency: 'DZD',
        taxIncluded: true,
        unit: 'BOUTEILLE',
      },
    }),
    database.collection('tours').insertOne({
      _id: tourId,
      loadedAt: new Date('2026-09-14T10:00:00.000Z'),
      loadedBy: fullAccessUserId,
      delivererId,
      reference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
      status: 'LOADED',
    }),
    database.collection('tourReservations').insertOne({
      _id: reservationId,
      baseUnit: 'BOUTEILLE',
      productCode: 'PRD-HISTORIQUE',
      productDesignation: 'Désignation historique',
      productId,
      quantityInBaseUnits: 60,
      quantityMode: 'DIRECT',
      reservedAt: new Date('2026-09-14T09:00:00.000Z'),
      ...(historicalPrice
        ? {
            salePriceAtLoading: {
              amountInCentimes: 15_000,
              currency: 'DZD',
              taxIncluded: true,
              unit: 'BOUTEILLE',
            },
          }
        : {}),
      status: 'LOADED',
      tourId,
    }),
  ]);

  await seedValuedStockReceipt({ database, productId, baseUnit: 'BOUTEILLE', recordedBy: fullAccessUserId });
  await seedValuedTourLoading({ database, productId, tourId, reservationId, baseUnit: 'BOUTEILLE', quantityInBaseUnits: 60, recordedBy: fullAccessUserId });
  return { delivererId, productId, reservationId, tourId };
};

before(async () => {
  database = await getDatabase();
  fullAccessUserId = await createUser([
    'tours.read',
    'tours.count.prepare',
    'tours.count.confirm',
    'pricing.read',
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('retourne uniquement les données historiques nécessaires sans écrire', async () => {
  const { productId, reservationId, tourId } = await insertLoadedTour();
  const beforeCounts = await Promise.all([
    database.collection('tours').countDocuments({}),
    database.collection('tourReservations').countDocuments({}),
    database.collection('stockMovements').countDocuments({}),
  ]);

  const sheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });

  await database.collection('products').updateOne(
    { _id: productId },
    { $set: { 'salePrice.amountInCentimes': 200_000 } },
  );

  const refreshedSheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });
  const [afterCounts, storedReservation] = await Promise.all([
    Promise.all([
      database.collection('tours').countDocuments({}),
      database.collection('tourReservations').countDocuments({}),
      database.collection('stockMovements').countDocuments({}),
    ]),
    database.collection('tourReservations').findOne({ _id: reservationId }),
  ]);

  assert.deepEqual(sheet.errors, {});
  assert.equal(sheet.lines.length, 1);
  assert.equal(sheet.lines[0].productCode, 'PRD-HISTORIQUE');
  assert.equal(sheet.lines[0].productDesignation, 'Désignation historique');
  assert.equal(sheet.lines[0].quantityInBaseUnits, 60);
  assert.equal(sheet.lines[0].salePriceAtLoading.amountInCentimes, 15_000);
  assert.equal(
    refreshedSheet.lines[0].salePriceAtLoading.amountInCentimes,
    15_000,
  );
  assert.deepEqual(afterCounts, beforeCounts);
  assert.equal(storedReservation.status, 'LOADED');
  assert.equal('returnedQuantityInBaseUnits' in storedReservation, false);
  assert.equal('soldQuantityInBaseUnits' in storedReservation, false);
  assert.equal('amountDueInCentimes' in storedReservation, false);
});

test('laisse un prix historique absent explicitement non renseigné', async () => {
  const { tourId } = await insertLoadedTour({ historicalPrice: false });
  const sheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });

  assert.equal(sheet.lines[0].quantityInBaseUnits, 60);
  assert.equal(sheet.lines[0].salePriceAtLoading, null);
});

test('refuse la feuille sans chacun des droits nécessaires', async () => {
  const { tourId } = await insertLoadedTour();
  const permissionCases = [
    {
      expected: 'tours.read',
      permissions: ['tours.count.prepare', 'pricing.read'],
    },
    {
      expected: 'tours.count.prepare',
      permissions: ['tours.read', 'pricing.read'],
    },
    {
      expected: 'pricing.read',
      permissions: ['tours.read', 'tours.count.prepare'],
    },
  ];

  for (const permissionCase of permissionCases) {
    const userId = await createUser(permissionCase.permissions);

    await assert.rejects(
      getTourCountingSheet({
        tourId: tourId.toString(),
        userId: userId.toString(),
      }),
      (error) => error instanceof PermissionDeniedError
        && error.permission === permissionCase.expected,
    );
  }
});

test('refuse une tournée qui n’est pas chargée sans modifier son statut', async () => {
  const tourId = new ObjectId();

  await database.collection('tours').insertOne({
    _id: tourId,
    reference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
    status: 'PREPARATION',
  });

  const sheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });
  const storedTour = await database.collection('tours').findOne({ _id: tourId });

  assert.match(sheet.errors.form, /uniquement pour une tournée chargée/u);
  assert.deepEqual(sheet.lines, []);
  assert.equal(storedTour.status, 'PREPARATION');
});

const submitCounting = async ({
  confirmationKey = randomUUID(),
  lines,
  tourId,
  userId = fullAccessUserId,
}) => {
  const sheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: userId.toString(),
  });

  return confirmTourCounting({
    confirmationKey,
    countedBy: userId.toString(),
    expectedSheetDigest: sheet.digest,
    lines,
    tourId: tourId.toString(),
  });
};

const addLoadedLine = async ({
  amountInCentimes = 20_000,
  baseUnit = 'PIECE',
  quantityInBaseUnits = 10,
  tourId,
}) => {
  const productId = new ObjectId();
  const reservationId = new ObjectId();

  await Promise.all([
    database.collection('products').insertOne({
      _id: productId,
      active: true,
      baseUnit,
      code: `PRD-${productId.toHexString().slice(-6)}`,
      designation: `Produit ${productId.toHexString().slice(-4)}`,
    }),
    database.collection('tourReservations').insertOne({
      _id: reservationId,
      baseUnit,
      productCode: `PRD-${productId.toHexString().slice(-6)}`,
      productDesignation: `Produit ${productId.toHexString().slice(-4)}`,
      productId,
      quantityInBaseUnits,
      quantityMode: 'DIRECT',
      salePriceAtLoading: {
        amountInCentimes,
        currency: 'DZD',
        taxIncluded: true,
        unit: baseUnit,
      },
      status: 'LOADED',
      tourId,
    }),
  ]);

  await seedValuedStockReceipt({ database, productId, baseUnit, quantityInBaseUnits, amountInCentimes: quantityInBaseUnits * 100, recordedBy: fullAccessUserId });
  await seedValuedTourLoading({ database, productId, tourId, reservationId, baseUnit, quantityInBaseUnits, recordedBy: fullAccessUserId });
  return { productId, reservationId };
};

test('enregistre 60 chargées, 10 retournées et 7 500 DA dus atomiquement', async () => {
  const { productId, reservationId, tourId } = await insertLoadedTour();
  const confirmationKey = randomUUID();
  const sheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });
  const input = {
    confirmationKey,
    countedBy: fullAccessUserId.toString(),
    expectedSheetDigest: sheet.digest,
    lines: [{
      amountDueInCentimes: 1,
      lineId: reservationId.toString(),
      returnedQuantity: '10',
      soldQuantityInBaseUnits: 59,
    }],
    tourId: tourId.toString(),
  };
  const [firstResult, secondResult] = await Promise.all([
    confirmTourCounting(input),
    confirmTourCounting(input),
  ]);
  const [
    counting,
    movements,
    tour,
    stock,
    storedSheet,
    visibleHistory,
    hiddenHistory,
  ] = await Promise.all([
    database.collection('tourCountings').findOne({ tourId }),
    database.collection('stockMovements').find({
      kind: TOUR_RETURN_INPUT_KIND,
      sourceTourId: tourId,
    }).toArray(),
    database.collection('tours').findOne({ _id: tourId }),
    getProductStockSummaries([productId], { database }),
    getTourCountingSheet({
      tourId: tourId.toString(),
      userId: fullAccessUserId.toString(),
    }),
    listProductStockMovements(productId, {
      database,
      includeTourSources: true,
    }),
    listProductStockMovements(productId, {
      database,
      includeTourSources: false,
    }),
  ]);

  assert.equal(firstResult.replayed !== secondResult.replayed, true);
  assert.equal(await database.collection('tourCountings').countDocuments({
    tourId,
  }), 1);
  assert.equal(counting.lines[0].quantityInBaseUnits, 60);
  assert.equal(counting.lines[0].returnedQuantityInBaseUnits, 10);
  assert.equal(counting.lines[0].soldQuantityInBaseUnits, 50);
  assert.equal(counting.lines[0].salePriceAtLoading.amountInCentimes, 15_000);
  assert.equal(counting.lines[0].amountDueInCentimes, 750_000);
  assert.equal(counting.totalDueInCentimes, 750_000);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].quantityDeltaInBaseUnits, 10);
  assert.ok(movements[0].sourceTourCountingId.equals(counting._id));
  assert.ok(movements[0].sourceTourReservationId.equals(reservationId));
  assert.equal(movements[0].baseUnit, 'BOUTEILLE');
  assert.equal(movements[0].occurredOn.getTime(), counting.countedAt.getTime());
  assert.equal('amountDueInCentimes' in movements[0], false);
  assert.equal('salePriceAtLoading' in movements[0], false);
  assert.equal(tour.status, 'COUNTED');
  assert.equal(formatTourStatus(tour.status), 'Comptée');
  assert.ok(tour.countingId.equals(counting._id));
  assert.ok(tour.countedBy.equals(fullAccessUserId));
  assert.equal(stock.get(productId.toString()).quantityInBaseUnits, 50);
  assert.equal(stock.get(productId.toString()).reservedQuantityInBaseUnits, 0);
  assert.equal(stock.get(productId.toString()).availableQuantityInBaseUnits, 50);
  assert.equal(storedSheet.recorded, true);
  assert.equal(storedSheet.totalDueInCentimes, 750_000);
  assert.equal(storedSheet.lines[0].returnedQuantityInBaseUnits, 10);
  assert.equal(visibleHistory.find((movement) =>
    movement.kind === TOUR_RETURN_INPUT_KIND).sourceTour.id, tourId.toString());
  assert.equal(hiddenHistory.find((movement) =>
    movement.kind === TOUR_RETURN_INPUT_KIND).sourceTour, null);
});

test('enregistre les retours nul et complet sans mouvement de stock nul', async () => {
  const noReturn = await insertLoadedTour();
  const fullReturn = await insertLoadedTour();
  const [noReturnResult, fullReturnResult] = await Promise.all([
    submitCounting({
      lines: [{
        lineId: noReturn.reservationId.toString(),
        returnedQuantity: '0',
      }],
      tourId: noReturn.tourId,
    }),
    submitCounting({
      lines: [{
        lineId: fullReturn.reservationId.toString(),
        returnedQuantity: '60',
      }],
      tourId: fullReturn.tourId,
    }),
  ]);
  const [noReturnCounting, fullReturnCounting, noReturnMovements, fullStock] =
    await Promise.all([
      database.collection('tourCountings').findOne({ tourId: noReturn.tourId }),
      database.collection('tourCountings').findOne({ tourId: fullReturn.tourId }),
      database.collection('stockMovements').countDocuments({
        kind: TOUR_RETURN_INPUT_KIND,
        sourceTourId: noReturn.tourId,
      }),
      getProductStockSummaries([fullReturn.productId], { database }),
    ]);

  assert.ok(noReturnResult.countingId);
  assert.ok(fullReturnResult.countingId);
  assert.equal(noReturnCounting.lines[0].returnedQuantityInBaseUnits, 0);
  assert.equal(noReturnCounting.lines[0].soldQuantityInBaseUnits, 60);
  assert.equal(noReturnCounting.totalDueInCentimes, 900_000);
  assert.equal(noReturnMovements, 0);
  assert.equal(fullReturnCounting.lines[0].soldQuantityInBaseUnits, 0);
  assert.equal(fullReturnCounting.totalDueInCentimes, 0);
  assert.equal(
    fullStock.get(fullReturn.productId.toString()).quantityInBaseUnits,
    100,
  );
});

test('compte toutes les lignes au-delà d’une page et conserve les autres réservations', async () => {
  const first = await insertLoadedTour();
  const loadedLines = [{
    lineId: first.reservationId.toString(),
    returnedQuantity: '10',
  }];

  for (let index = 0; index < 6; index += 1) {
    const line = await addLoadedLine({
      quantityInBaseUnits: 10 + index,
      tourId: first.tourId,
    });
    loadedLines.push({
      lineId: line.reservationId.toString(),
      returnedQuantity: String(index),
    });
  }

  const otherTourId = new ObjectId();
  const otherReservationId = new ObjectId();

  await Promise.all([
    database.collection('tours').insertOne({
      _id: otherTourId,
      reference: `TRN-${otherTourId.toHexString().toLocaleUpperCase('en')}`,
      status: 'PREPARATION',
    }),
    database.collection('tourReservations').insertOne({
      _id: otherReservationId,
      productId: first.productId,
      quantityInBaseUnits: 5,
      status: 'ACTIVE',
      tourId: otherTourId,
    }),
  ]);

  const result = await submitCounting({
    lines: loadedLines,
    tourId: first.tourId,
  });
  const [counting, otherReservation, stock] = await Promise.all([
    database.collection('tourCountings').findOne({ tourId: first.tourId }),
    database.collection('tourReservations').findOne({ _id: otherReservationId }),
    getProductStockSummaries([first.productId], { database }),
  ]);

  assert.ok(result.countingId);
  assert.equal(counting.lines.length, 7);
  assert.ok(counting.lines.every((line) =>
    Number.isSafeInteger(line.returnedQuantityInBaseUnits)));
  assert.equal(otherReservation.status, 'ACTIVE');
  assert.equal(stock.get(first.productId.toString()).reservedQuantityInBaseUnits, 5);
  assert.equal(stock.get(first.productId.toString()).quantityInBaseUnits, 50);
  assert.equal(stock.get(first.productId.toString()).availableQuantityInBaseUnits, 45);
});

test('refuse les retours non entiers, hors limites et un récapitulatif altéré', async () => {
  const { reservationId, tourId } = await insertLoadedTour();
  const sheet = await getTourCountingSheet({
    tourId: tourId.toString(),
    userId: fullAccessUserId.toString(),
  });
  const invalidReturns = ['-1', '1,5', '61', String(Number.MAX_SAFE_INTEGER + 1)];

  for (const returnedQuantity of invalidReturns) {
    const result = await confirmTourCounting({
      confirmationKey: randomUUID(),
      countedBy: fullAccessUserId.toString(),
      expectedSheetDigest: sheet.digest,
      lines: [{ lineId: reservationId.toString(), returnedQuantity }],
      tourId: tourId.toString(),
    });

    assert.ok(result.errors.form);
  }

  const alteredRecap = await confirmTourCounting({
    confirmationKey: randomUUID(),
    countedBy: fullAccessUserId.toString(),
    expectedSheetDigest: 'a'.repeat(64),
    lines: [{ lineId: reservationId.toString(), returnedQuantity: '10' }],
    tourId: tourId.toString(),
  });

  assert.match(alteredRecap.errors.form, /données historiques ont changé/u);
  assert.equal(await database.collection('tourCountings').countDocuments({
    tourId,
  }), 0);
  assert.equal(await database.collection('stockMovements').countDocuments({
    kind: TOUR_RETURN_INPUT_KIND,
    sourceTourId: tourId,
  }), 0);
  assert.equal((await database.collection('tours').findOne({
    _id: tourId,
  })).status, 'LOADED');
});

test('refuse ligne manquante, dupliquée ou étrangère sans écrire', async () => {
  const { reservationId, tourId } = await insertLoadedTour();
  const foreignId = new ObjectId();
  const invalidCases = [
    [],
    [
      { lineId: reservationId.toString(), returnedQuantity: '10' },
      { lineId: reservationId.toString(), returnedQuantity: '10' },
    ],
    [
      { lineId: reservationId.toString(), returnedQuantity: '10' },
      { lineId: foreignId.toString(), returnedQuantity: '1' },
    ],
  ];

  for (const lines of invalidCases) {
    const result = await submitCounting({ lines, tourId });

    assert.ok(result.errors.form);
    assert.equal(await database.collection('tourCountings').countDocuments({
      tourId,
    }), 0);
    assert.equal(await database.collection('stockMovements').countDocuments({
      kind: TOUR_RETURN_INPUT_KIND,
      sourceTourId: tourId,
    }), 0);
    assert.equal((await database.collection('tours').findOne({
      _id: tourId,
    })).status, 'LOADED');
  }
});

test('refuse prix historique absent et permission de confirmation manquante', async () => {
  const missingPrice = await insertLoadedTour({ historicalPrice: false });
  const sheet = await getTourCountingSheet({
    tourId: missingPrice.tourId.toString(),
    userId: fullAccessUserId.toString(),
  });
  const missingPriceResult = await confirmTourCounting({
    confirmationKey: randomUUID(),
    countedBy: fullAccessUserId.toString(),
    expectedSheetDigest: sheet.digest,
    lines: [{
      lineId: missingPrice.reservationId.toString(),
      returnedQuantity: '10',
    }],
    tourId: missingPrice.tourId.toString(),
  });
  const unauthorizedId = await createUser([
    'tours.read',
    'tours.count.prepare',
    'pricing.read',
  ]);
  const unauthorizedTour = await insertLoadedTour();
  const unauthorizedSheet = await getTourCountingSheet({
    tourId: unauthorizedTour.tourId.toString(),
    userId: unauthorizedId.toString(),
  });

  await assert.rejects(
    confirmTourCounting({
      confirmationKey: randomUUID(),
      countedBy: unauthorizedId.toString(),
      expectedSheetDigest: unauthorizedSheet.digest,
      lines: [{
        lineId: unauthorizedTour.reservationId.toString(),
        returnedQuantity: '10',
      }],
      tourId: unauthorizedTour.tourId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'tours.count.confirm',
  );
  assert.match(missingPriceResult.errors.form, /prix historique/u);
  assert.equal(await database.collection('tourCountings').countDocuments({
    tourId: { $in: [missingPrice.tourId, unauthorizedTour.tourId] },
  }), 0);
});

test('autorise le comptage après désactivation du livreur', async () => {
  const counting = await insertLoadedTour();
  const delivererId = new ObjectId();

  await Promise.all([
    database.collection('deliverers').insertOne({
      _id: delivererId,
      active: false,
      code: 'LIV-DESACTIVE',
      name: 'Livreur désactivé',
    }),
    database.collection('tours').updateOne(
      { _id: counting.tourId },
      { $set: { delivererId } },
    ),
  ]);

  const result = await submitCounting({
    lines: [{
      lineId: counting.reservationId.toString(),
      returnedQuantity: '10',
    }],
    tourId: counting.tourId,
  });

  assert.ok(result.countingId);
  assert.equal((await database.collection('tours').findOne({
    _id: counting.tourId,
  })).status, 'COUNTED');
});

test('refuse une clé réutilisée autrement et deux comptages contradictoires', async () => {
  const counting = await insertLoadedTour();
  const sheet = await getTourCountingSheet({
    tourId: counting.tourId.toString(),
    userId: fullAccessUserId.toString(),
  });
  const confirmationKey = randomUUID();
  const competingKey = randomUUID();
  const createRequest = (returnedQuantity, key = confirmationKey) => ({
    confirmationKey: key,
    countedBy: fullAccessUserId.toString(),
    expectedSheetDigest: sheet.digest,
    lines: [{
      lineId: counting.reservationId.toString(),
      returnedQuantity,
    }],
    tourId: counting.tourId.toString(),
  });
  const [first, second] = await Promise.all([
    confirmTourCounting(createRequest('10')),
    confirmTourCounting(createRequest('20', competingKey)),
  ]);
  const accepted = first.countingId ? first : second;
  const refused = first.errors ? first : second;
  const conflictingReuse = await confirmTourCounting(createRequest(
    accepted === first ? '20' : '10',
    accepted === first ? confirmationKey : competingKey,
  ));

  assert.ok(accepted.countingId);
  assert.match(refused.errors.form, /contenu différent/u);
  assert.match(conflictingReuse.errors.form, /contenu différent/u);
  assert.equal(await database.collection('tourCountings').countDocuments({
    tourId: counting.tourId,
  }), 1);
  assert.equal(await database.collection('stockMovements').countDocuments({
    kind: TOUR_RETURN_INPUT_KIND,
    sourceTourId: counting.tourId,
  }), 1);
});

test('annule comptage, retours et statut si une écriture échoue', async () => {
  const counting = await insertLoadedTour();
  const secondLine = await addLoadedLine({ tourId: counting.tourId });

  await database.collection('stockMovements').createIndex(
    { recordedBy: 1 },
    {
      name: 'force_tour_counting_failure',
      partialFilterExpression: {
        kind: TOUR_RETURN_INPUT_KIND,
        sourceTourId: counting.tourId,
      },
      unique: true,
    },
  );

  try {
    await assert.rejects(
      submitCounting({
        lines: [
          {
            lineId: counting.reservationId.toString(),
            returnedQuantity: '10',
          },
          {
            lineId: secondLine.reservationId.toString(),
            returnedQuantity: '2',
          },
        ],
        tourId: counting.tourId,
      }),
      (error) => error?.code === 11000,
    );

    const [deliverer, tour, countingCount, returnCount] = await Promise.all([
      database.collection('deliverers').findOne({
        _id: counting.delivererId,
      }),
      database.collection('tours').findOne({ _id: counting.tourId }),
      database.collection('tourCountings').countDocuments({
        tourId: counting.tourId,
      }),
      database.collection('stockMovements').countDocuments({
        kind: TOUR_RETURN_INPUT_KIND,
        sourceTourId: counting.tourId,
      }),
    ]);

    assert.equal(tour.status, 'LOADED');
    assert.equal(deliverer.cashPaymentReferenceVersion, undefined);
    assert.equal(tour.cashPaymentReferenceVersion, undefined);
    assert.equal(tour.countingReferenceVersion, undefined);
    assert.equal(countingCount, 0);
    assert.equal(returnCount, 0);
  } finally {
    await database.collection('stockMovements').dropIndex(
      'force_tour_counting_failure',
    );
  }
});
