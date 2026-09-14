import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getMongoClient } from './mongodb.js';
import {
  ACTIVE_RESERVATION_STATUS,
  TOUR_LOADING_OUTPUT_KIND,
  ensureStockMovementIndexes,
  getEmptyProductStockSummary,
  getProductStockSummaries,
} from './stock-movements.js';
import {
  LOADED_RESERVATION_STATUS,
  ensureTourReservationIndexes,
} from './tour-reservations.js';
import {
  TOUR_STATUS_LOADED,
  TOUR_STATUS_PREPARATION,
} from './tours.js';

const LOADING_DIGEST_PATTERN = /^[\da-f]{64}$/u;

class TourLoadingValidationError extends Error {
  constructor(errors) {
    super('Le chargement de la tournée est invalide.');
    this.name = 'TourLoadingValidationError';
    this.errors = errors;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const serializeLoadingLines = (lines) => (Array.isArray(lines) ? lines : [])
  .map((line) => ({
    baseUnit: line.baseUnit,
    id: line.id ?? line._id?.toString?.(),
    productId: line.productId?.toString?.() ?? line.productId,
    quantityInBaseUnits: line.quantityInBaseUnits,
    status: line.status,
  }))
  .sort((firstLine, secondLine) => firstLine.id.localeCompare(secondLine.id));

export const createTourLoadingDigest = (lines) => createHash('sha256')
  .update(JSON.stringify(serializeLoadingLines(lines)))
  .digest('hex');

const getLoadedProductIds = async ({ database, session, tourId }) => {
  const reservations = await database.collection('tourReservations').find(
    { status: LOADED_RESERVATION_STATUS, tourId },
    { projection: { productId: 1 }, session },
  ).toArray();

  return [...new Set(
    reservations
      .map((reservation) => reservation.productId?.toString?.())
      .filter(Boolean),
  )];
};

const validateLoadingLines = (reservations) => {
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
      throw new TourLoadingValidationError({
        form: 'Une ligne de réservation contient une référence ou une quantité invalide.',
      });
    }
  }
};

const readActiveReservations = async ({ database, session, tourId }) =>
  database.collection('tourReservations').find(
    { status: ACTIVE_RESERVATION_STATUS, tourId },
    {
      projection: {
        baseUnit: 1,
        productCode: 1,
        productDesignation: 1,
        productId: 1,
        quantityInBaseUnits: 1,
        status: 1,
      },
      session,
    },
  ).sort({ _id: 1 }).toArray();

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
      throw new TourLoadingValidationError({
        form: 'Un produit réservé n’existe plus.',
      });
    }

    productsById.set(product._id.toString(), product);
  }

  for (const reservation of reservations) {
    const product = productsById.get(reservation.productId.toString());

    if (!product || product.baseUnit !== reservation.baseUnit) {
      throw new TourLoadingValidationError({
        form: 'L’unité de base d’un produit réservé est incohérente.',
      });
    }
  }
};

const assertPhysicalStockCoversReservations = async ({
  database,
  productIds,
  session,
}) => {
  const activeReservations = await database.collection('tourReservations').find(
    {
      productId: { $in: productIds },
      status: ACTIVE_RESERVATION_STATUS,
    },
    { projection: { productId: 1, quantityInBaseUnits: 1 }, session },
  ).toArray();
  const reservedByProduct = new Map(productIds.map((productId) => [
    productId.toString(),
    0,
  ]));

  for (const reservation of activeReservations) {
    if (
      !(reservation.productId instanceof ObjectId)
      || !Number.isSafeInteger(reservation.quantityInBaseUnits)
      || reservation.quantityInBaseUnits <= 0
    ) {
      throw new TourLoadingValidationError({
        form: 'Une réservation active contient une référence ou une quantité invalide.',
      });
    }

    const productId = reservation.productId.toString();
    const total = reservedByProduct.get(productId);

    if (!Number.isSafeInteger(total + reservation.quantityInBaseUnits)) {
      throw new TourLoadingValidationError({
        form: 'Le total réservé dépasse la quantité maximale autorisée.',
      });
    }

    reservedByProduct.set(productId, total + reservation.quantityInBaseUnits);
  }

  const stockSummaries = await getProductStockSummaries(productIds, {
    database,
    session,
  });

  for (const productId of productIds) {
    const normalizedProductId = productId.toString();
    const stock = stockSummaries.get(normalizedProductId)
      ?? getEmptyProductStockSummary();
    const reservedQuantity = reservedByProduct.get(normalizedProductId);

    if (
      !Number.isSafeInteger(stock.quantityInBaseUnits)
      || !Number.isSafeInteger(stock.reservedQuantityInBaseUnits)
      || stock.reservedQuantityInBaseUnits !== reservedQuantity
      || stock.quantityInBaseUnits < reservedQuantity
    ) {
      throw new TourLoadingValidationError({
        form: 'Le stock physique ne couvre plus l’ensemble des réservations actives. Vérifiez le stock avant de confirmer.',
      });
    }
  }
};

export const confirmTourLoading = async ({
  expectedDigest,
  loadedBy,
  tourId,
}) => {
  const normalizedExpectedDigest = normalizeText(expectedDigest)
    .toLocaleLowerCase('en');
  const normalizedLoadedBy = normalizeText(loadedBy);
  const normalizedTourId = normalizeText(tourId);
  const errors = {};

  if (!LOADING_DIGEST_PATTERN.test(normalizedExpectedDigest)) {
    errors.form = 'Le récapitulatif de chargement est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedLoadedBy)) {
    errors.form = 'L’auteur du chargement est invalide.';
  }

  if (!ObjectId.isValid(normalizedTourId)) {
    errors.form = 'Cette tournée n’existe plus.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const loadedByObjectId = new ObjectId(normalizedLoadedBy);
  const tourObjectId = new ObjectId(normalizedTourId);

  await Promise.all([
    ensureStockMovementIndexes(database),
    ensureTourReservationIndexes(database),
  ]);

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      await requireUserPermission(normalizedLoadedBy, 'tours.load', {
        database,
        session,
      });

      const tour = await database.collection('tours').findOneAndUpdate(
        { _id: tourObjectId, status: TOUR_STATUS_PREPARATION },
        { $inc: { loadingReferenceVersion: 1 } },
        {
          projection: { delivererId: 1, reference: 1 },
          returnDocument: 'after',
          session,
        },
      );

      if (!tour) {
        const currentTour = await database.collection('tours').findOne(
          { _id: tourObjectId },
          {
            projection: {
              loadedAt: 1,
              loadedBy: 1,
              loadedReservationDigest: 1,
              status: 1,
            },
            session,
          },
        );

        if (
          currentTour?.status === TOUR_STATUS_LOADED
          && currentTour.loadedReservationDigest === normalizedExpectedDigest
        ) {
          return {
            loadedAt: currentTour.loadedAt?.toISOString?.() ?? null,
            loadedBy: currentTour.loadedBy?.toString?.() ?? null,
            productIds: await getLoadedProductIds({
              database,
              session,
              tourId: tourObjectId,
            }),
            replayed: true,
            tourId: normalizedTourId,
          };
        }

        throw new TourLoadingValidationError({
          form: currentTour
            ? 'Cette tournée n’est plus en préparation.'
            : 'Cette tournée n’existe plus.',
        });
      }

      if (!(tour.delivererId instanceof ObjectId)) {
        throw new TourLoadingValidationError({
          form: 'Le livreur de cette tournée est invalide.',
        });
      }

      const deliverer = await database.collection('deliverers').findOneAndUpdate(
        { _id: tour.delivererId, active: { $ne: false } },
        { $inc: { loadingReferenceVersion: 1 } },
        { projection: { _id: 1 }, returnDocument: 'after', session },
      );

      if (!deliverer) {
        throw new TourLoadingValidationError({
          form: 'Le livreur de cette tournée est désactivé ou n’existe plus.',
        });
      }

      const reservations = await readActiveReservations({
        database,
        session,
        tourId: tourObjectId,
      });

      if (reservations.length === 0) {
        throw new TourLoadingValidationError({
          form: 'Cette tournée ne contient aucune réservation active à charger.',
        });
      }

      validateLoadingLines(reservations);

      if (createTourLoadingDigest(reservations) !== normalizedExpectedDigest) {
        throw new TourLoadingValidationError({
          form: 'Les lignes ont changé depuis le récapitulatif. Vérifiez-les puis confirmez à nouveau.',
        });
      }

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
      await assertPhysicalStockCoversReservations({
        database,
        productIds,
        session,
      });

      const loadedAt = new Date();
      const movements = reservations.map((reservation) => ({
        _id: new ObjectId(),
        kind: TOUR_LOADING_OUTPUT_KIND,
        productId: reservation.productId,
        baseUnit: reservation.baseUnit,
        quantityDeltaInBaseUnits: -reservation.quantityInBaseUnits,
        occurredOn: loadedAt,
        recordedAt: loadedAt,
        recordedBy: loadedByObjectId,
        sourceTourId: tourObjectId,
        sourceTourReservationId: reservation._id,
        tourReference: tour.reference,
      }));

      await database.collection('stockMovements').insertMany(movements, {
        session,
      });

      const reservationTransition = await database
        .collection('tourReservations')
        .updateMany(
          {
            _id: { $in: reservations.map((reservation) => reservation._id) },
            status: ACTIVE_RESERVATION_STATUS,
            tourId: tourObjectId,
          },
          {
            $set: {
              loadedAt,
              loadedBy: loadedByObjectId,
              status: LOADED_RESERVATION_STATUS,
            },
          },
          { session },
        );

      if (reservationTransition.modifiedCount !== reservations.length) {
        throw new TourLoadingValidationError({
          form: 'Les réservations ont changé pendant le chargement.',
        });
      }

      const tourTransition = await database.collection('tours').updateOne(
        { _id: tourObjectId, status: TOUR_STATUS_PREPARATION },
        {
          $set: {
            loadedAt,
            loadedBy: loadedByObjectId,
            loadedReservationDigest: normalizedExpectedDigest,
            status: TOUR_STATUS_LOADED,
          },
        },
        { session },
      );

      if (tourTransition.modifiedCount !== 1) {
        throw new TourLoadingValidationError({
          form: 'La tournée a changé pendant le chargement.',
        });
      }

      return {
        loadedAt: loadedAt.toISOString(),
        loadedBy: normalizedLoadedBy,
        productIds: productIds.map((productId) => productId.toString()),
        replayed: false,
        tourId: normalizedTourId,
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof TourLoadingValidationError) {
      return { errors: error.errors };
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
