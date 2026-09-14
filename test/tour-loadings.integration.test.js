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
const { updateProductSalePrice } = await import('../lib/products.js');
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
  getTourLoadingPreview,
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
      permissions: ['pricing.read', 'tours.load', 'tours.read'],
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

const insertProduct = async ({
  baseUnit = 'PIECE',
  packagings = [],
  physicalQuantity = 100,
  salePriceInCentimes = 15000,
} = {}) => {
  const productId = new ObjectId();
  const salePriceUpdatedAt = new Date('2026-09-14T08:30:00.000Z');

  await database.collection('products').insertOne({
    _id: productId,
    active: true,
    baseUnit,
    code: `PRD-${productId.toHexString().slice(-6)}`,
    designation: `Produit ${productId.toHexString().slice(-4)}`,
    packagings,
    ...(Number.isSafeInteger(salePriceInCentimes)
      ? {
          salePrice: {
            amountInCentimes: salePriceInCentimes,
            currency: 'DZD',
            taxIncluded: true,
            updatedAt: salePriceUpdatedAt,
            updatedBy: loaderId,
            versionId: new ObjectId(),
          },
        }
      : {}),
  });
  await database.collection('stockMovements').insertOne({
    _id: new ObjectId(),
    kind: 'TEST_IN',
    productId,
    baseUnit,
    quantityDeltaInBaseUnits: physicalQuantity,
    occurredOn: new Date('2026-09-14T08:00:00.000Z'),
  });

  return productId;
};

const addReservation = async ({
  packagingCount = '',
  packagingId = '',
  productId,
  quantity = 30,
  quantityMode = 'DIRECT',
  tourId,
}) =>
  addAndReserveTourProduct({
    additionKey: randomUUID(),
    createdBy: loaderId.toString(),
    directQuantity: quantityMode === 'DIRECT' ? String(quantity) : '',
    packagingCount,
    packagingId,
    productId: productId.toString(),
    quantityMode,
    tourId: tourId.toString(),
  });

const getPreview = async (tourId, userId = loaderId) =>
  getTourLoadingPreview({
    tourId: tourId.toString(),
    userId: userId.toString(),
  });

const getDigest = async (tourId) => (await getPreview(tourId)).digest;

const load = async (tourId, expectedDigest) => confirmTourLoading({
  expectedDigest,
  loadedBy: loaderId.toString(),
  tourId: tourId.toString(),
});

test('charge malgré une limite dépassée, conserve les autres réservations et reste idempotent', async () => {
  const firstProductId = await insertProduct({ physicalQuantity: 100 });
  const secondProductId = await insertProduct({ physicalQuantity: 80 });
  const tourId = await insertTour();
  const otherTourId = await insertTour();

  await Promise.all([
    addReservation({ productId: firstProductId, quantity: 30, tourId }),
    addReservation({ productId: secondProductId, quantity: 20, tourId }),
    addReservation({ productId: secondProductId, quantity: 10, tourId: otherTourId }),
  ]);
  const loadedTour = await database.collection('tours').findOne({
    _id: tourId,
  });

  await database.collection('deliverers').updateOne(
    { _id: loadedTour.delivererId },
    {
      $set: {
        creditLimit: {
          amountInCentimes: 0,
          updatedAt: new Date(),
          updatedBy: loaderId,
          version: 1,
        },
      },
    },
  );

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
    getTourById(tourId.toString(), {
      includePricing: true,
      userId: loaderId.toString(),
    }),
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
    && !('salePrice' in reservation)
    && reservation.salePriceAtLoading.amountInCentimes === 15000
    && reservation.salePriceAtLoading.currency === 'DZD'
    && reservation.salePriceAtLoading.taxIncluded === true
    && reservation.salePriceAtLoading.unit === 'PIECE'));
  assert.ok(tourDetail.lines.every((line) =>
    line.salePriceAtLoading.amountInCentimes === 15000));
  const loadingIndex = (await database.collection('stockMovements')
    .listIndexes().toArray()).find((index) =>
    index.name === 'unique_tour_loading_reservation_movement');

  assert.equal(loadingIndex.unique, true);
});

test('valorise 60 bouteilles conditionnées à 150 DA dans leur unité de base', async () => {
  const packagingId = new ObjectId();
  const productId = await insertProduct({
    baseUnit: 'BOUTEILLE',
    packagings: [{
      _id: packagingId,
      label: 'Pack de 12',
      quantity: 12,
    }],
    physicalQuantity: 100,
    salePriceInCentimes: 15000,
  });
  const tourId = await insertTour();

  await addReservation({
    packagingCount: '5',
    packagingId: packagingId.toString(),
    productId,
    quantityMode: 'PACKAGING',
    tourId,
  });

  const preview = await getPreview(tourId);

  assert.equal(preview.errors.form, undefined);
  assert.equal(preview.lines[0].quantityInBaseUnits, 60);
  assert.equal(preview.lines[0].salePriceAtLoading.amountInCentimes, 15000);
  assert.equal(preview.lines[0].salePriceAtLoading.unit, 'BOUTEILLE');
  assert.equal(preview.lines[0].loadedValueInCentimes, 900000);
  assert.equal(preview.totalValueInCentimes, 900000);

  const result = await load(tourId, preview.digest);
  const reservation = await database.collection('tourReservations').findOne({
    productId,
    tourId,
  });

  assert.ok(result.tourId);
  assert.equal(reservation.salePriceAtLoading.amountInCentimes, 15000);
  assert.equal(reservation.salePriceAtLoading.unit, 'BOUTEILLE');
});

test('refuse un tarif manquant sans sortie ni transition partielle', async () => {
  const productId = await insertProduct({ salePriceInCentimes: null });
  const tourId = await insertTour();

  await addReservation({ productId, tourId });

  const preview = await getPreview(tourId);
  const result = await load(
    tourId,
    createTourLoadingDigest(
      await listTourReservations({ database, tourId: tourId.toString() }),
    ),
  );
  const [tour, reservation, movementCount] = await Promise.all([
    database.collection('tours').findOne({ _id: tourId }),
    database.collection('tourReservations').findOne({ tourId }),
    database.collection('stockMovements').countDocuments({
      kind: TOUR_LOADING_OUTPUT_KIND,
      sourceTourId: tourId,
    }),
  ]);

  assert.match(preview.errors.form, /prix de vente.*PRD-/u);
  assert.match(result.errors.form, /prix de vente.*PRD-/u);
  assert.equal(tour.status, 'PREPARATION');
  assert.equal(reservation.status, 'ACTIVE');
  assert.equal('salePriceAtLoading' in reservation, false);
  assert.equal(movementCount, 0);
});

test('refuse un tarif modifié après aperçu et conserve le prix lors des mises à jour et rejeux', async () => {
  const editorId = new ObjectId();
  const productId = await insertProduct({ salePriceInCentimes: 15000 });
  const tourId = await insertTour();

  await addReservation({ productId, quantity: 60, tourId });

  const stalePreview = await getPreview(tourId);

  await updateProductSalePrice({
    price: '175,50',
    productId: productId.toString(),
    updatedBy: editorId.toString(),
  });

  const staleResult = await load(tourId, stalePreview.digest);

  assert.match(staleResult.errors.form, /tarifs applicables ont changé/u);
  assert.equal(await database.collection('stockMovements').countDocuments({
    kind: TOUR_LOADING_OUTPUT_KIND,
    sourceTourId: tourId,
  }), 0);
  assert.equal((await database.collection('tours').findOne({
    _id: tourId,
  })).status, 'PREPARATION');

  const refreshedPreview = await getPreview(tourId);
  const loaded = await load(tourId, refreshedPreview.digest);

  assert.ok(loaded.tourId);
  assert.equal(refreshedPreview.lines[0].salePriceAtLoading.amountInCentimes, 17550);

  await updateProductSalePrice({
    price: '200',
    productId: productId.toString(),
    updatedBy: editorId.toString(),
  });

  const replayed = await load(tourId, refreshedPreview.digest);
  const reservation = await database.collection('tourReservations').findOne({
    productId,
    tourId,
  });

  assert.equal(replayed.replayed, true);
  assert.equal(reservation.salePriceAtLoading.amountInCentimes, 17550);
  assert.equal(await database.collection('stockMovements').countDocuments({
    kind: TOUR_LOADING_OUTPUT_KIND,
    sourceTourId: tourId,
  }), 1);
});

test('sérialise une modification concurrente du tarif avec le chargement', async () => {
  const editorId = new ObjectId();
  const productId = await insertProduct({ salePriceInCentimes: 15000 });
  const tourId = await insertTour();

  await addReservation({ productId, tourId });

  const preview = await getPreview(tourId);
  const [loadingResult] = await Promise.all([
    load(tourId, preview.digest),
    updateProductSalePrice({
      price: '175,50',
      productId: productId.toString(),
      updatedBy: editorId.toString(),
    }),
  ]);
  const [product, reservation, movementCount, tour] = await Promise.all([
    database.collection('products').findOne({ _id: productId }),
    database.collection('tourReservations').findOne({ tourId }),
    database.collection('stockMovements').countDocuments({
      kind: TOUR_LOADING_OUTPUT_KIND,
      sourceTourId: tourId,
    }),
    database.collection('tours').findOne({ _id: tourId }),
  ]);

  assert.equal(product.salePrice.amountInCentimes, 17550);

  if (loadingResult.tourId) {
    assert.equal(reservation.salePriceAtLoading.amountInCentimes, 15000);
    assert.equal(reservation.status, 'LOADED');
    assert.equal(movementCount, 1);
    assert.equal(tour.status, 'LOADED');
  } else {
    assert.match(loadingResult.errors.form, /tarifs applicables ont changé/u);
    assert.equal('salePriceAtLoading' in reservation, false);
    assert.equal(reservation.status, 'ACTIVE');
    assert.equal(movementCount, 0);
    assert.equal(tour.status, 'PREPARATION');
  }
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
    createTourLoadingDigest([]),
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

  assert.match(result.errors.form, /quantités ou les tarifs applicables ont changé/u);
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

test('protège les prix de tournée avec pricing.read', async () => {
  const roleId = new ObjectId();
  const userId = new ObjectId();
  const productId = await insertProduct();
  const tourId = await insertTour();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      permissions: ['tours.load', 'tours.read'],
    }),
    database.collection('users').insertOne({
      _id: userId,
      active: true,
      roleIds: [roleId],
      username: 'chargement-sans-tarifs',
    }),
  ]);
  await addReservation({ productId, tourId });

  await assert.rejects(
    getPreview(tourId, userId),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'pricing.read',
  );
  await assert.rejects(
    getTourById(tourId.toString(), {
      includePricing: true,
      userId: userId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'pricing.read',
  );

  const hidden = await getTourById(tourId.toString(), {
    userId: userId.toString(),
  });

  assert.equal('salePriceAtLoading' in hidden.lines[0], false);
});

test('laisse explicitement absent le prix des anciennes tournées chargées', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour({ status: 'LOADED' });

  await database.collection('tourReservations').insertOne({
    _id: new ObjectId(),
    baseUnit: 'PIECE',
    productCode: `PRD-${productId.toHexString().slice(-6)}`,
    productDesignation: 'Ancien produit chargé',
    productId,
    quantityInBaseUnits: 12,
    quantityMode: 'DIRECT',
    reservedAt: new Date(),
    status: 'LOADED',
    tourId,
  });

  const visible = await getTourById(tourId.toString(), {
    includePricing: true,
    userId: loaderId.toString(),
  });
  const hidden = await getTourById(tourId.toString(), {
    userId: loaderId.toString(),
  });
  const stored = await database.collection('tourReservations').findOne({
    tourId,
  });

  assert.equal(visible.lines[0].salePriceAtLoading, null);
  assert.equal('salePriceAtLoading' in hidden.lines[0], false);
  assert.equal('salePriceAtLoading' in stored, false);
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
