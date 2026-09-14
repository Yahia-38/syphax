import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_tour_load_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { deactivateDeliverer } = await import('../lib/deliverers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  TOUR_LOADING_OUTPUT_KIND,
  getProductStockSummaries,
  listProductStockMovements,
} = await import('../lib/stock-movements.js');
const {
  addAndReserveTourProduct,
  listTourReservations,
  releaseTourReservation,
} = await import('../lib/tour-reservations.js');
const {
  confirmTourLoading,
  createTourLoadingDigest,
} = await import('../lib/tour-loadings.js');
const { formatTourStatus, getTourById } = await import('../lib/tours.js');

let database;
let loaderId;

before(async () => {
  database = await getDatabase();
  loaderId = new ObjectId();
  const roleId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      key: 'tour-loader-test',
      permissions: ['tours.load', 'tours.read'],
    }),
    database.collection('users').insertOne({
      _id: loaderId,
      active: true,
      roleIds: [roleId],
      username: 'chargeur-test',
    }),
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

const insertDeliverer = async ({ active = true } = {}) => {
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active,
    code: `LIV-${delivererId.toHexString().slice(-6)}`,
    name: 'Livreur de chargement',
  });

  return delivererId;
};

const insertTour = async ({ delivererId, status = 'PREPARATION' } = {}) => {
  const tourId = new ObjectId();

  await database.collection('tours').insertOne({
    _id: tourId,
    delivererId: delivererId ?? await insertDeliverer(),
    reference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
    status,
  });

  return tourId;
};

const insertProduct = async ({ physicalQuantity = 100 } = {}) => {
  const productId = new ObjectId();

  await database.collection('products').insertOne({
    _id: productId,
    active: true,
    baseUnit: 'PIECE',
    code: `PRD-${productId.toHexString().slice(-6)}`,
    designation: `Produit ${productId.toHexString().slice(-4)}`,
    packagings: [],
  });
  await database.collection('stockMovements').insertOne({
    _id: new ObjectId(),
    kind: 'TEST_IN',
    productId,
    baseUnit: 'PIECE',
    quantityDeltaInBaseUnits: physicalQuantity,
    occurredOn: new Date('2026-09-14T08:00:00.000Z'),
  });

  return productId;
};

const addReservation = async ({ productId, quantity = 30, tourId }) =>
  addAndReserveTourProduct({
    additionKey: randomUUID(),
    createdBy: loaderId.toString(),
    directQuantity: String(quantity),
    packagingCount: '',
    packagingId: '',
    productId: productId.toString(),
    quantityMode: 'DIRECT',
    tourId: tourId.toString(),
  });

const getDigest = async (tourId) => createTourLoadingDigest(
  await listTourReservations({ database, tourId: tourId.toString() }),
);

const load = async (tourId, expectedDigest) => confirmTourLoading({
  expectedDigest,
  loadedBy: loaderId.toString(),
  tourId: tourId.toString(),
});

test('charge plusieurs produits, conserve les autres réservations et reste idempotent', async () => {
  const firstProductId = await insertProduct({ physicalQuantity: 100 });
  const secondProductId = await insertProduct({ physicalQuantity: 80 });
  const tourId = await insertTour();
  const otherTourId = await insertTour();

  await Promise.all([
    addReservation({ productId: firstProductId, quantity: 30, tourId }),
    addReservation({ productId: secondProductId, quantity: 20, tourId }),
    addReservation({ productId: secondProductId, quantity: 10, tourId: otherTourId }),
  ]);

  const digest = await getDigest(tourId);
  const [firstResult, secondResult] = await Promise.all([
    load(tourId, digest),
    load(tourId, digest),
  ]);
  const [
    tour,
    reservations,
    movements,
    summaries,
    visibleLines,
    tourDetail,
  ] = await Promise.all([
    database.collection('tours').findOne({ _id: tourId }),
    database.collection('tourReservations').find({
      tourId: { $in: [tourId, otherTourId] },
    }).toArray(),
    database.collection('stockMovements').find({
      kind: TOUR_LOADING_OUTPUT_KIND,
      sourceTourId: tourId,
    }).toArray(),
    getProductStockSummaries([firstProductId, secondProductId], { database }),
    listTourReservations({ database, tourId: tourId.toString() }),
    getTourById(tourId.toString(), { userId: loaderId.toString() }),
  ]);
  const firstStock = summaries.get(firstProductId.toString());
  const secondStock = summaries.get(secondProductId.toString());
  const otherReservation = reservations.find((reservation) =>
    reservation.tourId.equals(otherTourId));

  assert.equal(firstResult.replayed !== secondResult.replayed, true);
  assert.equal(movements.length, 2);
  assert.ok(movements.every((movement) =>
    movement.sourceTourId.equals(tourId)
    && movement.sourceTourReservationId instanceof ObjectId
    && movement.quantityDeltaInBaseUnits < 0
    && !('amountInCentimes' in movement)
    && !('salePrice' in movement)));
  assert.equal(tour.status, 'LOADED');
  assert.equal(formatTourStatus(tourDetail.status), 'Chargée');
  assert.equal(tourDetail.loadedBy, 'chargeur-test');
  assert.ok(tourDetail.loadedAt);
  assert.ok(tour.loadedAt instanceof Date);
  assert.ok(tour.loadedBy.equals(loaderId));
  assert.equal(firstStock.quantityInBaseUnits, 70);
  assert.equal(firstStock.reservedQuantityInBaseUnits, 0);
  assert.equal(firstStock.availableQuantityInBaseUnits, 70);
  assert.equal(secondStock.quantityInBaseUnits, 60);
  assert.equal(secondStock.reservedQuantityInBaseUnits, 10);
  assert.equal(secondStock.availableQuantityInBaseUnits, 50);
  assert.equal(otherReservation.status, 'ACTIVE');
  assert.deepEqual(visibleLines.map((line) => line.status), ['LOADED', 'LOADED']);
  assert.equal(reservations.filter((reservation) =>
    reservation.tourId.equals(tourId)
    && reservation.status === 'LOADED').length, 2);
  assert.ok(reservations.filter((reservation) =>
    reservation.tourId.equals(tourId)).every((reservation) =>
    reservation.loadedAt instanceof Date
    && reservation.loadedBy.equals(loaderId)
    && !('amountInCentimes' in reservation)
    && !('salePrice' in reservation)));
  const loadingIndex = (await database.collection('stockMovements')
    .listIndexes().toArray()).find((index) =>
    index.name === 'unique_tour_loading_reservation_movement');

  assert.equal(loadingIndex.unique, true);
});

test('annule toutes les écritures si une sortie échoue en cours de transaction', async () => {
  const firstProductId = await insertProduct();
  const secondProductId = await insertProduct();
  const tourId = await insertTour();

  await addReservation({ productId: firstProductId, tourId });
  await addReservation({ productId: secondProductId, tourId });
  const digest = await getDigest(tourId);

  await database.collection('stockMovements').createIndex(
    { recordedBy: 1 },
    {
      name: 'force_tour_loading_failure',
      partialFilterExpression: {
        kind: TOUR_LOADING_OUTPUT_KIND,
        sourceTourId: tourId,
      },
      unique: true,
    },
  );

  try {
    await assert.rejects(load(tourId, digest), (error) => error?.code === 11000);

    const [tour, reservations, movementCount, products] = await Promise.all([
      database.collection('tours').findOne({ _id: tourId }),
      database.collection('tourReservations').find({ tourId }).toArray(),
      database.collection('stockMovements').countDocuments({
        kind: TOUR_LOADING_OUTPUT_KIND,
        sourceTourId: tourId,
      }),
      database.collection('products').find({
        _id: { $in: [firstProductId, secondProductId] },
      }).toArray(),
    ]);

    assert.equal(tour.status, 'PREPARATION');
    assert.equal(tour.loadingReferenceVersion, undefined);
    assert.ok(reservations.every((reservation) => reservation.status === 'ACTIVE'));
    assert.equal(movementCount, 0);
    assert.ok(products.every((product) =>
      product.stockReferenceVersion === 1));
  } finally {
    await database.collection('stockMovements').dropIndex(
      'force_tour_loading_failure',
    );
  }
});

test('refuse sans permission, pour une tournée vide ou avec un livreur désactivé', async () => {
  const unauthorizedId = new ObjectId();
  const emptyTourId = await insertTour();
  const disabledDelivererId = await insertDeliverer({ active: false });
  const disabledTourId = await insertTour({ delivererId: disabledDelivererId });
  const productId = await insertProduct();

  await database.collection('users').insertOne({
    _id: unauthorizedId,
    active: true,
    roleIds: [],
    username: 'sans-chargement',
  });
  await addReservation({ productId, tourId: disabledTourId });

  await assert.rejects(
    confirmTourLoading({
      expectedDigest: createTourLoadingDigest([]),
      loadedBy: unauthorizedId.toString(),
      tourId: emptyTourId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'tours.load',
  );
  assert.match((await load(
    emptyTourId,
    createTourLoadingDigest([]),
  )).errors.form, /aucune réservation active/u);
  assert.match((await load(
    disabledTourId,
    await getDigest(disabledTourId),
  )).errors.form, /désactivé/u);
});

test('refuse une empreinte périmée après modification des lignes', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  const firstAddition = await addReservation({ productId, quantity: 30, tourId });
  const staleDigest = await getDigest(tourId);

  await releaseTourReservation({
    releasedBy: loaderId.toString(),
    reservationId: firstAddition.reservation.id,
    tourId: tourId.toString(),
  });
  await addReservation({ productId, quantity: 20, tourId });

  const result = await load(tourId, staleDigest);

  assert.match(result.errors.form, /lignes ont changé/u);
  assert.equal(await database.collection('stockMovements').countDocuments({
    kind: TOUR_LOADING_OUTPUT_KIND,
    sourceTourId: tourId,
  }), 0);
  assert.equal((await database.collection('tours').findOne({ _id: tourId })).status, 'PREPARATION');
});

test('refuse de charger lorsque le physique ne couvre plus les réservations', async () => {
  const productId = await insertProduct({ physicalQuantity: 20 });
  const tourId = await insertTour();
  const reservationId = new ObjectId();

  await database.collection('tourReservations').insertOne({
    _id: reservationId,
    additionKey: randomUUID(),
    requestDigest: 'état-importé',
    tourId,
    tourReference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
    productId,
    productCode: `PRD-${productId.toHexString().slice(-6)}`,
    productDesignation: 'Produit sur-réservé',
    baseUnit: 'PIECE',
    quantityMode: 'DIRECT',
    conversionFactor: 1,
    quantityInBaseUnits: 30,
    status: 'ACTIVE',
    reservedAt: new Date(),
    reservedBy: loaderId,
  });

  const result = await load(tourId, await getDigest(tourId));
  const stock = (await getProductStockSummaries([productId], { database }))
    .get(productId.toString());

  assert.match(result.errors.form, /stock physique/u);
  assert.equal(stock.quantityInBaseUnits, 20);
  assert.equal(stock.reservedQuantityInBaseUnits, 30);
  assert.equal(await database.collection('stockMovements').countDocuments({
    kind: TOUR_LOADING_OUTPUT_KIND,
    sourceTourReservationId: reservationId,
  }), 0);
  assert.equal((await database.collection('tours').findOne({ _id: tourId })).status, 'PREPARATION');
});

test('sérialise ajout, retrait, autre chargement et désactivation du livreur', async () => {
  const sharedProductId = await insertProduct({ physicalQuantity: 200 });
  const extraProductId = await insertProduct();
  const delivererId = await insertDeliverer();
  const addRaceTourId = await insertTour({ delivererId });
  const releaseRaceTourId = await insertTour();
  const otherLoadTourId = await insertTour();
  const deactivateRaceTourId = await insertTour({ delivererId });

  const [addRaceReservation, releaseRaceReservation] = await Promise.all([
    addReservation({ productId: sharedProductId, tourId: addRaceTourId }),
    addReservation({ productId: sharedProductId, tourId: releaseRaceTourId }),
    addReservation({ productId: sharedProductId, tourId: otherLoadTourId }),
    addReservation({ productId: extraProductId, tourId: deactivateRaceTourId }),
  ]);
  const [addDigest, releaseDigest, otherDigest, deactivateDigest] = await Promise.all([
    getDigest(addRaceTourId),
    getDigest(releaseRaceTourId),
    getDigest(otherLoadTourId),
    getDigest(deactivateRaceTourId),
  ]);
  const [loadAgainstAdd, addition] = await Promise.all([
    load(addRaceTourId, addDigest),
    addReservation({ productId: extraProductId, tourId: addRaceTourId }),
  ]);
  const [loadAgainstRelease, release] = await Promise.all([
    load(releaseRaceTourId, releaseDigest),
    releaseTourReservation({
      releasedBy: loaderId.toString(),
      reservationId: releaseRaceReservation.reservation.id,
      tourId: releaseRaceTourId.toString(),
    }),
  ]);
  const [firstSharedLoad, secondSharedLoad] = await Promise.all([
    load(otherLoadTourId, otherDigest),
    load(addRaceTourId, await getDigest(addRaceTourId)),
  ]);
  const [loadAgainstDeactivation] = await Promise.all([
    load(deactivateRaceTourId, deactivateDigest),
    deactivateDeliverer({
      changedBy: loaderId.toString(),
      delivererId: delivererId.toString(),
    }),
  ]);

  assert.ok(loadAgainstAdd.tourId || loadAgainstAdd.errors?.form);
  assert.ok(addition.reservation || addition.errors?.form);
  assert.equal(Boolean(loadAgainstAdd.tourId && addition.reservation), false);
  assert.ok(loadAgainstRelease.tourId || loadAgainstRelease.errors?.form);
  assert.ok(release.reservation || release.errors?.form);
  assert.equal(Boolean(loadAgainstRelease.tourId && release.reservation), false);
  assert.ok(firstSharedLoad.tourId);
  assert.ok(secondSharedLoad.tourId || secondSharedLoad.errors?.form);
  assert.ok(loadAgainstDeactivation.tourId || /désactivé/u.test(
    loadAgainstDeactivation.errors?.form ?? '',
  ));
  assert.ok(addRaceReservation.reservation);
});

test('masque la source tournée de l’historique sans droit de lecture', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();

  await addReservation({ productId, tourId });
  await load(tourId, await getDigest(tourId));

  const hiddenSources = await listProductStockMovements(productId, {
    database,
    includeTourSources: false,
  });
  const visibleSources = await listProductStockMovements(productId, {
    database,
    includeTourSources: true,
  });
  const hiddenLoading = hiddenSources.find((movement) =>
    movement.kind === TOUR_LOADING_OUTPUT_KIND);
  const visibleLoading = visibleSources.find((movement) =>
    movement.kind === TOUR_LOADING_OUTPUT_KIND);

  assert.equal(hiddenLoading.sourceTour, null);
  assert.equal(visibleLoading.sourceTour.id, tourId.toString());
});
