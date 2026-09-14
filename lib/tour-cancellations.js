import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import { ACTIVE_RESERVATION_STATUS } from './stock-movements.js';
import {
  RELEASED_RESERVATION_STATUS,
} from './tour-reservations.js';
import {
  TOUR_STATUS_CANCELLED,
  TOUR_STATUS_PREPARATION,
} from './tours.js';

export const TOUR_CANCEL_PERMISSION = 'tours.cancel';
export const TOUR_CANCELLATION_RELEASE_REASON = 'TOUR_CANCELLATION';

const CANCELLATION_DIGEST_PATTERN = /^[\da-f]{64}$/u;
const MAX_CANCELLATION_REASON_LENGTH = 500;

class TourCancellationValidationError extends Error {
  constructor(errors, { stale = false } = {}) {
    super('L’annulation de la tournée est invalide.');
    this.name = 'TourCancellationValidationError';
    this.errors = errors;
    this.stale = stale;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const serializeCancellationLines = (lines) =>
  (Array.isArray(lines) ? lines : [])
    .map((line) => ({
      baseUnit: line.baseUnit,
      id: line.id ?? line._id?.toString?.(),
      productCode: line.productCode,
      productDesignation: line.productDesignation,
      productId: line.productId?.toString?.() ?? line.productId,
      quantityInBaseUnits: line.quantityInBaseUnits,
      status: line.status,
    }))
    .sort((firstLine, secondLine) => firstLine.id.localeCompare(secondLine.id));

export const createTourCancellationDigest = (lines) => createHash('sha256')
  .update(JSON.stringify(serializeCancellationLines(lines)))
  .digest('hex');

const validateCancellationLines = (reservations) => {
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
      throw new TourCancellationValidationError({
        form: 'Une réservation active contient une référence ou une quantité invalide.',
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

const serializeCancellationLine = (line) => ({
  baseUnit: line.baseUnit,
  id: line._id.toString(),
  productCode: line.productCode,
  productDesignation: line.productDesignation,
  productId: line.productId.toString(),
  quantityInBaseUnits: line.quantityInBaseUnits,
  status: line.status,
});

export const getTourCancellationPreview = async ({ tourId, userId }) => {
  await requireUserPermission(userId, TOUR_CANCEL_PERMISSION);
  await requireUserPermission(userId, 'tours.read');

  if (typeof tourId !== 'string' || !ObjectId.isValid(tourId)) {
    return { errors: { form: 'Cette tournée n’existe plus.' }, lines: [] };
  }

  const database = await getDatabase();
  const tourObjectId = new ObjectId(tourId);
  const tour = await database.collection('tours').findOne(
    { _id: tourObjectId },
    {
      projection: {
        delivererCode: 1,
        delivererName: 1,
        reference: 1,
        status: 1,
      },
    },
  );

  if (!tour) {
    return { errors: { form: 'Cette tournée n’existe plus.' }, lines: [] };
  }

  if (tour.status !== TOUR_STATUS_PREPARATION) {
    return {
      errors: { form: 'Seule une tournée en préparation peut être annulée.' },
      lines: [],
    };
  }

  const reservations = await readActiveReservations({
    database,
    tourId: tourObjectId,
  });

  try {
    validateCancellationLines(reservations);

    return {
      deliverer: {
        code: tour.delivererCode ?? 'Livreur inconnu',
        name: tour.delivererName ?? '',
      },
      digest: createTourCancellationDigest(reservations),
      errors: {},
      lines: reservations.map(serializeCancellationLine),
      tourReference: tour.reference ?? 'Référence indisponible',
    };
  } catch (error) {
    if (error instanceof TourCancellationValidationError) {
      return { errors: error.errors, lines: [] };
    }

    throw error;
  }
};

const getCancelledProductIds = async ({ database, session, tourId }) => {
  const reservations = await database.collection('tourReservations').find(
    {
      releaseReasonCode: TOUR_CANCELLATION_RELEASE_REASON,
      status: RELEASED_RESERVATION_STATUS,
      tourId,
    },
    { projection: { productId: 1 }, session },
  ).toArray();

  return [...new Set(
    reservations
      .map((reservation) => reservation.productId?.toString?.())
      .filter(Boolean),
  )].sort();
};

const serializeCancellation = async ({ database, session, tour }) => ({
  cancelledAt: tour.cancelledAt?.toISOString?.() ?? null,
  cancelledBy: tour.cancelledBy?.toString?.() ?? null,
  delivererId: tour.delivererId?.toString?.() ?? '',
  digest: tour.cancellationReservationDigest,
  productIds: await getCancelledProductIds({
    database,
    session,
    tourId: tour._id,
  }),
  reason: tour.cancellationReason,
  tourId: tour._id.toString(),
});

const lockProducts = async ({ database, productIds, session }) => {
  for (const productId of productIds) {
    const product = await database.collection('products').findOneAndUpdate(
      { _id: productId },
      { $inc: { stockReferenceVersion: 1 } },
      { projection: { _id: 1 }, returnDocument: 'after', session },
    );

    if (!product) {
      throw new TourCancellationValidationError({
        form: 'Un produit réservé n’existe plus.',
      });
    }
  }
};

export const cancelTour = async ({
  cancelledBy,
  expectedDigest,
  reason,
  tourId,
} = {}) => {
  const normalizedCancelledBy = normalizeText(cancelledBy);
  const normalizedExpectedDigest = normalizeText(expectedDigest)
    .toLocaleLowerCase('en');
  const normalizedReason = normalizeText(reason);
  const normalizedTourId = normalizeText(tourId);
  const errors = {};

  if (!ObjectId.isValid(normalizedCancelledBy)) {
    errors.form = 'L’auteur de l’annulation est invalide.';
  }

  if (!CANCELLATION_DIGEST_PATTERN.test(normalizedExpectedDigest)) {
    errors.form = 'Le récapitulatif d’annulation est invalide. Rechargez la fiche.';
  }

  if (!normalizedReason) {
    errors.reason = 'Le motif d’annulation est obligatoire.';
  } else if (Array.from(normalizedReason).length > MAX_CANCELLATION_REASON_LENGTH) {
    errors.reason = `Le motif ne doit pas dépasser ${MAX_CANCELLATION_REASON_LENGTH} caractères.`;
  }

  if (!ObjectId.isValid(normalizedTourId)) {
    errors.form = 'Cette tournée n’existe plus.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const cancelledByObjectId = new ObjectId(normalizedCancelledBy);
  const tourObjectId = new ObjectId(normalizedTourId);

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      await requireUserPermission(
        normalizedCancelledBy,
        TOUR_CANCEL_PERMISSION,
        { database, session },
      );
      await requireUserPermission(normalizedCancelledBy, 'tours.read', {
        database,
        session,
      });

      const tour = await database.collection('tours').findOneAndUpdate(
        { _id: tourObjectId, status: TOUR_STATUS_PREPARATION },
        { $inc: { cancellationReferenceVersion: 1 } },
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
              cancellationReason: 1,
              cancellationReservationDigest: 1,
              cancelledAt: 1,
              cancelledBy: 1,
              delivererId: 1,
              status: 1,
            },
            session,
          },
        );

        if (
          currentTour?.status === TOUR_STATUS_CANCELLED
          && currentTour.cancellationReservationDigest
            === normalizedExpectedDigest
          && currentTour.cancellationReason === normalizedReason
        ) {
          return {
            cancellation: await serializeCancellation({
              database,
              session,
              tour: currentTour,
            }),
            replayed: true,
          };
        }

        throw new TourCancellationValidationError({
          form: currentTour?.status === TOUR_STATUS_CANCELLED
            ? 'Cette tournée a déjà été annulée avec une demande différente.'
            : currentTour
              ? 'Seule une tournée en préparation peut être annulée.'
              : 'Cette tournée n’existe plus.',
        });
      }

      if (!(tour.delivererId instanceof ObjectId)) {
        throw new TourCancellationValidationError({
          form: 'Le livreur de cette tournée est invalide.',
        });
      }

      const reservations = await readActiveReservations({
        database,
        session,
        tourId: tourObjectId,
      });

      validateCancellationLines(reservations);

      const productIds = [...new Map(
        reservations.map((reservation) => [
          reservation.productId.toString(),
          reservation.productId,
        ]),
      ).values()].sort((firstId, secondId) =>
        firstId.toString().localeCompare(secondId.toString()));

      await lockProducts({ database, productIds, session });

      if (createTourCancellationDigest(reservations) !== normalizedExpectedDigest) {
        throw new TourCancellationValidationError({
          form: 'Les réservations ont changé depuis le récapitulatif. Vérifiez-les puis confirmez à nouveau.',
        }, { stale: true });
      }

      const cancelledAt = new Date();

      if (reservations.length > 0) {
        const reservationTransition = await database
          .collection('tourReservations')
          .bulkWrite(
            reservations.map((reservation) => ({
              updateOne: {
                filter: {
                  _id: reservation._id,
                  status: ACTIVE_RESERVATION_STATUS,
                  tourId: tourObjectId,
                },
                update: {
                  $set: {
                    releaseReason: normalizedReason,
                    releaseReasonCode: TOUR_CANCELLATION_RELEASE_REASON,
                    releasedAt: cancelledAt,
                    releasedBy: cancelledByObjectId,
                    status: RELEASED_RESERVATION_STATUS,
                  },
                },
              },
            })),
            { session },
          );

        if (reservationTransition.modifiedCount !== reservations.length) {
          throw new TourCancellationValidationError({
            form: 'Les réservations ont changé pendant l’annulation.',
          }, { stale: true });
        }
      }

      const tourTransition = await database.collection('tours').updateOne(
        { _id: tourObjectId, status: TOUR_STATUS_PREPARATION },
        {
          $set: {
            cancellationReason: normalizedReason,
            cancellationReservationDigest: normalizedExpectedDigest,
            cancelledAt,
            cancelledBy: cancelledByObjectId,
            status: TOUR_STATUS_CANCELLED,
          },
        },
        { session },
      );

      if (tourTransition.modifiedCount !== 1) {
        throw new TourCancellationValidationError({
          form: 'La tournée a changé pendant l’annulation.',
        });
      }

      return {
        cancellation: {
          cancelledAt: cancelledAt.toISOString(),
          cancelledBy: normalizedCancelledBy,
          delivererId: tour.delivererId.toString(),
          digest: normalizedExpectedDigest,
          productIds: productIds.map((productId) => productId.toString()),
          reason: normalizedReason,
          tourId: normalizedTourId,
        },
        replayed: false,
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof TourCancellationValidationError) {
      return {
        errors: error.errors,
        stale: error.stale,
      };
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
