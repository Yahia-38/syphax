import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_tour_cancel_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { deactivateDeliverer } = await import('../lib/deliverers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  TOUR_LOADING_OUTPUT_KIND,
  getProductStockSummaries,
} = await import('../lib/stock-movements.js');
const {
  addAndReserveTourProduct,
  releaseTourReservation,
} = await import('../lib/tour-reservations.js');
const {
  TOUR_CANCELLATION_RELEASE_REASON,
  cancelTour,
  createTourCancellationDigest,
  getTourCancellationPreview,
} = await import('../lib/tour-cancellations.js');
const {
  confirmTourLoading,
  getTourLoadingPreview,
} = await import('../lib/tour-loadings.js');
const {
  formatTourStatus,
  getTourById,
  listToursByDeliverer,
} = await import('../lib/tours.js');

let cancellerId;
let database;

before(async () => {
  database = await getDatabase();
  cancellerId = new ObjectId();
  const roleId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      key: 'tour-canceller-test',
      permissions: [
        'pricing.read',
        'tours.cancel',
        'tours.load',
        'tours.read',
      ],
    }),
    database.collection('users').insertOne({
      _id: cancellerId,
      active: true,
      roleIds: [roleId],
      username: 'annulateur-test',
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
    name: 'Livreur annulation',
  });

  return delivererId;
};

const insertTour = async ({ delivererId, status = 'PREPARATION' } = {}) => {
  const tourId = new ObjectId();
  const resolvedDelivererId = delivererId ?? await insertDeliverer();
  const deliverer = await database.collection('deliverers').findOne({
    _id: resolvedDelivererId,
  });

  await database.collection('tours').insertOne({
    _id: tourId,
    delivererCode: deliverer?.code ?? 'LIV-INCONNU',
    delivererId: resolvedDelivererId,
    delivererName: deliverer?.name ?? 'Livreur inconnu',
    plannedDate: new Date('2026-09-14T00:00:00.000Z'),
    reference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
    status,
  });

  return { delivererId: resolvedDelivererId, tourId };
};

const insertProduct = async ({ physicalQuantity = 100 } = {}) => {
  const productId = new ObjectId();

  await Promise.all([
    database.collection('products').insertOne({
      _id: productId,
      active: true,
      baseUnit: 'PIECE',
      code: `PRD-${productId.toHexString().slice(-6)}`,
      designation: `Produit ${productId.toHexString().slice(-4)}`,
      packagings: [],
      salePrice: {
        amountInCentimes: 10_000,
        currency: 'DZD',
        taxIncluded: true,
        updatedAt: new Date('2026-09-14T08:00:00.000Z'),
        updatedBy: cancellerId,
        versionId: new ObjectId(),
      },
    }),
    database.collection('stockMovements').insertOne({
      _id: new ObjectId(),
      baseUnit: 'PIECE',
      kind: 'TEST_IN',
      occurredOn: new Date('2026-09-14T08:00:00.000Z'),
      productId,
      quantityDeltaInBaseUnits: physicalQuantity,
    }),
  ]);

  return productId;
};

const createAdditionRequest = ({
  additionKey = randomUUID(),
  productId,
  quantity,
  tourId,
}) => ({
  additionKey,
  createdBy: cancellerId.toString(),
  directQuantity: String(quantity),
  packagingCount: '',
  packagingId: '',
  productId: productId.toString(),
  quantityMode: 'DIRECT',
  tourId: tourId.toString(),
});

const addReservation = async (input) => {
  const request = createAdditionRequest(input);
  const result = await addAndReserveTourProduct(request);

  assert.ok(result.reservation);

  return { request, result };
};

const getPreview = async (tourId, userId = cancellerId) =>
  getTourCancellationPreview({
    tourId: tourId.toString(),
    userId: userId.toString(),
  });

const cancel = async (tourId, expectedDigest, reason = 'Tournée supprimée du planning') =>
  cancelTour({
    cancelledBy: cancellerId.toString(),
    expectedDigest,
    reason,
    tourId: tourId.toString(),
  });

test('annule plusieurs produits, libère seulement ses réservations et conserve tout l’historique', async () => {
  const firstProductId = await insertProduct({ physicalQuantity: 100 });
  const secondProductId = await insertProduct({ physicalQuantity: 60 });
  const { delivererId, tourId } = await insertTour();
  const { tourId: otherTourId } = await insertTour();

  const oldAddition = await addReservation({
    productId: firstProductId,
    quantity: 5,
    tourId,
  });
  const oldReleaseAuthor = new ObjectId();

  await releaseTourReservation({
    releasedBy: oldReleaseAuthor.toString(),
    reservationId: oldAddition.result.reservation.id,
    tourId: tourId.toString(),
  });

  const oldReleaseBefore = await database.collection('tourReservations')
    .findOne({ _id: new ObjectId(oldAddition.result.reservation.id) });

  await Promise.all([
    addReservation({ productId: firstProductId, quantity: 30, tourId }),
    addReservation({ productId: secondProductId, quantity: 10, tourId }),
    addReservation({ productId: firstProductId, quantity: 20, tourId: otherTourId }),
  ]);

  const movementCountBefore = await database.collection('stockMovements')
    .countDocuments({});
  const preview = await getPreview(tourId);
  const result = await cancel(tourId, preview.digest, 'Client indisponible');
  const [
    cancelledTour,
    detail,
    listedTours,
    reservations,
    summaries,
  ] = await Promise.all([
    database.collection('tours').findOne({ _id: tourId }),
    getTourById(tourId.toString(), { userId: cancellerId.toString() }),
    listToursByDeliverer({
      delivererId: delivererId.toString(),
      userId: cancellerId.toString(),
    }),
    database.collection('tourReservations').find({
      tourId: { $in: [tourId, otherTourId] },
    }).toArray(),
    getProductStockSummaries([firstProductId, secondProductId], { database }),
  ]);
  const oldReleaseAfter = reservations.find((reservation) =>
    reservation._id.equals(oldReleaseBefore._id));
  const cancelledReservations = reservations.filter((reservation) =>
    reservation.tourId.equals(tourId)
    && reservation.releaseReasonCode === TOUR_CANCELLATION_RELEASE_REASON);
  const otherReservation = reservations.find((reservation) =>
    reservation.tourId.equals(otherTourId));
  const firstStock = summaries.get(firstProductId.toString());
  const secondStock = summaries.get(secondProductId.toString());

  assert.equal(result.replayed, false);
  assert.equal(cancelledTour.status, 'CANCELLED');
  assert.equal(cancelledTour.cancellationReason, 'Client indisponible');
  assert.ok(cancelledTour.cancelledAt instanceof Date);
  assert.ok(cancelledTour.cancelledBy.equals(cancellerId));
  assert.equal(formatTourStatus(detail.status), 'Annulée');
  assert.equal(detail.cancelledBy, 'annulateur-test');
  assert.equal(detail.cancellationReason, 'Client indisponible');
  assert.equal(detail.lines.length, 3);
  assert.equal(listedTours.tours[0].status, 'CANCELLED');
  assert.equal(cancelledReservations.length, 2);
  assert.ok(cancelledReservations.every((reservation) =>
    reservation.status === 'RELEASED'
    && reservation.releaseReason === 'Client indisponible'
    && reservation.releasedAt.getTime() === cancelledTour.cancelledAt.getTime()
    && reservation.releasedBy.equals(cancellerId)));
  assert.equal(oldReleaseAfter.releasedAt.getTime(), oldReleaseBefore.releasedAt.getTime());
  assert.ok(oldReleaseAfter.releasedBy.equals(oldReleaseAuthor));
  assert.equal('releaseReasonCode' in oldReleaseAfter, false);
  assert.equal(otherReservation.status, 'ACTIVE');
  assert.equal(firstStock.quantityInBaseUnits, 100);
  assert.equal(firstStock.reservedQuantityInBaseUnits, 20);
  assert.equal(firstStock.availableQuantityInBaseUnits, 80);
  assert.equal(secondStock.quantityInBaseUnits, 60);
  assert.equal(secondStock.reservedQuantityInBaseUnits, 0);
  assert.equal(secondStock.availableQuantityInBaseUnits, 60);
  assert.equal(
    await database.collection('stockMovements').countDocuments({}),
    movementCountBefore,
  );
  assert.equal(await database.collection('cashPayments').countDocuments({}), 0);
  assert.equal(await database.collection('tourCountings').countDocuments({}), 0);
});

test('annule une tournée vide et une tournée dont le livreur est désactivé', async () => {
  const empty = await insertTour();
  const emptyPreview = await getPreview(empty.tourId);
  const emptyResult = await cancel(
    empty.tourId,
    emptyPreview.digest,
    'Aucune livraison prévue',
  );
  const disabled = await insertTour();
  const productId = await insertProduct();

  await addReservation({ productId, quantity: 15, tourId: disabled.tourId });
  await deactivateDeliverer({
    changedBy: cancellerId.toString(),
    delivererId: disabled.delivererId.toString(),
  });

  const disabledPreview = await getPreview(disabled.tourId);
  const disabledResult = await cancel(
    disabled.tourId,
    disabledPreview.digest,
    'Livreur remplacé',
  );

  assert.equal(emptyPreview.digest, createTourCancellationDigest([]));
  assert.deepEqual(emptyPreview.lines, []);
  assert.equal(emptyResult.replayed, false);
  assert.deepEqual(emptyResult.cancellation.productIds, []);
  assert.equal(disabledResult.replayed, false);
  assert.equal((await database.collection('tours').findOne({
    _id: disabled.tourId,
  })).status, 'CANCELLED');
});

test('protège aperçu et confirmation, exige un motif et refuse les états chargés ou comptés', async () => {
  const unauthorizedId = new ObjectId();
  const unauthorizedRoleId = new ObjectId();
  const preparation = await insertTour();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: unauthorizedRoleId,
      permissions: ['tours.read'],
    }),
    database.collection('users').insertOne({
      _id: unauthorizedId,
      active: true,
      roleIds: [unauthorizedRoleId],
      username: 'sans-annulation',
    }),
  ]);

  await assert.rejects(
    getPreview(preparation.tourId, unauthorizedId),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'tours.cancel',
  );
  await assert.rejects(
    cancelTour({
      cancelledBy: unauthorizedId.toString(),
      expectedDigest: createTourCancellationDigest([]),
      reason: 'Tentative interdite',
      tourId: preparation.tourId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'tours.cancel',
  );

  const missingReason = await cancel(preparation.tourId, createTourCancellationDigest([]), '  ');

  assert.match(missingReason.errors.reason, /obligatoire/u);

  for (const status of ['LOADED', 'COUNTED', 'CLOSED']) {
    const { tourId } = await insertTour({ status });
    const result = await cancel(
      tourId,
      createTourCancellationDigest([]),
      `Refus ${status}`,
    );

    assert.match(result.errors.form, /préparation/u);
    assert.equal((await database.collection('tours').findOne({ _id: tourId })).status, status);
  }
});

test('rend deux confirmations identiques idempotentes et interdit toute modification ultérieure', async () => {
  const { tourId } = await insertTour();
  const productId = await insertProduct();

  await addReservation({ productId, quantity: 25, tourId });

  const preview = await getPreview(tourId);
  const [first, second] = await Promise.all([
    cancel(tourId, preview.digest, 'Commande retirée'),
    cancel(tourId, preview.digest, 'Commande retirée'),
  ]);
  const initialTour = await database.collection('tours').findOne({ _id: tourId });
  const initialReservation = await database.collection('tourReservations')
    .findOne({ tourId });
  const different = await cancel(tourId, preview.digest, 'Nouveau motif interdit');
  const replayById = new ObjectId();

  await database.collection('users').insertOne({
    _id: replayById,
    active: true,
    roleIds: (await database.collection('users').findOne({
      _id: cancellerId,
    })).roleIds,
    username: 'autre-annulateur',
  });

  const replayByAnotherUser = await cancelTour({
    cancelledBy: replayById.toString(),
    expectedDigest: preview.digest,
    reason: 'Commande retirée',
    tourId: tourId.toString(),
  });
  const finalTour = await database.collection('tours').findOne({ _id: tourId });
  const finalReservation = await database.collection('tourReservations')
    .findOne({ tourId });

  assert.equal(first.replayed !== second.replayed, true);
  assert.equal(replayByAnotherUser.replayed, true);
  assert.match(different.errors.form, /demande différente/u);
  assert.equal(finalTour.cancelledAt.getTime(), initialTour.cancelledAt.getTime());
  assert.ok(finalTour.cancelledBy.equals(cancellerId));
  assert.equal(finalTour.cancellationReason, 'Commande retirée');
  assert.equal(finalReservation.releasedAt.getTime(), initialReservation.releasedAt.getTime());
  assert.ok(finalReservation.releasedBy.equals(cancellerId));
  assert.equal(await database.collection('tourReservations').countDocuments({
    tourId,
  }), 1);
});

test('refuse un récapitulatif périmé sans libération partielle', async () => {
  const { tourId } = await insertTour();
  const firstProductId = await insertProduct();
  const secondProductId = await insertProduct();

  await addReservation({ productId: firstProductId, quantity: 10, tourId });
  const stalePreview = await getPreview(tourId);
  await addReservation({ productId: secondProductId, quantity: 20, tourId });

  const result = await cancel(tourId, stalePreview.digest);
  const reservations = await database.collection('tourReservations')
    .find({ tourId }).toArray();

  assert.equal(result.stale, true);
  assert.match(result.errors.form, /réservations ont changé/u);
  assert.equal((await database.collection('tours').findOne({ _id: tourId })).status, 'PREPARATION');
  assert.ok(reservations.every((reservation) => reservation.status === 'ACTIVE'));
});

test('sérialise annulation et chargement concurrents : une seule transition réussit', async () => {
  const { tourId } = await insertTour();
  const productId = await insertProduct({ physicalQuantity: 100 });

  await addReservation({ productId, quantity: 30, tourId });

  const [cancellationPreview, loadingPreview] = await Promise.all([
    getPreview(tourId),
    getTourLoadingPreview({
      tourId: tourId.toString(),
      userId: cancellerId.toString(),
    }),
  ]);
  const [cancellation, loading] = await Promise.all([
    cancel(tourId, cancellationPreview.digest, 'Conflit de planning'),
    confirmTourLoading({
      expectedDigest: loadingPreview.digest,
      loadedBy: cancellerId.toString(),
      tourId: tourId.toString(),
    }),
  ]);
  const [tour, reservation, stock, loadingMovementCount] = await Promise.all([
    database.collection('tours').findOne({ _id: tourId }),
    database.collection('tourReservations').findOne({ tourId }),
    getProductStockSummaries([productId], { database }),
    database.collection('stockMovements').countDocuments({
      kind: TOUR_LOADING_OUTPUT_KIND,
      sourceTourId: tourId,
    }),
  ]);
  const summary = stock.get(productId.toString());

  assert.equal(Boolean(cancellation.cancellation), tour.status === 'CANCELLED');
  assert.equal(Boolean(loading.tourId), tour.status === 'LOADED');

  if (tour.status === 'CANCELLED') {
    assert.equal(reservation.status, 'RELEASED');
    assert.equal(summary.quantityInBaseUnits, 100);
    assert.equal(summary.reservedQuantityInBaseUnits, 0);
    assert.equal(loadingMovementCount, 0);
  } else {
    assert.equal(reservation.status, 'LOADED');
    assert.equal(summary.quantityInBaseUnits, 70);
    assert.equal(summary.reservedQuantityInBaseUnits, 0);
    assert.equal(loadingMovementCount, 1);
  }
});

test('annule toute l’opération en cas d’échec et interdit les anciens formulaires', async () => {
  const { tourId } = await insertTour();
  const firstProductId = await insertProduct();
  const secondProductId = await insertProduct();
  const firstAddition = await addReservation({
    productId: firstProductId,
    quantity: 30,
    tourId,
  });

  await addReservation({ productId: secondProductId, quantity: 10, tourId });

  const preview = await getPreview(tourId);
  const loadingPreview = await getTourLoadingPreview({
    tourId: tourId.toString(),
    userId: cancellerId.toString(),
  });

  await database.collection('tourReservations').createIndex(
    { releasedBy: 1 },
    {
      name: 'force_tour_cancellation_failure',
      partialFilterExpression: {
        releaseReasonCode: TOUR_CANCELLATION_RELEASE_REASON,
        tourId,
      },
      unique: true,
    },
  );

  try {
    await assert.rejects(
      cancel(tourId, preview.digest, 'Échec forcé'),
      (error) => error?.code === 11000,
    );

    const [tour, reservations, products] = await Promise.all([
      database.collection('tours').findOne({ _id: tourId }),
      database.collection('tourReservations').find({ tourId }).toArray(),
      database.collection('products').find({
        _id: { $in: [firstProductId, secondProductId] },
      }).toArray(),
    ]);

    assert.equal(tour.status, 'PREPARATION');
    assert.equal(tour.cancellationReferenceVersion, undefined);
    assert.ok(reservations.every((reservation) => reservation.status === 'ACTIVE'));
    assert.ok(products.every((product) => product.stockReferenceVersion === 1));
  } finally {
    await database.collection('tourReservations').dropIndex(
      'force_tour_cancellation_failure',
    );
  }

  const completed = await cancel(tourId, preview.digest, 'Annulation validée');
  const replayedOldAddition = await addAndReserveTourProduct(
    firstAddition.request,
  );
  const refusedNewAddition = await addAndReserveTourProduct({
    ...firstAddition.request,
    additionKey: randomUUID(),
  });
  const oldLoading = await confirmTourLoading({
    expectedDigest: loadingPreview.digest,
    loadedBy: cancellerId.toString(),
    tourId: tourId.toString(),
  });

  assert.equal(completed.replayed, false);
  assert.equal(replayedOldAddition.replayed, true);
  assert.equal(replayedOldAddition.released, true);
  assert.match(refusedNewAddition.errors.form, /plus en préparation/u);
  assert.match(oldLoading.errors.form, /plus en préparation/u);
  assert.equal(await database.collection('stockMovements').countDocuments({
    kind: TOUR_LOADING_OUTPUT_KIND,
    sourceTourId: tourId,
  }), 0);
  assert.ok((await database.collection('tourReservations').find({ tourId })
    .toArray()).every((reservation) => reservation.status === 'RELEASED'));
});
