import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission, userHasPermission } from './access.js';
import {
  coordinateCashDeliverer,
  coordinateCashTour,
} from './cash-payment-coordination.js';
import { calculateTourCounting } from './tour-counting-calculations.js';
import { getMongoClient } from './mongodb.js';
import { ensureStockValuationIndexes } from './stock-valuations.js';
import { normalizeLoadingPurchaseCost, readRecordedCountingPurchaseCosts } from './tour-counting-purchase-costs.js';
import { applyTourCountingStockValuations, prepareTourCountingStockValuations } from './tour-counting-stock-valuations.js';
import {
  TOUR_RETURN_INPUT_KIND,
  ensureStockMovementIndexes,
} from './stock-movements.js';
import { LOADED_RESERVATION_STATUS } from './tour-reservations.js';
import {
  TOUR_STATUS_CLOSED,
  TOUR_STATUS_COUNTED,
  TOUR_STATUS_LOADED,
} from './tours.js';

const CONFIRMATION_KEY_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const DIGEST_PATTERN = /^[\da-f]{64}$/u;

export const TOUR_COUNTING_PERMISSIONS = Object.freeze([
  'tours.read',
  'tours.count.prepare',
  'pricing.read',
]);

export const TOUR_COUNTING_CONFIRM_PERMISSIONS = Object.freeze([
  'tours.read',
  'tours.count.confirm',
  'pricing.read',
]);

class TourCountingValidationError extends Error {
  constructor(errors) {
    super('Le comptage de la tournée est invalide.');
    this.name = 'TourCountingValidationError';
    this.errors = errors;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const normalizeIdentifier = (value) =>
  value instanceof ObjectId ? value.toString() : value ?? null;

const normalizeDate = (value) => value instanceof Date
  ? value.toISOString()
  : typeof value === 'string'
    ? value
    : null;

const serializePackagingSalePrice = (packaging) => ({
  amountInCentimes: packaging.amountInCentimes,
  currency: packaging.currency,
  label: packaging.label,
  packagingId: normalizeIdentifier(packaging.packagingId),
  quantity: packaging.quantity,
  ...(normalizeDate(packaging.sourceUpdatedAt)
    ? { sourceUpdatedAt: normalizeDate(packaging.sourceUpdatedAt) }
    : {}),
  ...(normalizeIdentifier(packaging.sourceUpdatedBy)
    ? { sourceUpdatedBy: normalizeIdentifier(packaging.sourceUpdatedBy) }
    : {}),
  ...(normalizeIdentifier(packaging.sourceVersionId)
    ? { sourceVersionId: normalizeIdentifier(packaging.sourceVersionId) }
    : {}),
  taxIncluded: packaging.taxIncluded,
});

const serializeSalePrice = (salePrice) => salePrice
  ? {
      amountInCentimes: salePrice.amountInCentimes,
      currency: salePrice.currency,
      ...(normalizeDate(salePrice.sourceUpdatedAt)
        ? { sourceUpdatedAt: normalizeDate(salePrice.sourceUpdatedAt) }
        : {}),
      ...(normalizeIdentifier(salePrice.sourceUpdatedBy)
        ? { sourceUpdatedBy: normalizeIdentifier(salePrice.sourceUpdatedBy) }
        : {}),
      ...(normalizeIdentifier(salePrice.sourceVersionId)
        ? { sourceVersionId: normalizeIdentifier(salePrice.sourceVersionId) }
        : {}),
      taxIncluded: salePrice.taxIncluded,
      unit: salePrice.unit,
      ...(salePrice.packaging
        ? { packaging: serializePackagingSalePrice(salePrice.packaging) }
        : {}),
    }
  : null;

const serializeHistoricalLines = (lines) => (Array.isArray(lines) ? lines : [])
  .map((line) => ({
    baseUnit: line.baseUnit,
    id: normalizeIdentifier(line.id ?? line._id),
    productCode: line.productCode,
    productDesignation: line.productDesignation,
    productId: normalizeIdentifier(line.productId),
    quantityInBaseUnits: line.quantityInBaseUnits,
    salePriceAtLoading: serializeSalePrice(line.salePriceAtLoading),
    purchaseCostAtLoading: normalizeLoadingPurchaseCost(line),
    status: line.status,
  }))
  .sort((firstLine, secondLine) => firstLine.id.localeCompare(secondLine.id));

export const createTourCountingSheetDigest = (lines) => createHash('sha256')
  .update(JSON.stringify(serializeHistoricalLines(lines)))
  .digest('hex');

const normalizeSubmittedLines = (lines) => (Array.isArray(lines) ? lines : [])
  .map((line) => ({
    lineId: normalizeText(line?.lineId).toLocaleLowerCase('en'),
    returnedQuantity: normalizeText(line?.returnedQuantity),
  }));

const createCountingRequestDigest = ({ expectedSheetDigest, lines, tourId }) =>
  createHash('sha256')
    .update(JSON.stringify({
      expectedSheetDigest,
      lines: [...lines].sort((firstLine, secondLine) =>
        firstLine.lineId.localeCompare(secondLine.lineId)
        || firstLine.returnedQuantity.localeCompare(
          secondLine.returnedQuantity,
        )),
      tourId,
    }))
    .digest('hex');

export const ensureTourCountingIndexes = async (database) => {
  const countings = database.collection('tourCountings');

  await Promise.all([
    countings.createIndex(
      { tourId: 1 },
      { name: 'unique_tour_counting', unique: true },
    ),
    countings.createIndex(
      { confirmationKeys: 1 },
      { name: 'unique_tour_counting_confirmation_key', unique: true },
    ),
  ]);
};

const serializeStoredCounting = (counting, author = null, includeValuation = false) => {
  const costs = includeValuation ? readRecordedCountingPurchaseCosts(counting) : null;
  return {
    countedAt: counting.countedAt?.toISOString?.() ?? null,
    countedBy: author,
    errors: {},
    lines: (counting.lines ?? []).map((line, index) => ({
      amountDueInCentimes: line.amountDueInCentimes,
      baseUnit: line.baseUnit,
      id: line.sourceTourReservationId?.toString?.() ?? '',
      productCode: line.productCode,
      productDesignation: line.productDesignation,
      productId: line.productId?.toString?.() ?? '',
      quantityInBaseUnits: line.quantityInBaseUnits,
      returnedQuantityInBaseUnits: line.returnedQuantityInBaseUnits,
      salePriceAtLoading: serializeSalePrice(line.salePriceAtLoading),
      soldQuantityInBaseUnits: line.soldQuantityInBaseUnits,
      ...(includeValuation ? costs.lines[index] : {}),
    })),
    recorded: true,
    totalDueInCentimes: counting.totalDueInCentimes,
    ...(includeValuation ? {
      totalPurchaseCostInCentimes: costs.totalPurchaseCostInCentimes,
      totalReturnedValueInCentimes: costs.totalReturnedValueInCentimes,
      totalCostOfGoodsSoldInCentimes: costs.totalCostOfGoodsSoldInCentimes,
    } : {}),
    tourId: counting.tourId?.toString?.() ?? '',
  };
};

const readStoredCountingSheet = async ({ database, session, tourId, includeValuation }) => {
  const counting = await database.collection('tourCountings').findOne({
    tourId,
  }, { session });

  if (!counting) {
    return null;
  }

  const author = counting.countedBy instanceof ObjectId
    ? await database.collection('users').findOne(
        { _id: counting.countedBy },
        { projection: { username: 1 }, session },
      )
    : null;

  return serializeStoredCounting(counting, author?.username ?? null, includeValuation);
};

export const getTourCountingSheet = async ({ tourId, userId }) => {
  const client = await getMongoClient();
  const database = client.db();
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      for (const permission of TOUR_COUNTING_PERMISSIONS) {
        await requireUserPermission(userId, permission, { database, session });
      }
      const includeValuation = await userHasPermission(userId, 'stock.valuation.read', { database, session });
      if (typeof tourId !== 'string' || !ObjectId.isValid(tourId)) return null;
      const tourObjectId = new ObjectId(tourId);
      const tour = await database.collection('tours').findOne({ _id: tourObjectId }, { session });
      if (!tour) return null;
      const result = { tourId: tourObjectId.toHexString(), lines: [] };
      if ([TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED].includes(tour.status)) {
        const stored = await readStoredCountingSheet({ database, session, tourId: tourObjectId, includeValuation });
        return stored ?? {
          ...result, recorded: true,
          errors: { form: 'Le comptage enregistré de cette tournée est introuvable.' },
        };
      }
      if (tour.status !== TOUR_STATUS_LOADED) {
        return {
          ...result, recorded: false,
          errors: { form: 'La feuille de comptage est disponible uniquement pour une tournée chargée.' },
        };
      }
      try {
        const reservations = await readLoadedReservations({ database, session, tourId: tourObjectId });
        validateLoadedReservations(reservations);
        await prepareTourCountingStockValuations({
          database, session, tourId: tourObjectId,
          lines: reservations.map((line) => ({ ...line, returnedQuantityInBaseUnits: 0 })),
        });
        return {
          ...result, recorded: false, errors: {},
          // Only the immutable loading costs enter this digest. A later receipt
          // changes the warehouse average, but never the approved original cost.
          digest: createTourCountingSheetDigest(reservations),
          lines: reservations.map((line) => ({
            baseUnit: line.baseUnit, id: line._id.toHexString(),
            productCode: line.productCode, productDesignation: line.productDesignation,
            productId: line.productId.toHexString(), quantityInBaseUnits: line.quantityInBaseUnits,
            salePriceAtLoading: serializeSalePrice(line.salePriceAtLoading), status: line.status,
            ...(includeValuation ? { purchaseCostAtLoading: normalizeLoadingPurchaseCost(line) } : {}),
          })),
        };
      } catch (error) {
        if (!(error instanceof TourCountingValidationError) && !(error instanceof RangeError)) throw error;
        return { ...result, recorded: false, errors: error.errors ?? { form: error.message } };
      }
    }, { readConcern: { level: 'snapshot' } });
  } finally {
    await session.endSession();
  }
};

const readLoadedReservations = async ({ database, session, tourId }) =>
  database.collection('tourReservations').find(
    { status: LOADED_RESERVATION_STATUS, tourId },
    {
      projection: {
        baseUnit: 1,
        productCode: 1,
        productDesignation: 1,
        productId: 1,
        quantityInBaseUnits: 1,
        salePriceAtLoading: 1,
        purchaseCostAtLoading: 1,
        status: 1,
      },
      session,
    },
  ).sort({ _id: 1 }).toArray();

const validateLoadedReservations = (reservations) => {
  if (reservations.length === 0) {
    throw new TourCountingValidationError({
      form: 'Cette tournée ne contient aucune ligne chargée à compter.',
    });
  }

  for (const reservation of reservations) {
    if (
      !(reservation._id instanceof ObjectId)
      || !(reservation.productId instanceof ObjectId)
      || typeof reservation.productCode !== 'string'
      || !reservation.productCode
      || typeof reservation.productDesignation !== 'string'
      || !reservation.productDesignation
      || typeof reservation.baseUnit !== 'string'
      || !reservation.baseUnit
      || !Number.isSafeInteger(reservation.quantityInBaseUnits)
      || reservation.quantityInBaseUnits <= 0
    ) {
      throw new TourCountingValidationError({
        form: 'Une ligne chargée contient une référence ou une quantité historique invalide.',
      });
    }
  }
};

const mapSubmittedReturns = ({ reservations, submittedLines }) => {
  const reservationsById = new Map(reservations.map((reservation) => [
    reservation._id.toString(),
    reservation,
  ]));
  const returnedQuantities = {};
  const submittedIds = new Set();

  for (const line of submittedLines) {
    if (!ObjectId.isValid(line.lineId)) {
      throw new TourCountingValidationError({
        form: 'Une référence de ligne transmise est invalide.',
      });
    }

    if (submittedIds.has(line.lineId)) {
      throw new TourCountingValidationError({
        form: 'Une ligne de la tournée a été transmise plusieurs fois.',
      });
    }

    if (!reservationsById.has(line.lineId)) {
      throw new TourCountingValidationError({
        form: 'Une ligne transmise n’appartient pas aux produits chargés de cette tournée.',
      });
    }

    submittedIds.add(line.lineId);
    returnedQuantities[line.lineId] = line.returnedQuantity;
  }

  if (submittedIds.size !== reservations.length) {
    throw new TourCountingValidationError({
      form: 'Une saisie explicite est requise pour chaque ligne chargée de la tournée.',
    });
  }

  return returnedQuantities;
};

const lockAndValidateProducts = async ({
  database,
  productIds,
  reservations,
  session,
}) => {
  const productsById = new Map();

  for (const productId of productIds) {
    const product = await database.collection('products').findOneAndUpdate(
      { _id: productId },
      { $inc: { stockReferenceVersion: 1 } },
      {
        projection: { baseUnit: 1 },
        returnDocument: 'after',
        session,
      },
    );

    if (!product) {
      throw new TourCountingValidationError({
        form: 'Un produit chargé n’existe plus.',
      });
    }

    productsById.set(product._id.toString(), product);
  }

  for (const reservation of reservations) {
    if (
      productsById.get(reservation.productId.toString())?.baseUnit
      !== reservation.baseUnit
    ) {
      throw new TourCountingValidationError({
        form: 'L’unité historique d’un produit chargé est incohérente.',
      });
    }
  }
};

const buildStoredLines = ({ calculations, reservations }) => {
  const calculationsById = new Map(calculations.map((calculation) => [
    calculation.id,
    calculation,
  ]));

  return reservations.map((reservation) => {
    const calculation = calculationsById.get(reservation._id.toString());

    return {
      amountDueInCentimes: calculation.amountDueInCentimes,
      baseUnit: reservation.baseUnit,
      productCode: reservation.productCode,
      productDesignation: reservation.productDesignation,
      productId: reservation.productId,
      quantityInBaseUnits: reservation.quantityInBaseUnits,
      returnedQuantityInBaseUnits:
        calculation.returnedQuantityInBaseUnits,
      salePriceAtLoading: reservation.salePriceAtLoading,
      purchaseCostAtLoading: reservation.purchaseCostAtLoading,
      soldQuantityInBaseUnits: calculation.soldQuantityInBaseUnits,
      sourceTourReservationId: reservation._id,
    };
  });
};

const serializeConfirmationResult = (counting, replayed) => ({
  countedAt: counting.countedAt?.toISOString?.() ?? null,
  countedBy: counting.countedBy?.toString?.() ?? null,
  countingId: counting._id.toString(),
  delivererId: counting.delivererId?.toString?.() ?? null,
  productIds: [...new Set(
    counting.lines.map((line) => line.productId.toString()),
  )],
  replayed,
  totalDueInCentimes: counting.totalDueInCentimes,
  tourId: counting.tourId.toString(),
});

const readExistingByConfirmationKey = async ({
  confirmationKey,
  database,
  requestDigest,
  session,
}) => {
  const counting = await database.collection('tourCountings').findOne(
    { confirmationKeys: confirmationKey },
    { session },
  );

  if (!counting) {
    return null;
  }

  if (counting.requestDigest !== requestDigest) {
    throw new TourCountingValidationError({
      form: 'Cette demande a déjà été utilisée avec un contenu différent.',
    });
  }

  return serializeConfirmationResult(counting, true);
};

export const confirmTourCounting = async ({
  confirmationKey,
  countedBy,
  expectedSheetDigest,
  lines,
  tourId,
}) => {
  const normalizedConfirmationKey = normalizeText(confirmationKey)
    .toLocaleLowerCase('en');
  const normalizedCountedBy = normalizeText(countedBy);
  const normalizedExpectedSheetDigest = normalizeText(expectedSheetDigest)
    .toLocaleLowerCase('en');
  const normalizedLines = normalizeSubmittedLines(lines);
  const normalizedTourId = normalizeText(tourId);
  const errors = {};

  if (!CONFIRMATION_KEY_PATTERN.test(normalizedConfirmationKey)) {
    errors.form = 'La clé de confirmation est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedCountedBy)) {
    errors.form = 'L’auteur du comptage est invalide.';
  }

  if (!DIGEST_PATTERN.test(normalizedExpectedSheetDigest)) {
    errors.form = 'Le récapitulatif du comptage est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedTourId)) {
    errors.form = 'Cette tournée n’existe plus.';
  }

  if (!Array.isArray(lines)) {
    errors.form = 'Les lignes du comptage sont invalides.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const countedByObjectId = new ObjectId(normalizedCountedBy);
  const tourObjectId = new ObjectId(normalizedTourId);
  const requestDigest = createCountingRequestDigest({
    expectedSheetDigest: normalizedExpectedSheetDigest,
    lines: normalizedLines,
    tourId: normalizedTourId,
  });

  await Promise.all([
    ensureStockMovementIndexes(database),
    ensureTourCountingIndexes(database),
    ensureStockValuationIndexes(database),
  ]);

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      for (const permission of TOUR_COUNTING_CONFIRM_PERMISSIONS) {
        await requireUserPermission(normalizedCountedBy, permission, {
          database,
          session,
        });
      }

      const existingRequest = await readExistingByConfirmationKey({
        confirmationKey: normalizedConfirmationKey,
        database,
        requestDigest,
        session,
      });

      if (existingRequest) {
        return existingRequest;
      }

      const preliminaryTour = await database.collection('tours').findOne(
        { _id: tourObjectId },
        { projection: { delivererId: 1 }, session },
      );

      if (!preliminaryTour) {
        throw new TourCountingValidationError({
          form: 'Cette tournée n’existe plus.',
        });
      }

      if (!(preliminaryTour.delivererId instanceof ObjectId)) {
        throw new TourCountingValidationError({
          form: 'Le livreur historique de cette tournée est introuvable.',
        });
      }

      const deliverer = await coordinateCashDeliverer({
        database,
        delivererId: preliminaryTour.delivererId,
        session,
      });

      if (!deliverer) {
        throw new TourCountingValidationError({
          form: 'Le livreur historique de cette tournée est introuvable.',
        });
      }

      const tour = await coordinateCashTour({
        database,
        filter: {
          delivererId: preliminaryTour.delivererId,
          status: TOUR_STATUS_LOADED,
        },
        projection: { delivererId: 1, reference: 1 },
        session,
        tourId: tourObjectId,
        versionField: 'countingReferenceVersion',
      });

      if (!tour) {
        const currentTour = await database.collection('tours').findOne(
          { _id: tourObjectId },
          { projection: { status: 1 }, session },
        );
        const existingCounting = currentTour?.status === TOUR_STATUS_COUNTED
          ? await database.collection('tourCountings').findOne(
              { tourId: tourObjectId },
              { session },
            )
          : null;

        if (existingCounting?.requestDigest === requestDigest) {
          await database.collection('tourCountings').updateOne(
            { _id: existingCounting._id, requestDigest },
            { $addToSet: { confirmationKeys: normalizedConfirmationKey } },
            { session },
          );

          return serializeConfirmationResult(existingCounting, true);
        }

        throw new TourCountingValidationError({
          form: currentTour?.status === TOUR_STATUS_COUNTED
            ? 'Cette tournée a déjà été comptée avec un contenu différent.'
            : currentTour
              ? 'Cette tournée n’est pas chargée ou a déjà été comptée.'
              : 'Cette tournée n’existe plus.',
        });
      }

      const reservations = await readLoadedReservations({
        database,
        session,
        tourId: tourObjectId,
      });

      validateLoadedReservations(reservations);

      const returnedQuantities = mapSubmittedReturns({
        reservations,
        submittedLines: normalizedLines,
      });
      const productIds = [...new Map(
        reservations.map((reservation) => [
          reservation.productId.toString(),
          reservation.productId,
        ]),
      ).values()].sort((firstId, secondId) =>
        firstId.toString().localeCompare(secondId.toString()));

      await lockAndValidateProducts({
        database,
        productIds,
        reservations,
        session,
      });

      if (
        createTourCountingSheetDigest(reservations)
        !== normalizedExpectedSheetDigest
      ) {
        throw new TourCountingValidationError({
          form: 'Les lignes ou les données historiques ont changé depuis le récapitulatif. Vérifiez-les puis confirmez à nouveau.',
        });
      }

      const calculationLines = reservations.map((reservation) => ({
        ...reservation,
        id: reservation._id.toString(),
      }));
      const summary = calculateTourCounting(
        calculationLines,
        returnedQuantities,
      );

      if (!summary.complete) {
        const invalidLine = summary.calculations.find(
          (calculation) => calculation.error,
        );

        throw new TourCountingValidationError({
          form: invalidLine?.error
            ?? (summary.missingPriceLineCount > 0
              ? 'Chaque ligne doit disposer d’un prix historique TTC valide.'
              : 'Chaque ligne chargée doit contenir un retour entier explicite.'),
        });
      }

      const countedAt = new Date();
      const countingId = new ObjectId();
      const unvaluedLines = buildStoredLines({
        calculations: summary.calculations,
        reservations,
      });
      const prepared = await prepareTourCountingStockValuations({
        database, session, tourId: tourObjectId, lines: unvaluedLines,
      });
      const storedLines = prepared.lines;
      const counting = {
        _id: countingId,
        confirmationKeys: [normalizedConfirmationKey],
        countedAt,
        countedBy: countedByObjectId,
        delivererId: tour.delivererId,
        lines: storedLines,
        requestDigest,
        sheetDigest: normalizedExpectedSheetDigest,
        totalDueInCentimes: summary.totalDueInCentimes,
        totalPurchaseCostInCentimes: prepared.totalPurchaseCostInCentimes,
        totalReturnedValueInCentimes: prepared.totalReturnedValueInCentimes,
        totalCostOfGoodsSoldInCentimes: prepared.totalCostOfGoodsSoldInCentimes,
        tourId: tourObjectId,
        tourReference: tour.reference,
      };

      await database.collection('tourCountings').insertOne(counting, {
        session,
      });

      const movements = storedLines
        .filter((line) => line.returnedQuantityInBaseUnits > 0)
        .map((line) => ({
          _id: new ObjectId(),
          baseUnit: line.baseUnit,
          kind: TOUR_RETURN_INPUT_KIND,
          occurredOn: countedAt,
          productId: line.productId,
          quantityDeltaInBaseUnits: line.returnedQuantityInBaseUnits,
          recordedAt: countedAt,
          recordedBy: countedByObjectId,
          sourceTourCountingId: countingId,
          sourceTourId: tourObjectId,
          sourceTourReservationId: line.sourceTourReservationId,
          tourReference: tour.reference,
        }));

      await applyTourCountingStockValuations({ database, session, prepared, movements });

      if (movements.length > 0) {
        await database.collection('stockMovements').insertMany(movements, {
          session,
        });
      }

      const tourTransition = await database.collection('tours').updateOne(
        { _id: tourObjectId, status: TOUR_STATUS_LOADED },
        {
          $set: {
            countedAt,
            countedBy: countedByObjectId,
            countingId,
            status: TOUR_STATUS_COUNTED,
          },
        },
        { session },
      );

      if (tourTransition.modifiedCount !== 1) {
        throw new TourCountingValidationError({
          form: 'La tournée a changé pendant le comptage.',
        });
      }

      return serializeConfirmationResult(counting, false);
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof TourCountingValidationError || error instanceof RangeError) {
      return { errors: error.errors ?? { form: error.message } };
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
