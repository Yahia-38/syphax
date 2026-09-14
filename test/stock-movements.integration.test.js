import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_stock_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  backfillReceptionStockMovements,
  getProductStockSummaries,
} = await import('../lib/stock-movements.js');

let database;

before(async () => {
  database = await getDatabase();
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('intègre les réceptions historiques et peut être relancé sans doublon', async () => {
  const authorId = new ObjectId();
  const receptionId = new ObjectId();
  const firstLineId = new ObjectId();
  const secondLineId = new ObjectId();
  const firstProductId = new ObjectId();
  const secondProductId = new ObjectId();
  const existingMovementId = new ObjectId();
  const receptionDate = new Date('2026-08-20T00:00:00.000Z');
  const createdAt = new Date('2026-08-21T09:30:00.000Z');

  await database.collection('receptions').insertOne({
    _id: receptionId,
    receptionDate,
    createdAt,
    createdBy: authorId,
    lines: [
      {
        _id: firstLineId,
        productId: firstProductId,
        baseUnit: 'PIECE',
        quantityInBaseUnits: 5,
      },
      {
        _id: secondLineId,
        productId: secondProductId,
        baseUnit: 'BOITE',
        quantityInBaseUnits: 8,
      },
    ],
  });
  await database.collection('stockMovements').insertOne({
    _id: existingMovementId,
    kind: 'RECEPTION_IN',
    productId: firstProductId,
    baseUnit: 'PIECE',
    quantityDeltaInBaseUnits: 5,
    occurredOn: receptionDate,
    recordedAt: createdAt,
    recordedBy: authorId,
    sourceReceptionId: receptionId,
    sourceReceptionLineId: firstLineId,
  });

  const firstRun = await backfillReceptionStockMovements({ database });
  const secondRun = await backfillReceptionStockMovements({ database });
  const movements = await database.collection('stockMovements').find({
    sourceReceptionId: receptionId,
  }).sort({ quantityDeltaInBaseUnits: 1 }).toArray();

  assert.equal(firstRun.createdMovementCount, 1);
  assert.equal(firstRun.existingMovementCount, 1);
  assert.equal(firstRun.skippedLineCount, 0);
  assert.equal(secondRun.createdMovementCount, 0);
  assert.equal(secondRun.existingMovementCount, 2);
  assert.equal(movements.length, 2);
  assert.ok(movements.some((movement) => movement._id.equals(existingMovementId)));
  assert.deepEqual(
    movements.map((movement) => movement.quantityDeltaInBaseUnits),
    [5, 8],
  );
});

test('agrège entrées, sorties et date du dernier mouvement par produit', async () => {
  const productId = new ObjectId();
  const productWithoutMovementId = new ObjectId();
  const firstDate = new Date('2026-09-01T00:00:00.000Z');
  const lastDate = new Date('2026-09-03T00:00:00.000Z');

  await database.collection('stockMovements').insertMany([
    {
      productId,
      kind: 'RECEPTION_IN',
      quantityDeltaInBaseUnits: 20,
      occurredOn: firstDate,
    },
    {
      productId,
      kind: 'ISSUE_OUT',
      quantityDeltaInBaseUnits: -6,
      occurredOn: lastDate,
    },
  ]);

  const summaries = await getProductStockSummaries([
    productId,
    productWithoutMovementId,
    productId,
  ], { database });

  assert.deepEqual(summaries.get(productId.toString()), {
    availableQuantityInBaseUnits: 14,
    inputQuantityInBaseUnits: 20,
    lastMovementAt: lastDate,
    movementCount: 2,
    outputQuantityInBaseUnits: 6,
    quantityInBaseUnits: 14,
    reservedQuantityInBaseUnits: 0,
  });
  assert.equal(summaries.has(productWithoutMovementId.toString()), false);
});

test('déduit uniquement les réservations actives du disponible', async () => {
  const productId = new ObjectId();

  await Promise.all([
    database.collection('stockMovements').insertOne({
      productId,
      kind: 'TEST_IN',
      quantityDeltaInBaseUnits: 100,
    }),
    database.collection('tourReservations').insertMany([
      {
        productId,
        quantityInBaseUnits: 30,
        status: 'ACTIVE',
      },
      {
        productId,
        quantityInBaseUnits: 20,
        status: 'RELEASED',
      },
    ]),
  ]);

  const summary = (await getProductStockSummaries([productId], { database }))
    .get(productId.toString());

  assert.equal(summary.quantityInBaseUnits, 100);
  assert.equal(summary.reservedQuantityInBaseUnits, 30);
  assert.equal(summary.availableQuantityInBaseUnits, 70);
});
