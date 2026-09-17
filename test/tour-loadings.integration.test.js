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

const { seedValuedStockReceipt } = await import('./helpers/stock-valuation-fixtures.js');
const { PermissionDeniedError, grantYahiaFullAccessPermission } = await import('../lib/access.js');
const { deactivateDeliverer } = await import('../lib/deliverers.js');
const { closeMongoConnection, getDatabase, getMongoClient } = await import('../lib/mongodb.js');
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
const { readStoredStockValuationReconciliation } = await import('../lib/stock-valuations.js');
const { calculateStockReturn } = await import('../lib/stock-valuation-calculations.js');
const { createStockValuationEntry } = await import('../lib/stock-valuation-records.js');
const { createReception } = await import('../lib/reception-records.js');
const { applyTourLoadingStockValuations, prepareTourLoadingStockValuations } = await import('../lib/tour-loading-stock-valuations.js');
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
  purchaseValueInCentimes = 10_000,
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
    // Packs get a TTC sale price by default (14 000 centimes per unit); null leaves it unset.
    packagings: packagings.map(({ salePriceInCentimes: packPrice, ...packaging }) => ({
      ...packaging,
      ...(packPrice !== null && Number.isSafeInteger(packPrice ?? packaging.quantity * 14_000)
        ? { salePrice: { amountInCentimes: packPrice ?? packaging.quantity * 14_000, currency: 'DZD', taxIncluded: true, updatedAt: salePriceUpdatedAt, updatedBy: loaderId, versionId: new ObjectId() } }
        : {}),
    })),
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
  await seedValuedStockReceipt({ database, productId, baseUnit,
    quantityInBaseUnits: physicalQuantity, amountInCentimes: purchaseValueInCentimes, recordedBy: loaderId });

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

test('valorise 5 packs de 12 au prix du pack et fige ce prix au chargement', async () => {
  const packagingId = new ObjectId();
  const productId = await insertProduct({
    baseUnit: 'BOUTEILLE',
    packagings: [{
      _id: packagingId,
      label: 'Pack de 12',
      quantity: 12,
      salePriceInCentimes: 150_000,
      usage: 'SALE',
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
  assert.equal(preview.lines[0].salePriceAtLoading.packaging.amountInCentimes, 150_000);
  assert.equal(preview.lines[0].salePriceAtLoading.packaging.quantity, 12);
  assert.equal(preview.lines[0].salePriceAtLoading.packaging.packagingId, packagingId.toString());
  assert.equal(preview.lines[0].loadedValueInCentimes, 750_000);
  assert.equal(preview.totalValueInCentimes, 750_000);

  const result = await load(tourId, preview.digest);
  const reservation = await database.collection('tourReservations').findOne({
    productId,
    tourId,
  });

  assert.ok(result.tourId);
  assert.equal(reservation.salePriceAtLoading.amountInCentimes, 15000);
  assert.equal(reservation.salePriceAtLoading.unit, 'BOUTEILLE');
  assert.equal(reservation.salePriceAtLoading.packaging.amountInCentimes, 150_000);
  assert.equal(reservation.salePriceAtLoading.packaging.label, 'Pack de 12');
  assert.ok(reservation.salePriceAtLoading.packaging.packagingId.equals(packagingId));
});

test('garde le prix unitaire pour une quantité saisie directement', async () => {
  const productId = await insertProduct({
    baseUnit: 'BOUTEILLE',
    packagings: [{ _id: new ObjectId(), label: 'Pack de 12', quantity: 12, salePriceInCentimes: 150_000, usage: 'SALE' }],
    salePriceInCentimes: 15000,
  });
  const tourId = await insertTour();
  await addReservation({ productId, quantity: 24, tourId });
  const preview = await getPreview(tourId);
  assert.equal(preview.lines[0].loadedValueInCentimes, 360_000);
  assert.equal('packaging' in preview.lines[0].salePriceAtLoading, false);
  assert.ok((await load(tourId, preview.digest)).tourId);
  const reservation = await database.collection('tourReservations').findOne({ productId, tourId });
  assert.equal(reservation.salePriceAtLoading.packaging, undefined);
});

test('refuse un conditionnement sans prix de vente et un prix de pack modifié après aperçu', async () => {
  const packagingId = new ObjectId();
  const productId = await insertProduct({
    packagings: [{ _id: packagingId, label: 'Pack de 6', quantity: 6, salePriceInCentimes: null, usage: 'SALE' }],
  });
  const tourId = await insertTour();
  await addReservation({ productId, tourId, quantityMode: 'PACKAGING', packagingId: packagingId.toString(), packagingCount: '2' });
  assert.match((await getPreview(tourId)).errors.form, /prix de vente TTC du conditionnement « Pack de 6 » n’est pas renseigné/u);
  assert.match((await load(tourId, 'a'.repeat(64))).errors.form, /conditionnement « Pack de 6 »/u);
  assert.equal(await database.collection('stockMovements').countDocuments({ sourceTourId: tourId }), 0);

  await database.collection('products').updateOne({ _id: productId }, { $set: {
    'packagings.0.salePrice': { amountInCentimes: 80_000, currency: 'DZD', taxIncluded: true },
  } });
  const preview = await getPreview(tourId);
  assert.equal(preview.totalValueInCentimes, 160_000);
  await database.collection('products').updateOne({ _id: productId }, { $set: { 'packagings.0.salePrice.amountInCentimes': 85_000 } });
  assert.match((await load(tourId, preview.digest)).errors.form, /tarifs applicables ont changé/u);
  assert.equal(await database.collection('stockMovements').countDocuments({ sourceTourId: tourId }), 0);
  const refreshed = await getPreview(tourId);
  assert.equal(refreshed.totalValueInCentimes, 170_000);
  assert.ok((await load(tourId, refreshed.digest)).tourId);
});

test('recontrôle les usages avant chargement et refuse les brouillons devenus inéligibles sans transition partielle', async () => {
  for (const usage of ['RECEPTION', undefined, null, '', 'ALL', 'REMOVED', 'FOREIGN']) {
    const packagingId = new ObjectId();
    const productId = await insertProduct({ packagings: [{ _id: packagingId, label: 'Pack de 6', quantity: 6, usage: 'SALE' }] });
    const directProductId = await insertProduct();
    const tourId = await insertTour();
    await addReservation({ productId: directProductId, tourId });
    await addReservation({ productId, tourId, quantityMode: 'PACKAGING', packagingId: packagingId.toString(), packagingCount: '5' });
    const preview = await getPreview(tourId);
    assert.deepEqual(preview.errors, {});
    if (usage === 'FOREIGN') {
      await database.collection('tourReservations').updateOne({ productId, tourId }, { $set: { 'packaging.packagingId': new ObjectId() } });
    } else {
      await database.collection('products').updateOne({ _id: productId }, usage === 'REMOVED'
        ? { $set: { packagings: [] } } : usage === undefined
          ? { $unset: { 'packagings.0.usage': '' } } : { $set: { 'packagings.0.usage': usage } });
    }
    const productsBefore = await database.collection('products').find({ _id: { $in: [productId, directProductId] } }).sort({ _id: 1 }).toArray();
    const tourBefore = await database.collection('tours').findOne({ _id: tourId });
    const delivererBefore = await database.collection('deliverers').findOne({ _id: tourBefore.delivererId });
    const reservationsBefore = await database.collection('tourReservations').find({ tourId }).sort({ _id: 1 }).toArray();
    assert.match((await getPreview(tourId)).errors.form, /conditionnement.*n’est plus activé pour la vente/u);
    assert.match((await load(tourId, preview.digest)).errors.form, /conditionnement.*n’est plus activé pour la vente/u);
    assert.equal(await database.collection('stockMovements').countDocuments({ sourceTourId: tourId }), 0);
    assert.deepEqual(await database.collection('tourReservations').find({ tourId }).sort({ _id: 1 }).toArray(), reservationsBefore);
    assert.deepEqual(await database.collection('products').find({ _id: { $in: [productId, directProductId] } }).sort({ _id: 1 }).toArray(), productsBefore);
    assert.deepEqual(await database.collection('tours').findOne({ _id: tourId }), tourBefore);
    assert.deepEqual(await database.collection('deliverers').findOne({ _id: tourBefore.delivererId }), delivererBefore);
  }
});

test('contrôle aussi les anciens brouillons conditionnés sans quantityMode ou sans référence de conditionnement', async () => {
  for (const missingField of ['quantityMode', 'packaging']) {
    const packagingId = new ObjectId();
    const productId = await insertProduct({ packagings: [{ _id: packagingId, label: 'Pack', quantity: 6, usage: 'SALE' }] });
    const tourId = await insertTour();
    await addReservation({ productId, tourId, quantityMode: 'PACKAGING', packagingId: packagingId.toString(), packagingCount: '5' });
    const preview = await getPreview(tourId);
    await database.collection('tourReservations').updateOne({ productId, tourId }, { $unset: { [missingField]: '' } });
    if (missingField === 'quantityMode') {
      await database.collection('products').updateOne({ _id: productId }, { $set: { 'packagings.0.usage': 'RECEPTION' } });
    }
    assert.match((await getPreview(tourId)).errors.form, /conditionnement/u);
    assert.match((await load(tourId, preview.digest)).errors.form, /conditionnement/u);
    assert.equal(await database.collection('stockMovements').countDocuments({ sourceTourId: tourId }), 0);
  }
});

test('autorise le chargement mixte et conserve le chargement historique après reclassification', async () => {
  const packagingId = new ObjectId();
  const productId = await insertProduct({ baseUnit: 'SACHET', packagings: [{ _id: packagingId, label: 'Lot', quantity: 6, usage: 'BOTH' }] });
  const tourId = await insertTour();
  await addReservation({ productId, tourId, quantityMode: 'PACKAGING', packagingId: packagingId.toString(), packagingCount: '5' });
  const preview = await getPreview(tourId);
  assert.deepEqual(preview.errors, {});
  assert.ok((await load(tourId, preview.digest)).tourId);
  const before = await database.collection('tourReservations').findOne({ productId, tourId });
  const movementBefore = await database.collection('stockMovements').findOne({ sourceTourId: tourId });
  assert.equal(before.quantityInBaseUnits, 30);
  assert.equal(before.salePriceAtLoading.unit, 'SACHET');
  assert.equal(movementBefore.quantityDeltaInBaseUnits, -30);
  await database.collection('products').updateOne({ _id: productId }, { $set: { 'packagings.0.usage': 'RECEPTION' } });
  assert.equal((await load(tourId, preview.digest)).replayed, true);
  assert.deepEqual(await database.collection('tourReservations').findOne({ productId, tourId }), before);
  assert.deepEqual(await database.collection('stockMovements').findOne({ sourceTourId: tourId }), movementBefore);
  assert.equal(await database.collection('stockMovements').countDocuments({ sourceTourId: tourId }), 1);
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

  const preview = await getPreview(tourId);
  assert.match(preview.errors.form, /stock physique/u);
  const result = await load(tourId, createTourLoadingDigest([]));
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
  assert.ok(firstSharedLoad.tourId || firstSharedLoad.errors?.form);
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

const readValuationReport = async (productId) => {
  const product = await database.collection('products').findOne({ _id: productId });
  return readStoredStockValuationReconciliation({ database, productId, baseUnit: product.baseUnit });
};

const receive = async (productId, quantity = 10, amount = '50') => {
  const supplierId = new ObjectId();
  await database.collection('suppliers').insertOne({ _id: supplierId, active: true, name: 'Atlas' });
  return createReception({
    createdBy: loaderId.toHexString(), supplierId: supplierId.toHexString(),
    receptionDate: '2026-09-17', supplierReference: 'BL-VALUATION', submissionKey: randomUUID(),
    lines: [{ productId: productId.toHexString(), baseUnit: 'PIECE',
      quantityMode: 'DIRECT', directQuantity: String(quantity), amount }],
  });
};

const createCostReader = async () => {
  const userId = new ObjectId();
  const roleId = new ObjectId();
  await database.collection('roles').insertOne({
    _id: roleId, permissions: ['tours.load', 'tours.read', 'pricing.read', 'stock.valuation.read'],
  });
  await database.collection('users').insertOne({ _id: userId, active: true, roleIds: [roleId] });
  return { userId, roleId };
};

const snapshotLoadingRecords = async (tourId, productIds) => ({
  tour: await database.collection('tours').findOne({ _id: tourId }),
  reservations: await database.collection('tourReservations').find({ tourId }).sort({ _id: 1 }).toArray(),
  products: await database.collection('products').find({ _id: { $in: productIds } }).sort({ _id: 1 }).toArray(),
  valuations: await database.collection('stockValuations').find({ productId: { $in: productIds } }).sort({ productId: 1 }).toArray(),
  entries: await database.collection('stockValuationEntries').find({ productId: { $in: productIds } }).sort({ _id: 1 }).toArray(),
  movements: await database.collection('stockMovements').find({ productId: { $in: productIds } }).sort({ _id: 1 }).toArray(),
});

test('purchase costs are hidden without stock.valuation.read and shown only after server authorization', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  await addReservation({ productId, tourId });
  const { userId, roleId } = await createCostReader();
  const hidden = await getPreview(tourId);
  const visible = await getPreview(tourId, userId);
  assert.equal(hidden.digest, visible.digest);
  assert.equal('totalPurchaseCostInCentimes' in hidden, false);
  assert.equal('purchaseCostAtLoading' in hidden.lines[0], false);
  assert.equal('valuationSource' in hidden.lines[0], false);
  assert.equal('valuationSource' in visible.lines[0], false);
  assert.equal(visible.totalPurchaseCostInCentimes, 3_000);
  assert.deepEqual(visible.lines[0].purchaseCostAtLoading, {
    method: 'MOVING_WEIGHTED_AVERAGE', version: 1, baseUnit: 'PIECE',
    quantityInBaseUnits: 30, valueInCentimes: 3_000, currency: 'DZD', taxIncluded: true,
  });
  await database.collection('roles').updateOne({ _id: roleId }, { $pull: { permissions: 'stock.valuation.read' } });
  const revoked = await getPreview(tourId, userId);
  assert.equal('purchaseCostAtLoading' in revoked.lines[0], false);
  assert.equal('totalPurchaseCostInCentimes' in revoked, false);
  assert.ok((await load(tourId, hidden.digest)).tourId);
  const stored = await database.collection('tourReservations').findOne({ tourId });
  assert.deepEqual(stored.purchaseCostAtLoading, visible.lines[0].purchaseCostAtLoading);
  const result = await readValuationReport(productId);
  assert.equal(result.complete, true);
  assert.equal(result.quantityInBaseUnits, 70);
  assert.equal(result.valueInCentimes, 7_000);
  // Existing reservation/tour readers do not accidentally expose newly stored costs.
  const detail = await getTourById(tourId.toHexString(), { includePricing: true, userId: loaderId.toHexString() });
  assert.equal('purchaseCostAtLoading' in detail.lines[0], false);
  const [line] = await listTourReservations({ database, tourId: tourId.toHexString() });
  assert.equal('purchaseCostAtLoading' in line, false);
});

test('internal loading allocation rounds combined withdrawal once and preserves repeated line order', async () => {
  // The current reservation UI permits one active line per product. Exercise the
  // internal writer's multiple-line contract for imported/future source records.
  const productId = await insertProduct({ physicalQuantity: 3, purchaseValueInCentimes: 1 });
  const original = await database.collection('stockValuationEntries').findOne({ productId });
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await database.collection('products').updateOne({ _id: productId }, { $inc: { stockReferenceVersion: 1 } }, { session });
      const lines = [1, 1].map((quantityInBaseUnits) => ({
        _id: new ObjectId(), productId, baseUnit: 'PIECE', quantityInBaseUnits,
      }));
      const prepared = await prepareTourLoadingStockValuations({ database, session, lines });
      assert.deepEqual(prepared.map((line) => line.purchaseCostAtLoading.valueInCentimes), [1, 0]);
      const recordedAt = new Date();
      const tourId = new ObjectId();
      const movements = lines.map((line) => ({
        _id: new ObjectId(), productId, baseUnit: 'PIECE', kind: 'TOUR_LOADING_OUT',
        quantityDeltaInBaseUnits: -line.quantityInBaseUnits,
        sourceTourId: tourId, sourceTourReservationId: line._id, recordedAt, recordedBy: loaderId,
      }));
      await applyTourLoadingStockValuations({ database, session, lines: prepared, movements });
      await database.collection('stockMovements').insertMany(movements, { session });
    });
  } finally {
    await session.endSession();
  }
  const entries = await database.collection('stockValuationEntries').find({ productId }).sort({ revision: 1 }).toArray();
  assert.deepEqual(entries[0], original);
  assert.deepEqual(entries.map((entry) => entry.valueDeltaInCentimes), [1, -1, 0]);
  assert.deepEqual(entries.map((entry) => entry.revision), [1, 2, 3]);
  const report = await readValuationReport(productId);
  assert.equal(report.complete, true);
  assert.equal(report.quantityInBaseUnits, 1);
  assert.equal(report.valueInCentimes, 0);
});

test('full loading removes the entire remaining purchase value, including zero-cost stock', async () => {
  for (const purchaseValueInCentimes of [0, 100]) {
    const productId = await insertProduct({ physicalQuantity: 3, purchaseValueInCentimes });
    const tourId = await insertTour();
    await addReservation({ productId, tourId, quantity: 3 });
    assert.ok((await load(tourId, await getDigest(tourId))).tourId);
    const report = await readValuationReport(productId);
    assert.equal(report.complete, true);
    assert.equal(report.quantityInBaseUnits, 0);
    assert.equal(report.valueInCentimes, 0);
    assert.equal(report.averageUnitCostInCentimes, null);
    const lines = await database.collection('tourReservations').find({ tourId }).toArray();
    assert.equal(lines.reduce((sum, line) => sum + line.purchaseCostAtLoading.valueInCentimes, 0), purchaseValueInCentimes);
  }
});

test('packaged loading assigns purchase value using the converted base-unit quantity', async () => {
  const packagingId = new ObjectId();
  const productId = await insertProduct({ baseUnit: 'BOUTEILLE',
    packagings: [{ _id: packagingId, label: 'Pack', quantity: 12, usage: 'SALE' }] });
  const tourId = await insertTour();
  await addReservation({ productId, tourId, quantityMode: 'PACKAGING', packagingId: packagingId.toHexString(), packagingCount: '5' });
  const { userId } = await createCostReader();
  const preview = await getPreview(tourId, userId);
  assert.equal(preview.lines[0].purchaseCostAtLoading.quantityInBaseUnits, 60);
  assert.equal(preview.totalPurchaseCostInCentimes, 6_000);
  assert.ok((await load(tourId, preview.digest)).tourId);
  assert.equal((await readValuationReport(productId)).valueInCentimes, 4_000);
  assert.equal((await readValuationReport(productId)).complete, true);
});

test('a new reception invalidates approval even when the assigned rounded cost is unchanged', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  await addReservation({ productId, tourId });
  const { userId } = await createCostReader();
  const original = await getPreview(tourId, userId);
  assert.equal((await receive(productId, 10, '10')).replayed, false);
  const refreshed = await getPreview(tourId, userId);
  assert.equal(original.totalPurchaseCostInCentimes, refreshed.totalPurchaseCostInCentimes);
  assert.notEqual(original.digest, refreshed.digest);
  const before = await snapshotLoadingRecords(tourId, [productId]);
  assert.match((await load(tourId, original.digest)).errors.form, /valorisation.*changé/u);
  assert.deepEqual(await snapshotLoadingRecords(tourId, [productId]), before);
  assert.ok((await load(tourId, refreshed.digest)).tourId);
});

test('loading after a reception uses the remaining stock average and later receipts preserve its snapshot', async () => {
  const productId = await insertProduct({ physicalQuantity: 100, purchaseValueInCentimes: 500_000 });
  const firstTourId = await insertTour();
  await addReservation({ productId, tourId: firstTourId, quantity: 40 });
  assert.ok((await load(firstTourId, await getDigest(firstTourId))).tourId);
  const original = await database.collection('tourReservations').findOne({ tourId: firstTourId });
  assert.equal(original.purchaseCostAtLoading.valueInCentimes, 200_000);
  await receive(productId, 40, '2800');
  const report = await readValuationReport(productId);
  assert.equal(report.complete, true);
  assert.equal(report.quantityInBaseUnits, 100);
  assert.equal(report.valueInCentimes, 580_000);
  const secondTourId = await insertTour();
  await addReservation({ productId, tourId: secondTourId, quantity: 10 });
  assert.ok((await load(secondTourId, await getDigest(secondTourId))).tourId);
  const second = await database.collection('tourReservations').findOne({ tourId: secondTourId });
  assert.equal(second.purchaseCostAtLoading.valueInCentimes, 58_000);
  assert.deepEqual(await database.collection('tourReservations').findOne({ tourId: firstTourId }), original);
  assert.equal((await readValuationReport(productId)).valueInCentimes, 522_000);
});

test('concurrent tours sharing stock cannot both apply the same valuation approval', async () => {
  const productId = await insertProduct({ physicalQuantity: 10, purchaseValueInCentimes: 101 });
  const firstTourId = await insertTour();
  const secondTourId = await insertTour();
  await addReservation({ productId, tourId: firstTourId, quantity: 3 });
  await addReservation({ productId, tourId: secondTourId, quantity: 4 });
  const firstDigest = await getDigest(firstTourId);
  const secondDigest = await getDigest(secondTourId);
  const results = await Promise.all([load(firstTourId, firstDigest), load(secondTourId, secondDigest)]);
  assert.equal(results.filter((result) => result.tourId).length, 1);
  assert.match(results.find((result) => result.errors).errors.form, /valorisation.*changé/u);
  const remainingTourId = results[0].errors ? firstTourId : secondTourId;
  assert.ok((await load(remainingTourId, await getDigest(remainingTourId))).tourId);
  const report = await readValuationReport(productId);
  assert.equal(report.complete, true);
  assert.equal(report.quantityInBaseUnits, 3);
  const lines = await database.collection('tourReservations').find({ productId }).toArray();
  assert.equal(report.valueInCentimes + lines.reduce((sum, line) => sum + line.purchaseCostAtLoading.valueInCentimes, 0), 101);
});

test('a concurrent reception and loading preserve cost according to the committed order', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  await addReservation({ productId, tourId, quantity: 30 });
  const digest = await getDigest(tourId);
  const [loading, reception] = await Promise.all([load(tourId, digest), receive(productId)]);
  assert.equal(reception.replayed, false);
  const report = await readValuationReport(productId);
  assert.equal(report.complete, true);
  if (loading.tourId) {
    const line = await database.collection('tourReservations').findOne({ tourId });
    assert.equal(line.purchaseCostAtLoading.valueInCentimes, 3_000);
    assert.equal(report.valueInCentimes, 12_000);
    assert.equal(report.quantityInBaseUnits, 80);
  } else {
    assert.match(loading.errors.form, /valorisation.*changé/u);
    assert.equal(report.valueInCentimes, 15_000);
    assert.ok((await load(tourId, await getDigest(tourId))).tourId);
  }
});

test('unknown, missing, corrupt and mismatched valuations block loading without partial writes', async () => {
  for (const problem of ['missing', 'unknown', 'record', 'ledger', 'unit', 'unvalued-return']) {
    const productId = await insertProduct();
    const tourId = await insertTour();
    await addReservation({ productId, tourId });
    const digest = await getDigest(tourId);
    if (problem === 'missing') await database.collection('stockValuations').deleteOne({ productId });
    if (problem === 'unknown') await database.collection('stockValuations').updateOne({ productId }, { $set: { status: 'UNVALUED', valueInCentimes: null } });
    if (problem === 'record') await database.collection('stockValuations').updateOne({ productId }, { $set: { revision: -1 } });
    if (problem === 'ledger') await database.collection('stockValuations').updateOne({ productId }, { $inc: { valueInCentimes: 1 } });
    if (problem === 'unit') await database.collection('stockValuations').updateOne({ productId }, { $set: { baseUnit: 'BOITE' } });
    if (problem === 'unvalued-return') await database.collection('stockMovements').insertOne({
      productId, baseUnit: 'PIECE', kind: 'TOUR_RETURN_IN', quantityDeltaInBaseUnits: 1,
      sourceTourId: new ObjectId(), sourceTourReservationId: new ObjectId(), sourceTourCountingId: new ObjectId(),
    });
    const before = await snapshotLoadingRecords(tourId, [productId]);
    const preview = await getPreview(tourId);
    assert.match(preview.errors.form, /valorisation.*incomplète/u);
    assert.equal(preview.digest, undefined);
    assert.deepEqual(preview.lines, []);
    assert.match((await load(tourId, digest)).errors.form, /valorisation.*incomplète/u);
    assert.deepEqual(await snapshotLoadingRecords(tourId, [productId]), before);
  }
});

test('a ledger write failure rolls back costs, physical stock, reservations, and all locks', async () => {
  const productId = await insertProduct();
  const secondProductId = await insertProduct();
  const tourId = await insertTour();
  await addReservation({ productId, tourId, quantity: 10 });
  await addReservation({ productId: secondProductId, tourId, quantity: 20 });
  const digest = await getDigest(tourId);
  const before = await snapshotLoadingRecords(tourId, [productId, secondProductId]);
  const tour = before.tour;
  const delivererBefore = await database.collection('deliverers').findOne({ _id: tour.delivererId });
  await database.collection('stockValuationEntries').createIndex({ sourceTourId: 1 }, {
    name: 'force_loading_valuation_failure', unique: true,
    partialFilterExpression: { sourceTourId: tourId },
  });
  try {
    await assert.rejects(load(tourId, digest), { code: 11000 });
    assert.deepEqual(await snapshotLoadingRecords(tourId, [productId, secondProductId]), before);
    assert.deepEqual(await database.collection('deliverers').findOne({ _id: tour.delivererId }), delivererBefore);
  } finally {
    await database.collection('stockValuationEntries').dropIndex('force_loading_valuation_failure');
  }
});

test('a physical movement write failure rolls back the preceding valuation transfer', async () => {
  const productId = await insertProduct();
  const secondProductId = await insertProduct();
  const tourId = await insertTour();
  await addReservation({ productId, tourId, quantity: 10 });
  await addReservation({ productId: secondProductId, tourId, quantity: 20 });
  const digest = await getDigest(tourId);
  const before = await snapshotLoadingRecords(tourId, [productId, secondProductId]);
  await database.collection('stockMovements').createIndex({ sourceTourId: 1 }, {
    name: 'force_physical_loading_failure', unique: true,
    partialFilterExpression: { sourceTourId: tourId },
  });
  try {
    await assert.rejects(load(tourId, digest), { code: 11000 });
    assert.deepEqual(await snapshotLoadingRecords(tourId, [productId, secondProductId]), before);
  } finally {
    await database.collection('stockMovements').dropIndex('force_physical_loading_failure');
  }
});

test('purchase allocations support safe integer limits without floating-point products', async () => {
  const productId = await insertProduct({ physicalQuantity: 100, purchaseValueInCentimes: Number.MAX_SAFE_INTEGER });
  const tourId = await insertTour();
  await addReservation({ productId, tourId, quantity: 1 });
  assert.ok((await load(tourId, await getDigest(tourId))).tourId);
  const line = await database.collection('tourReservations').findOne({ tourId });
  assert.equal(line.purchaseCostAtLoading.valueInCentimes, 90_071_992_547_410);
  const report = await readValuationReport(productId);
  assert.equal(report.complete, true);
  assert.equal(report.valueInCentimes + line.purchaseCostAtLoading.valueInCentimes, Number.MAX_SAFE_INTEGER);
});

test('combined purchase cost overflow rejects preview and confirmation even for hidden costs', async () => {
  const first = await insertProduct({ physicalQuantity: 1, purchaseValueInCentimes: Number.MAX_SAFE_INTEGER });
  const second = await insertProduct({ physicalQuantity: 1, purchaseValueInCentimes: Number.MAX_SAFE_INTEGER });
  const tourId = await insertTour();
  await addReservation({ productId: first, tourId, quantity: 1 });
  await addReservation({ productId: second, tourId, quantity: 1 });
  const before = await snapshotLoadingRecords(tourId, [first, second]);
  assert.match((await getPreview(tourId)).errors.form, /coût d’achat total.*limite/u);
  assert.match((await load(tourId, createTourLoadingDigest([]))).errors.form, /coût d’achat total.*limite/u);
  assert.deepEqual(await snapshotLoadingRecords(tourId, [first, second]), before);
});

test('loading valuation services require a transaction', async () => {
  await assert.rejects(prepareTourLoadingStockValuations({ database, lines: [] }), TypeError);
  await assert.rejects(applyTourLoadingStockValuations({ database, lines: [], movements: [] }), TypeError);
});

test('valuation permission grant changes only yahia’s dedicated role and is idempotent', async () => {
  const dedicatedId = new ObjectId();
  const sharedId = new ObjectId();
  const otherId = new ObjectId();
  await database.collection('roles').insertMany([
    { _id: dedicatedId, key: 'yahia-full-access', permissions: [] },
    { _id: sharedId, key: 'shared-manager', permissions: [] },
  ]);
  await database.collection('users').insertMany([
    { _id: new ObjectId(), username: 'yahia', roleIds: [dedicatedId, sharedId] },
    { _id: otherId, username: 'other-user', roleIds: [sharedId] },
  ]);
  const otherBefore = await database.collection('users').findOne({ _id: otherId });
  const sharedBefore = await database.collection('roles').findOne({ _id: sharedId });
  assert.equal((await grantYahiaFullAccessPermission('stock.valuation.read')).granted, true);
  assert.equal((await grantYahiaFullAccessPermission('stock.valuation.read')).granted, false);
  assert.deepEqual((await database.collection('roles').findOne({ _id: dedicatedId })).permissions, ['stock.valuation.read']);
  assert.deepEqual(await database.collection('roles').findOne({ _id: sharedId }), sharedBefore);
  assert.deepEqual(await database.collection('users').findOne({ _id: otherId }), otherBefore);
});

test('a reconciled return invalidates loading approval while restoring the original purchase cost', async () => {
  const productId = await insertProduct();
  const originalTourId = await insertTour();
  await addReservation({ productId, tourId: originalTourId, quantity: 30 });
  assert.ok((await load(originalTourId, await getDigest(originalTourId))).tourId);
  const loaded = await database.collection('tourReservations').findOne({ tourId: originalTourId });
  const tourId = await insertTour();
  await addReservation({ productId, tourId, quantity: 30 });
  const digest = await getDigest(tourId);
  // Counting integration is phase 4; simulate a complete original-cost return
  // using the foundation's exact calculation and the same product lock.
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await database.collection('products').updateOne({ _id: productId }, { $inc: { stockReferenceVersion: 1 } }, { session });
      const valuation = await database.collection('stockValuations').findOne({ productId }, { session });
      const transition = calculateStockReturn({
        balance: valuation, loadedQuantityInBaseUnits: 30,
        loadedValueInCentimes: loaded.purchaseCostAtLoading.valueInCentimes,
        returnedQuantityInBaseUnits: 10,
      });
      const recordedAt = new Date();
      const movement = {
        _id: new ObjectId(), productId, baseUnit: 'PIECE', kind: 'TOUR_RETURN_IN',
        quantityDeltaInBaseUnits: 10, sourceTourId: originalTourId,
        sourceTourReservationId: loaded._id, sourceTourCountingId: new ObjectId(),
        recordedAt, recordedBy: loaderId,
      };
      const entry = createStockValuationEntry({ movement, ...transition, revision: valuation.revision + 1 });
      await database.collection('stockValuationEntries').insertOne(entry, { session });
      await database.collection('stockMovements').insertOne(movement, { session });
      await database.collection('stockValuations').replaceOne({ _id: valuation._id }, {
        ...valuation, ...transition.after, revision: entry.revision,
        lastLedgerEntryId: entry._id, updatedAt: recordedAt,
      }, { session });
    });
  } finally {
    await session.endSession();
  }
  assert.equal((await readValuationReport(productId)).complete, true);
  assert.match((await load(tourId, digest)).errors.form, /valorisation.*changé/u);
  assert.ok((await load(tourId, await getDigest(tourId))).tourId);
  assert.equal((await readValuationReport(productId)).valueInCentimes, 5_000);
  assert.deepEqual(await database.collection('tourReservations').findOne({ tourId: originalTourId }), loaded);
});

test('reservations and releases leave warehouse valuation and ledger unchanged', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  const valuation = await database.collection('stockValuations').findOne({ productId });
  const entries = await database.collection('stockValuationEntries').find({ productId }).toArray();
  const addition = await addReservation({ productId, tourId });
  assert.deepEqual(await database.collection('stockValuations').findOne({ productId }), valuation);
  await releaseTourReservation({ releasedBy: loaderId.toHexString(), tourId: tourId.toHexString(), reservationId: addition.reservation.id });
  assert.deepEqual(await database.collection('stockValuations').findOne({ productId }), valuation);
  assert.deepEqual(await database.collection('stockValuationEntries').find({ productId }).toArray(), entries);
});
