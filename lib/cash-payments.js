import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getDatabase } from './mongodb.js';
import { TOUR_STATUS_COUNTED } from './tours.js';

export const CASH_READ_PERMISSION = 'cash.read';
export const CASH_PAYMENT_CREATE_PERMISSION = 'cash.payments.create';

export const CASH_PAYMENT_FORM_PERMISSIONS = Object.freeze([
  CASH_READ_PERMISSION,
  CASH_PAYMENT_CREATE_PERMISSION,
]);

export const getTourPaymentPreview = async ({ tourId, userId }) => {
  await requireUserPermission(userId, CASH_READ_PERMISSION);

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
        delivererId: 1,
        reference: 1,
      },
    },
  );

  if (!tour || !(tour.countingId instanceof ObjectId)) {
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
    return null;
  }

  return {
    amountDueInCentimes: counting.totalDueInCentimes,
    amountPaidInCentimes: 0,
    delivererId: tour.delivererId?.toString?.() ?? null,
    paymentCount: 0,
    remainingDueInCentimes: counting.totalDueInCentimes,
    tourId: tourObjectId.toString(),
    tourReference: tour.reference ?? null,
  };
};
