import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_tour_res_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { deactivateDeliverer } = await import('../lib/deliverers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const { deleteProduct, updateProduct } = await import('../lib/products.js');
const { getProductStockSummaries } = await import(
  '../lib/stock-movements.js'
);
const {
  addAndReserveTourProduct,
  ensureTourReservationIndexes,
  listTourReservations,
  releaseTourReservation,
} = await import('../lib/tour-reservations.js');

let authorId;
let database;

before(async () => {
  database = await getDatabase();
  authorId = new ObjectId();
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
    name: 'Livreur de test',
  });

  return delivererId;
};

const insertTour = async ({ delivererId, status = 'PREPARATION' } = {}) => {
  const tourId = new ObjectId();
  const selectedDelivererId = delivererId ?? await insertDeliverer();

  await database.collection('tours').insertOne({
    _id: tourId,
    delivererId: selectedDelivererId,
    reference: `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`,
    status,
  });

  return tourId;
};

const insertProduct = async ({
  active = true,
  baseUnit = 'PIECE',
  packagings = [],
  physicalQuantity = 100,
} = {}) => {
  const productId = new ObjectId();

  await database.collection('products').insertOne({
    _id: productId,
    active,
    baseUnit,
    code: `PRD-${productId.toHexString().slice(-6)}`,
    designation: 'Produit de réservation',
    packagings,
  });

  if (physicalQuantity !== 0) {
    await database.collection('stockMovements').insertOne({
      kind: 'RECEPTION_IN',
      productId,
      baseUnit,
      quantityDeltaInBaseUnits: physicalQuantity,
      occurredOn: new Date('2026-09-14T00:00:00.000Z'),
    });
  }

  return productId;
};

const createRequest = ({
  additionKey = randomUUID(),
  directQuantity = '30',
  packagingCount = '',
  packagingId = '',
  productId,
  quantityMode = 'DIRECT',
  tourId,
}) => ({
  additionKey,
  createdBy: authorId.toString(),
  directQuantity,
  packagingCount,
  packagingId,
  productId: productId.toString(),
  quantityMode,
  tourId: tourId.toString(),
});

const releaseRequest = ({
  releasedBy = authorId,
  reservationId,
  tourId,
}) => ({
  releasedBy: releasedBy.toString(),
  reservationId,
  tourId: tourId.toString(),
});

test('remplace l’index unique global par un index unique ACTIVE sans perdre de données', async () => {
  const preservedReservationId = new ObjectId();
  const reservations = database.collection('tourReservations');

  await reservations.createIndex(
    { tourId: 1, productId: 1 },
    { name: 'unique_tour_product', unique: true },
  );
  await reservations.insertOne({
    _id: preservedReservationId,
    productId: new ObjectId(),
    status: 'RELEASED',
    tourId: new ObjectId(),
  });

  await ensureTourReservationIndexes(database);

  const indexes = await reservations.listIndexes().toArray();
  const activeIndex = indexes.find(
    (index) => index.name === 'unique_active_tour_product',
  );

  assert.equal(await reservations.countDocuments({
    _id: preservedReservationId,
  }), 1);
  assert.equal(indexes.some(
    (index) => index.name === 'unique_tour_product',
  ), false);
  assert.equal(activeIndex.unique, true);
  assert.deepEqual(activeIndex.partialFilterExpression, { status: 'ACTIVE' });

  await reservations.deleteOne({ _id: preservedReservationId });
});

test('réserve une quantité directe sans modifier le stock physique', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  const movementCountBefore = await database
    .collection('stockMovements')
    .countDocuments({ productId });
  const result = await addAndReserveTourProduct(createRequest({
    productId,
    tourId,
  }));
  const reservation = await database.collection('tourReservations').findOne({
    _id: new ObjectId(result.reservation.id),
  });
  const stock = (await getProductStockSummaries([productId], { database }))
    .get(productId.toString());
  const [line] = await listTourReservations({
    database,
    tourId: tourId.toString(),
  });

  assert.equal(result.replayed, false);
  assert.equal(reservation.quantityMode, 'DIRECT');
  assert.equal(reservation.conversionFactor, 1);
  assert.equal(reservation.quantityInBaseUnits, 30);
  assert.equal(reservation.status, 'ACTIVE');
  assert.equal(line.productCode, reservation.productCode);
  assert.equal(line.productDesignation, reservation.productDesignation);
  assert.equal(line.quantityInBaseUnits, 30);
  assert.equal(line.packaging, null);
  assert.ok(reservation.productId.equals(productId));
  assert.ok(reservation.tourId.equals(tourId));
  assert.ok(reservation.reservedBy.equals(authorId));
  assert.ok(reservation.reservedAt instanceof Date);
  assert.equal(
    await database.collection('stockMovements').countDocuments({ productId }),
    movementCountBefore,
  );
  assert.equal(stock.quantityInBaseUnits, 100);
  assert.equal(stock.reservedQuantityInBaseUnits, 30);
  assert.equal(stock.availableQuantityInBaseUnits, 70);
});

test('recalcule une conversion depuis le conditionnement stocké', async () => {
  const packagingId = new ObjectId();
  const productId = await insertProduct({
    baseUnit: 'BOUTEILLE',
    packagings: [{
      _id: packagingId,
      label: 'Pack de 6',
      quantity: 6,
    }],
  });
  const tourId = await insertTour();
  const result = await addAndReserveTourProduct(createRequest({
    directQuantity: '999',
    packagingCount: '5',
    packagingId: packagingId.toString(),
    productId,
    quantityMode: 'PACKAGING',
    tourId,
  }));
  const reservation = await database.collection('tourReservations').findOne({
    _id: new ObjectId(result.reservation.id),
  });

  assert.equal(reservation.quantityInBaseUnits, 30);
  assert.equal(reservation.conversionFactor, 6);
  assert.deepEqual(
    {
      count: reservation.packaging.count,
      label: reservation.packaging.label,
      quantity: reservation.packaging.quantity,
    },
    { count: 5, label: 'Pack de 6', quantity: 6 },
  );
});

test('refuse un stock insuffisant sans ligne ni réservation', async () => {
  const productId = await insertProduct({ physicalQuantity: 20 });
  const tourId = await insertTour();
  const result = await addAndReserveTourProduct(createRequest({
    directQuantity: '21',
    productId,
    tourId,
  }));

  assert.match(result.errors.quantity, /Stock insuffisant/u);
  assert.equal(await database.collection('tourReservations').countDocuments({
    tourId,
  }), 0);
  assert.equal(await database.collection('stockMovements').countDocuments({
    productId,
  }), 1);
});

test('sérialise deux réservations de 60 sur 100 disponibles', async () => {
  const productId = await insertProduct();
  const firstTourId = await insertTour();
  const secondTourId = await insertTour();
  const results = await Promise.all([
    addAndReserveTourProduct(createRequest({
      directQuantity: '60',
      productId,
      tourId: firstTourId,
    })),
    addAndReserveTourProduct(createRequest({
      directQuantity: '60',
      productId,
      tourId: secondTourId,
    })),
  ]);
  const stock = (await getProductStockSummaries([productId], { database }))
    .get(productId.toString());

  assert.equal(results.filter((result) => result.reservation).length, 1);
  assert.equal(results.filter((result) => result.errors?.quantity).length, 1);
  assert.equal(await database.collection('tourReservations').countDocuments({
    productId,
  }), 1);
  assert.equal(stock.quantityInBaseUnits, 100);
  assert.equal(stock.reservedQuantityInBaseUnits, 60);
  assert.equal(stock.availableQuantityInBaseUnits, 40);
});

test('rend une reprise identique idempotente et refuse une clé détournée', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  const additionKey = randomUUID();
  const request = createRequest({ additionKey, productId, tourId });
  const [first, second] = await Promise.all([
    addAndReserveTourProduct(request),
    addAndReserveTourProduct(request),
  ]);
  const conflict = await addAndReserveTourProduct({
    ...request,
    directQuantity: '31',
  });

  assert.equal(first.reservation.id, second.reservation.id);
  assert.notEqual(first.replayed, second.replayed);
  assert.equal(await database.collection('tourReservations').countDocuments({
    additionKey,
  }), 1);
  assert.equal(
    conflict.errors.form,
    'Cette demande a déjà été utilisée avec un contenu différent.',
  );
});

test('refuse un produit déjà présent sans réservation supplémentaire', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();

  await addAndReserveTourProduct(createRequest({ productId, tourId }));
  const duplicate = await addAndReserveTourProduct(createRequest({
    additionKey: randomUUID(),
    directQuantity: '10',
    productId,
    tourId,
  }));

  assert.equal(
    duplicate.errors.productId,
    'Ce produit est déjà présent dans cette tournée.',
  );
  assert.equal(await database.collection('tourReservations').countDocuments({
    productId,
    tourId,
  }), 1);
});

test('refuse une tournée invalide, un livreur désactivé et un produit inutilisable', async () => {
  const productId = await insertProduct();
  const disabledProductId = await insertProduct({ active: false });
  const disabledDelivererId = await insertDeliverer({ active: false });
  const disabledDelivererTourId = await insertTour({
    delivererId: disabledDelivererId,
  });
  const closedTourId = await insertTour({ status: 'CHARGEE' });
  const disabledDeliverer = await addAndReserveTourProduct(createRequest({
    productId,
    tourId: disabledDelivererTourId,
  }));
  const closedTour = await addAndReserveTourProduct(createRequest({
    productId,
    tourId: closedTourId,
  }));
  const disabledProduct = await addAndReserveTourProduct(createRequest({
    productId: disabledProductId,
    tourId: await insertTour(),
  }));

  assert.match(disabledDeliverer.errors.form, /désactivé/u);
  assert.match(closedTour.errors.form, /n’est plus en préparation/u);
  assert.match(disabledProduct.errors.productId, /inutilisable/u);
});

test('sérialise la réservation avec une désactivation du livreur', async () => {
  const delivererId = await insertDeliverer();
  const tourId = await insertTour({ delivererId });
  const productId = await insertProduct();
  const [reservation] = await Promise.all([
    addAndReserveTourProduct(createRequest({ productId, tourId })),
    deactivateDeliverer({
      changedBy: authorId.toString(),
      delivererId: delivererId.toString(),
    }),
  ]);
  const storedReservation = await database.collection('tourReservations')
    .findOne({ tourId });

  assert.ok(reservation.reservation || /désactivé/u.test(
    reservation.errors?.form ?? '',
  ));
  assert.equal(Boolean(storedReservation), Boolean(reservation.reservation));
});

test('libère la réservation sans mouvement et actualise les lectures de stock', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  const addition = await addAndReserveTourProduct(createRequest({
    productId,
    tourId,
  }));
  const movementCountBefore = await database.collection('stockMovements')
    .countDocuments({ productId });
  const result = await releaseTourReservation(releaseRequest({
    reservationId: addition.reservation.id,
    tourId,
  }));
  const reservation = await database.collection('tourReservations').findOne({
    _id: new ObjectId(addition.reservation.id),
  });
  const stock = (await getProductStockSummaries([productId], { database }))
    .get(productId.toString());
  const lines = await listTourReservations({
    database,
    tourId: tourId.toString(),
  });

  assert.equal(result.replayed, false);
  assert.equal(reservation.status, 'RELEASED');
  assert.ok(reservation.releasedAt instanceof Date);
  assert.ok(reservation.releasedBy.equals(authorId));
  assert.deepEqual(lines, []);
  assert.equal(stock.quantityInBaseUnits, 100);
  assert.equal(stock.reservedQuantityInBaseUnits, 0);
  assert.equal(stock.availableQuantityInBaseUnits, 100);
  assert.equal(await database.collection('stockMovements').countDocuments({
    productId,
  }), movementCountBefore);
  assert.equal('amount' in reservation, false);
  assert.equal('debt' in reservation, false);
});

test('sérialise deux retraits et conserve la première trace de libération', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  const addition = await addAndReserveTourProduct(createRequest({
    productId,
    tourId,
  }));
  const firstAuthorId = new ObjectId();
  const secondAuthorId = new ObjectId();
  const results = await Promise.all([
    releaseTourReservation(releaseRequest({
      releasedBy: firstAuthorId,
      reservationId: addition.reservation.id,
      tourId,
    })),
    releaseTourReservation(releaseRequest({
      releasedBy: secondAuthorId,
      reservationId: addition.reservation.id,
      tourId,
    })),
  ]);
  const releasedOnce = await database.collection('tourReservations').findOne({
    _id: new ObjectId(addition.reservation.id),
  });
  const replay = await releaseTourReservation(releaseRequest({
    releasedBy: new ObjectId(),
    reservationId: addition.reservation.id,
    tourId,
  }));
  const releasedTwice = await database.collection('tourReservations').findOne({
    _id: new ObjectId(addition.reservation.id),
  });
  const [tour, product] = await Promise.all([
    database.collection('tours').findOne({ _id: tourId }),
    database.collection('products').findOne({ _id: productId }),
  ]);

  assert.equal(results.filter((result) => result.replayed === false).length, 1);
  assert.equal(results.filter((result) => result.replayed === true).length, 1);
  assert.equal(replay.replayed, true);
  assert.deepEqual(releasedTwice.releasedAt, releasedOnce.releasedAt);
  assert.ok(
    releasedTwice.releasedBy.equals(firstAuthorId)
    || releasedTwice.releasedBy.equals(secondAuthorId),
  );
  assert.equal(tour.reservationReferenceVersion, 2);
  assert.equal(product.stockReferenceVersion, 2);
});

test('refuse une autre tournée et une tournée qui n’est plus en préparation', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  const otherTourId = await insertTour();
  const addition = await addAndReserveTourProduct(createRequest({
    productId,
    tourId,
  }));
  const wrongTour = await releaseTourReservation(releaseRequest({
    reservationId: addition.reservation.id,
    tourId: otherTourId,
  }));

  await database.collection('tours').updateOne(
    { _id: tourId },
    { $set: { status: 'CHARGEE' } },
  );

  const closedTour = await releaseTourReservation(releaseRequest({
    reservationId: addition.reservation.id,
    tourId,
  }));
  const reservation = await database.collection('tourReservations').findOne({
    _id: new ObjectId(addition.reservation.id),
  });

  assert.match(wrongTour.errors.form, /n’appartient pas/u);
  assert.match(closedTour.errors.form, /n’est plus en préparation/u);
  assert.equal(reservation.status, 'ACTIVE');
  assert.equal('releasedAt' in reservation, false);
  assert.equal('releasedBy' in reservation, false);
});

test('libère après désactivation du livreur', async () => {
  const delivererId = await insertDeliverer();
  const tourId = await insertTour({ delivererId });
  const productId = await insertProduct();
  const addition = await addAndReserveTourProduct(createRequest({
    productId,
    tourId,
  }));

  await deactivateDeliverer({
    changedBy: authorId.toString(),
    delivererId: delivererId.toString(),
  });

  const result = await releaseTourReservation(releaseRequest({
    reservationId: addition.reservation.id,
    tourId,
  }));

  assert.equal(result.replayed, false);
  assert.equal(await database.collection('tourReservations').countDocuments({
    _id: new ObjectId(addition.reservation.id),
    status: 'RELEASED',
  }), 1);
});

test('réserve à nouveau avec une nouvelle clé sans réactiver l’ancienne demande', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  const additionKey = randomUUID();
  const oldRequest = createRequest({ additionKey, productId, tourId });
  const oldAddition = await addAndReserveTourProduct(oldRequest);

  await releaseTourReservation(releaseRequest({
    reservationId: oldAddition.reservation.id,
    tourId,
  }));

  const newAddition = await addAndReserveTourProduct(createRequest({
    additionKey: randomUUID(),
    directQuantity: '20',
    productId,
    tourId,
  }));
  const oldReplay = await addAndReserveTourProduct(oldRequest);
  const oldReleaseReplay = await releaseTourReservation(releaseRequest({
    reservationId: oldAddition.reservation.id,
    tourId,
  }));
  const reservations = await database.collection('tourReservations').find({
    productId,
    tourId,
  }).sort({ reservedAt: 1 }).toArray();

  assert.notEqual(newAddition.reservation.id, oldAddition.reservation.id);
  assert.equal(oldReplay.replayed, true);
  assert.equal(oldReplay.released, true);
  assert.equal(oldReplay.reservation.id, oldAddition.reservation.id);
  assert.equal(oldReleaseReplay.replayed, true);
  assert.deepEqual(reservations.map((reservation) => reservation.status), [
    'RELEASED',
    'ACTIVE',
  ]);
  assert.equal(reservations[1].quantityInBaseUnits, 20);
});

test('conserve un stock cohérent lors d’un retrait et d’un ajout concurrents', async () => {
  const productId = await insertProduct();
  const tourId = await insertTour();
  const initialAddition = await addAndReserveTourProduct(createRequest({
    directQuantity: '30',
    productId,
    tourId,
  }));
  const [release, addition] = await Promise.all([
    releaseTourReservation(releaseRequest({
      reservationId: initialAddition.reservation.id,
      tourId,
    })),
    addAndReserveTourProduct(createRequest({
      additionKey: randomUUID(),
      directQuantity: '40',
      productId,
      tourId,
    })),
  ]);
  const activeReservations = await database.collection('tourReservations')
    .find({ productId, status: 'ACTIVE', tourId })
    .toArray();
  const stock = (await getProductStockSummaries([productId], { database }))
    .get(productId.toString());
  const expectedReserved = activeReservations.reduce(
    (total, reservation) => total + reservation.quantityInBaseUnits,
    0,
  );

  assert.equal(release.replayed, false);
  assert.ok(addition.reservation || addition.errors?.productId);
  assert.ok(activeReservations.length <= 1);
  assert.equal(stock.quantityInBaseUnits, 100);
  assert.equal(stock.reservedQuantityInBaseUnits, expectedReserved);
  assert.equal(stock.availableQuantityInBaseUnits, 100 - expectedReserved);
});

test('protège suppression et changement d’unité avec une réservation référencée', async () => {
  const productId = await insertProduct({ physicalQuantity: 0 });

  await database.collection('tourReservations').insertOne({
    productId,
    tourId: new ObjectId(),
    quantityInBaseUnits: 1,
    status: 'ACTIVE',
  });

  assert.deepEqual(await deleteProduct(productId.toString()), {
    inUse: true,
    reservationInUse: true,
  });
  assert.equal((await updateProduct({
    productId: productId.toString(),
    code: `PRD-${productId.toHexString().slice(-6)}`,
    designation: 'Produit de réservation',
    baseUnit: 'BOITE',
    updatedBy: authorId.toString(),
  })).errors.baseUnit, 'L’unité de base ne peut plus être modifiée car ce produit est référencé par une tournée.');
});
