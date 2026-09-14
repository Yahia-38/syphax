import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import {
  coordinateCashDeliverer,
  coordinateCashTour,
} from './cash-payment-coordination.js';
import {
  CASH_READ_PERMISSION,
  readStoredTourPaymentResolution,
} from './cash-payments.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import {
  TOUR_EXPENSE_DECLARATION_STATUS_HISTORICAL_MISSING,
  TOUR_EXPENSE_DECLARATION_STATUS_MISSING,
  readStoredTourExpenseResolution,
} from './tour-expense-records.js';
import {
  TOUR_STATUS_CLOSED,
  TOUR_STATUS_COUNTED,
} from './tours.js';

export const TOUR_CLOSE_PERMISSION = 'tours.close';
export const TOUR_CLOSE_PERMISSIONS = Object.freeze([
  TOUR_CLOSE_PERMISSION,
  'tours.read',
  CASH_READ_PERMISSION,
]);

const DIGEST_PATTERN = /^[\da-f]{64}$/iu;

class TourClosureValidationError extends Error {
  constructor(errors, { stale = false } = {}) {
    super('La clôture de la tournée est invalide.');
    this.name = 'TourClosureValidationError';
    this.errors = errors;
    this.stale = stale;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const createTourClosureDigest = ({
  counting,
  expenseResolution,
  resolvedPayments,
}) => createHash('sha256')
  .update(JSON.stringify({
    counting: {
      id: counting._id.toString(),
      totalDueInCentimes: counting.totalDueInCentimes,
    },
    expenseDeclaration: expenseResolution.declaration
      ? {
          id: expenseResolution.declaration._id.toString(),
          totalInCentimes: expenseResolution.totalExpensesInCentimes,
        }
      : null,
    payments: resolvedPayments
      .map(({ allocation, payment }) => ({
        amountInCentimes: allocation.allocatedAmountInCentimes,
        currency: payment.currency,
        id: payment._id.toString(),
        sourceTourCountingId:
          allocation.sourceTourCountingId.toString(),
      }))
      .sort((firstPayment, secondPayment) =>
        firstPayment.id.localeCompare(secondPayment.id, 'en')),
  }))
  .digest('hex');

const readTourClosureSummary = async ({ database, session, tour }) => {
  if (!(tour.countingId instanceof ObjectId)) {
    throw new TourClosureValidationError({
      form: 'Le comptage définitif de cette tournée est introuvable.',
    });
  }

  const counting = await database.collection('tourCountings').findOne(
    { _id: tour.countingId, tourId: tour._id },
    { projection: { totalDueInCentimes: 1 }, session },
  );

  if (
    !counting
    || !Number.isSafeInteger(counting.totalDueInCentimes)
    || counting.totalDueInCentimes < 0
  ) {
    throw new TourClosureValidationError({
      form: 'Le comptage définitif de cette tournée est introuvable ou invalide.',
    });
  }

  const [resolvedPayments, expenseResolution] = await Promise.all([
    readStoredTourPaymentResolution({
      database,
      delivererId: tour.delivererId,
      session,
      sourceTourCountingId: counting._id,
      tourId: tour._id,
    }),
    readStoredTourExpenseResolution({
      database,
      session,
      sourceTourCountingId: counting._id,
      tourId: tour._id,
    }),
  ]);
  const amountPaidInCentimes = resolvedPayments?.amountInCentimes ?? null;
  const totalExpensesInCentimes =
    expenseResolution?.totalExpensesInCentimes ?? null;
  const netDueInCentimes = totalExpensesInCentimes === null
    ? null
    : counting.totalDueInCentimes - totalExpensesInCentimes;

  if (
    !expenseResolution
    || amountPaidInCentimes === null
    || !Number.isSafeInteger(netDueInCentimes)
    || netDueInCentimes < 0
    || amountPaidInCentimes > netDueInCentimes
  ) {
    throw new TourClosureValidationError({
      form: 'Les versements enregistrés de cette tournée sont incohérents.',
    });
  }

  if (
    tour.status === TOUR_STATUS_COUNTED
    && !expenseResolution.declaration
  ) {
    throw new TourClosureValidationError({
      form: 'Enregistrez une déclaration de frais, y compris « Aucun frais », avant de terminer la tournée.',
    });
  }

  return {
    amountDueInCentimes: netDueInCentimes,
    amountPaidInCentimes,
    expenseDeclarationStatus: expenseResolution.declaration
      ? expenseResolution.status
      : tour.status === TOUR_STATUS_CLOSED
        ? TOUR_EXPENSE_DECLARATION_STATUS_HISTORICAL_MISSING
        : TOUR_EXPENSE_DECLARATION_STATUS_MISSING,
    grossSalesInCentimes: counting.totalDueInCentimes,
    digest: createTourClosureDigest({
      counting,
      expenseResolution,
      resolvedPayments: resolvedPayments.payments,
    }),
    netDueInCentimes,
    remainingDueInCentimes:
      netDueInCentimes - amountPaidInCentimes,
    totalExpensesInCentimes,
  };
};

const serializeClosure = ({ summary, tour }) => ({
  ...summary,
  closedAt: tour.closedAt?.toISOString?.() ?? null,
  closedBy: tour.closedBy?.toString?.() ?? null,
  delivererId: tour.delivererId?.toString?.() ?? '',
  status: tour.status,
  tourId: tour._id.toString(),
});

export const getTourClosurePreview = async ({ tourId, userId }) => {
  for (const permission of TOUR_CLOSE_PERMISSIONS) {
    await requireUserPermission(userId, permission);
  }

  if (typeof tourId !== 'string' || !ObjectId.isValid(tourId)) {
    return null;
  }

  const database = await getDatabase();
  const tour = await database.collection('tours').findOne(
    { _id: new ObjectId(tourId), status: TOUR_STATUS_COUNTED },
    {
      projection: {
        countingId: 1,
        delivererCode: 1,
        delivererId: 1,
        delivererName: 1,
        reference: 1,
        status: 1,
      },
    },
  );

  if (!tour || !(tour.delivererId instanceof ObjectId)) {
    return null;
  }

  try {
    const summary = await readTourClosureSummary({ database, tour });

    return {
      ...summary,
      deliverer: {
        code: tour.delivererCode ?? 'Livreur inconnu',
        id: tour.delivererId.toString(),
        name: tour.delivererName ?? '',
      },
      errors: {},
      tourId,
      tourReference: tour.reference ?? null,
    };
  } catch (error) {
    if (error instanceof TourClosureValidationError) {
      return { errors: error.errors, tourId };
    }

    throw error;
  }
};

export const closeCountedTour = async ({ closedBy, expectedDigest, tourId }) => {
  const normalizedClosedBy = normalizeText(closedBy);
  const normalizedDigest = normalizeText(expectedDigest).toLocaleLowerCase('en');
  const normalizedTourId = normalizeText(tourId);

  if (!ObjectId.isValid(normalizedClosedBy)) {
    return { errors: { form: 'L’auteur de la clôture est invalide.' } };
  }

  if (!ObjectId.isValid(normalizedTourId)) {
    return { errors: { form: 'Cette tournée n’existe plus.' } };
  }

  if (!DIGEST_PATTERN.test(normalizedDigest)) {
    return {
      errors: {
        form: 'Le récapitulatif de clôture est invalide. Rechargez la fiche.',
      },
    };
  }

  const client = await getMongoClient();
  const database = client.db();
  const closedByObjectId = new ObjectId(normalizedClosedBy);
  const tourObjectId = new ObjectId(normalizedTourId);
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      for (const permission of TOUR_CLOSE_PERMISSIONS) {
        await requireUserPermission(normalizedClosedBy, permission, {
          database,
          session,
        });
      }

      const preliminaryTour = await database.collection('tours').findOne(
        { _id: tourObjectId },
        {
          projection: { delivererId: 1 },
          session,
        },
      );

      if (!preliminaryTour) {
        throw new TourClosureValidationError({
          form: 'Cette tournée n’existe plus.',
        });
      }

      if (!(preliminaryTour.delivererId instanceof ObjectId)) {
        throw new TourClosureValidationError({
          form: 'Le livreur historique de cette tournée est introuvable.',
        });
      }

      const deliverer = await coordinateCashDeliverer({
        database,
        delivererId: preliminaryTour.delivererId,
        session,
      });

      if (!deliverer) {
        throw new TourClosureValidationError({
          form: 'Le livreur historique de cette tournée est introuvable.',
        });
      }

      const tour = await coordinateCashTour({
        database,
        filter: { delivererId: preliminaryTour.delivererId },
        projection: {
          closedAt: 1,
          closedBy: 1,
          countingId: 1,
          delivererId: 1,
          status: 1,
        },
        session,
        tourId: tourObjectId,
      });

      if (!tour) {
        throw new TourClosureValidationError({
          form: 'Cette tournée a changé pendant la clôture.',
        });
      }

      if (tour.status === TOUR_STATUS_CLOSED) {
        if (
          !(tour.closedAt instanceof Date)
          || !(tour.closedBy instanceof ObjectId)
        ) {
          throw new TourClosureValidationError({
            form: 'Les informations de clôture de cette tournée sont incohérentes.',
          });
        }

        const summary = await readTourClosureSummary({
          database,
          session,
          tour,
        });

        return {
          closure: serializeClosure({ summary, tour }),
          replayed: true,
        };
      }

      if (tour.status !== TOUR_STATUS_COUNTED) {
        throw new TourClosureValidationError({
          form: 'Seule une tournée comptée peut être terminée.',
        });
      }

      const summary = await readTourClosureSummary({
        database,
        session,
        tour,
      });

      if (summary.digest !== normalizedDigest) {
        throw new TourClosureValidationError({
          form: 'Les montants ont changé. Vérifiez le récapitulatif actualisé avant de confirmer à nouveau.',
        }, { stale: true });
      }

      const closedAt = new Date();
      const result = await database.collection('tours').updateOne(
        { _id: tourObjectId, status: TOUR_STATUS_COUNTED },
        {
          $set: {
            closedAt,
            closedBy: closedByObjectId,
            status: TOUR_STATUS_CLOSED,
          },
        },
        { session },
      );

      if (result.modifiedCount !== 1) {
        throw new Error('La transition de clôture n’a pas été enregistrée.');
      }

      return {
        closure: serializeClosure({
          summary,
          tour: {
            ...tour,
            closedAt,
            closedBy: closedByObjectId,
            status: TOUR_STATUS_CLOSED,
          },
        }),
        replayed: false,
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof TourClosureValidationError) {
      return { errors: error.errors, stale: error.stale };
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
