import { ObjectId } from 'mongodb';

import { getDatabase } from './mongodb.js';

export const RECEPTION_INPUT_KIND = 'RECEPTION_IN';
export const TOUR_LOADING_OUTPUT_KIND = 'TOUR_LOADING_OUT';
export const ACTIVE_RESERVATION_STATUS = 'ACTIVE';

const BACKFILL_BATCH_SIZE = 500;

const isStoredDate = (value) => value instanceof Date
  && !Number.isNaN(value.getTime());

export const ensureStockMovementIndexes = async (database) => {
  const stockMovements = database.collection('stockMovements');

  await Promise.all([
    stockMovements.createIndex(
      {
        kind: 1,
        sourceReceptionId: 1,
        sourceReceptionLineId: 1,
      },
      {
        name: 'unique_reception_line_stock_movement',
        partialFilterExpression: { kind: RECEPTION_INPUT_KIND },
        unique: true,
      },
    ),
    stockMovements.createIndex(
      {
        kind: 1,
        sourceTourReservationId: 1,
      },
      {
        name: 'unique_tour_loading_reservation_movement',
        partialFilterExpression: { kind: TOUR_LOADING_OUTPUT_KIND },
        unique: true,
      },
    ),
    stockMovements.createIndex(
      { productId: 1 },
      { name: 'stock_movement_product' },
    ),
  ]);
};

const createHistoricalReceptionMovement = (reception, line) => {
  if (
    !(reception?._id instanceof ObjectId)
    || !(line?._id instanceof ObjectId)
    || !(line?.productId instanceof ObjectId)
    || typeof line.baseUnit !== 'string'
    || !line.baseUnit
    || !Number.isSafeInteger(line.quantityInBaseUnits)
    || line.quantityInBaseUnits <= 0
  ) {
    return null;
  }

  const occurredOn = isStoredDate(reception.receptionDate)
    ? reception.receptionDate
    : reception.createdAt;
  const recordedAt = isStoredDate(reception.createdAt)
    ? reception.createdAt
    : reception.receptionDate;

  return {
    _id: new ObjectId(),
    kind: RECEPTION_INPUT_KIND,
    productId: line.productId,
    baseUnit: line.baseUnit,
    quantityDeltaInBaseUnits: line.quantityInBaseUnits,
    ...(isStoredDate(occurredOn) ? { occurredOn } : {}),
    ...(isStoredDate(recordedAt) ? { recordedAt } : {}),
    ...(reception.createdBy instanceof ObjectId
      ? { recordedBy: reception.createdBy }
      : {}),
    sourceReceptionId: reception._id,
    sourceReceptionLineId: line._id,
  };
};

const writeBackfillBatch = async (stockMovements, movements) => {
  if (movements.length === 0) {
    return 0;
  }

  const result = await stockMovements.bulkWrite(
    movements.map((movement) => ({
      updateOne: {
        filter: {
          kind: movement.kind,
          sourceReceptionId: movement.sourceReceptionId,
          sourceReceptionLineId: movement.sourceReceptionLineId,
        },
        update: { $setOnInsert: movement },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return result.upsertedCount;
};

export const backfillReceptionStockMovements = async ({
  database: providedDatabase,
} = {}) => {
  const database = providedDatabase ?? await getDatabase();
  const stockMovements = database.collection('stockMovements');

  await ensureStockMovementIndexes(database);

  const receptions = database.collection('receptions').find(
    { 'lines.0': { $exists: true } },
    {
      projection: {
        createdAt: 1,
        createdBy: 1,
        lines: 1,
        receptionDate: 1,
      },
    },
  );
  const batch = [];
  let receptionCount = 0;
  let lineCount = 0;
  let skippedLineCount = 0;
  let createdMovementCount = 0;

  for await (const reception of receptions) {
    receptionCount += 1;

    for (const line of reception.lines) {
      lineCount += 1;

      const movement = createHistoricalReceptionMovement(reception, line);

      if (!movement) {
        skippedLineCount += 1;
        continue;
      }

      batch.push(movement);

      if (batch.length >= BACKFILL_BATCH_SIZE) {
        createdMovementCount += await writeBackfillBatch(
          stockMovements,
          batch,
        );
        batch.length = 0;
      }
    }
  }

  createdMovementCount += await writeBackfillBatch(stockMovements, batch);

  return {
    receptionCount,
    lineCount,
    createdMovementCount,
    existingMovementCount:
      lineCount - skippedLineCount - createdMovementCount,
    skippedLineCount,
  };
};

export const getProductStockSummaries = async (
  productIds,
  { database: providedDatabase, session } = {},
) => {
  const normalizedProductIds = [...new Map(
    (Array.isArray(productIds) ? productIds : [])
      .filter((productId) => productId instanceof ObjectId)
      .map((productId) => [productId.toString(), productId]),
  ).values()];

  if (normalizedProductIds.length === 0) {
    return new Map();
  }

  const database = providedDatabase ?? await getDatabase();
  const readPhysicalSummaries = () => database
    .collection('stockMovements')
    .aggregate([
      {
        $match: {
          productId: { $in: normalizedProductIds },
          quantityDeltaInBaseUnits: { $type: 'number' },
        },
      },
      {
        $group: {
          _id: '$productId',
          inputQuantityInBaseUnits: {
            $sum: {
              $cond: [
                { $gt: ['$quantityDeltaInBaseUnits', 0] },
                '$quantityDeltaInBaseUnits',
                0,
              ],
            },
          },
          lastMovementAt: { $max: '$occurredOn' },
          movementCount: { $sum: 1 },
          outputQuantityInBaseUnits: {
            $sum: {
              $cond: [
                { $lt: ['$quantityDeltaInBaseUnits', 0] },
                { $abs: '$quantityDeltaInBaseUnits' },
                0,
              ],
            },
          },
          quantityInBaseUnits: { $sum: '$quantityDeltaInBaseUnits' },
        },
      },
    ], { session })
    .toArray();
  const readReservationSummaries = () => database
    .collection('tourReservations')
    .aggregate([
      {
        $match: {
          productId: { $in: normalizedProductIds },
          quantityInBaseUnits: { $type: 'number' },
          status: ACTIVE_RESERVATION_STATUS,
        },
      },
      {
        $group: {
          _id: '$productId',
          reservedQuantityInBaseUnits: { $sum: '$quantityInBaseUnits' },
        },
      },
    ], { session }).toArray();
  let physicalSummaries;
  let reservationSummaries;

  if (session) {
    physicalSummaries = await readPhysicalSummaries();
    reservationSummaries = await readReservationSummaries();
  } else {
    [physicalSummaries, reservationSummaries] = await Promise.all([
      readPhysicalSummaries(),
      readReservationSummaries(),
    ]);
  }

  const physicalByProduct = new Map(
    physicalSummaries.map((summary) => [summary._id.toString(), summary]),
  );
  const reservedByProduct = new Map(
    reservationSummaries.map((summary) => [
      summary._id.toString(),
      summary.reservedQuantityInBaseUnits,
    ]),
  );

  const productIdsWithStock = new Set([
    ...physicalByProduct.keys(),
    ...reservedByProduct.keys(),
  ]);

  return new Map([...productIdsWithStock].map((id) => {
    const physical = physicalByProduct.get(id);
    const quantityInBaseUnits = physical?.quantityInBaseUnits ?? 0;
    const reservedQuantityInBaseUnits = reservedByProduct.get(id) ?? 0;

    return [id, {
      inputQuantityInBaseUnits: physical?.inputQuantityInBaseUnits ?? 0,
      lastMovementAt: physical?.lastMovementAt ?? null,
      movementCount: physical?.movementCount ?? 0,
      outputQuantityInBaseUnits: physical?.outputQuantityInBaseUnits ?? 0,
      quantityInBaseUnits,
      reservedQuantityInBaseUnits,
      availableQuantityInBaseUnits:
        quantityInBaseUnits - reservedQuantityInBaseUnits,
    }];
  }));
};

export const getEmptyProductStockSummary = () => ({
  inputQuantityInBaseUnits: 0,
  lastMovementAt: null,
  movementCount: 0,
  outputQuantityInBaseUnits: 0,
  quantityInBaseUnits: 0,
  reservedQuantityInBaseUnits: 0,
  availableQuantityInBaseUnits: 0,
});

export const listProductStockMovements = async (
  productId,
  { database: providedDatabase, includeTourSources = false } = {},
) => {
  if (!(productId instanceof ObjectId)) {
    return [];
  }

  const database = providedDatabase ?? await getDatabase();
  const documents = await database.collection('stockMovements').find(
    { productId },
    {
      projection: {
        baseUnit: 1,
        kind: 1,
        occurredOn: 1,
        quantityDeltaInBaseUnits: 1,
        recordedAt: 1,
        recordedBy: 1,
        sourceTourId: 1,
        tourReference: 1,
      },
    },
  ).sort({ occurredOn: -1, recordedAt: -1, _id: -1 }).toArray();
  const authorIds = [...new Map(
    documents
      .map((movement) => movement.recordedBy)
      .filter((authorId) => authorId instanceof ObjectId)
      .map((authorId) => [authorId.toString(), authorId]),
  ).values()];
  const authors = authorIds.length > 0
    ? await database.collection('users').find(
        { _id: { $in: authorIds } },
        { projection: { username: 1 } },
      ).toArray()
    : [];
  const authorsById = new Map(
    authors.map((author) => [author._id.toString(), author.username]),
  );

  return documents.map((movement) => ({
    id: movement._id.toString(),
    author: authorsById.get(movement.recordedBy?.toString()) ?? null,
    baseUnit: movement.baseUnit ?? null,
    kind: movement.kind,
    occurredOn: movement.occurredOn?.toISOString?.() ?? null,
    quantityDeltaInBaseUnits: movement.quantityDeltaInBaseUnits,
    recordedAt: movement.recordedAt?.toISOString?.() ?? null,
    sourceTour: includeTourSources
      && movement.sourceTourId instanceof ObjectId
      ? {
          id: movement.sourceTourId.toString(),
          reference: movement.tourReference ?? 'Tournée',
        }
      : null,
  }));
};
