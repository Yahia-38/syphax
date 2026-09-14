import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import {
  CASH_READ_PERMISSION,
  readStoredTourPaymentResolution,
} from './cash-payments.js';
import { getDatabase } from './mongodb.js';
import { TOUR_STATUS_COUNTED } from './tours.js';

export const TOUR_EXPENSE_READ_PERMISSION = 'tours.expenses.read';
export const TOUR_EXPENSE_DECLARE_PERMISSION = 'tours.expenses.declare';
export const TOUR_EXPENSE_PREVIEW_PERMISSIONS = Object.freeze([
  TOUR_EXPENSE_READ_PERMISSION,
  'tours.read',
  CASH_READ_PERMISSION,
]);
export const TOUR_EXPENSE_FORM_PERMISSIONS = Object.freeze([
  ...TOUR_EXPENSE_PREVIEW_PERMISSIONS,
  TOUR_EXPENSE_DECLARE_PERMISSION,
]);

export const getTourExpensePreview = async ({ tourId, userId } = {}) => {
  for (const permission of TOUR_EXPENSE_PREVIEW_PERMISSIONS) {
    await requireUserPermission(userId, permission);
  }

  if (typeof tourId !== 'string' || !ObjectId.isValid(tourId)) {
    return null;
  }

  const database = await getDatabase();
  const tourObjectId = new ObjectId(tourId);
  const tour = await database.collection('tours').findOne(
    { _id: tourObjectId, status: TOUR_STATUS_COUNTED },
    {
      projection: {
        countingId: 1,
        delivererCode: 1,
        delivererId: 1,
        delivererName: 1,
        reference: 1,
      },
    },
  );

  if (
    !tour
    || !(tour.countingId instanceof ObjectId)
    || !(tour.delivererId instanceof ObjectId)
  ) {
    return null;
  }

  const counting = await database.collection('tourCountings').findOne(
    { _id: tour.countingId, tourId: tourObjectId },
    { projection: { totalDueInCentimes: 1 } },
  );

  if (
    !counting
    || !Number.isSafeInteger(counting.totalDueInCentimes)
    || counting.totalDueInCentimes < 0
  ) {
    return {
      errors: {
        form: 'Le comptage définitif de cette tournée est introuvable ou invalide.',
      },
      tourId,
    };
  }

  const resolvedPayments = await readStoredTourPaymentResolution({
    database,
    delivererId: tour.delivererId,
    sourceTourCountingId: counting._id,
    tourId: tourObjectId,
  });
  const totalPaidInCentimes = resolvedPayments?.amountInCentimes ?? null;

  if (
    totalPaidInCentimes === null
    || totalPaidInCentimes > counting.totalDueInCentimes
  ) {
    return {
      errors: {
        form: 'Les versements enregistrés de cette tournée sont incohérents.',
      },
      tourId,
    };
  }

  return {
    deliverer: {
      code: tour.delivererCode ?? 'Livreur inconnu',
      id: tour.delivererId.toString(),
      name: tour.delivererName ?? '',
    },
    errors: {},
    grossSalesInCentimes: counting.totalDueInCentimes,
    totalPaidInCentimes,
    tourId,
    tourReference: tour.reference ?? 'Référence indisponible',
  };
};
