import { ObjectId } from 'mongodb';

const compareObjectIds = (firstId, secondId) =>
  firstId.toString().localeCompare(secondId.toString(), 'en');

export const coordinateCashDeliverer = async ({
  database,
  delivererId,
  projection = { active: 1, code: 1, name: 1 },
  session,
}) => {
  if (!(delivererId instanceof ObjectId)) {
    return null;
  }

  return database.collection('deliverers').findOneAndUpdate(
    { _id: delivererId },
    { $inc: { cashPaymentReferenceVersion: 1 } },
    { projection, returnDocument: 'after', session },
  );
};

export const coordinateCashTour = async ({
  database,
  filter = {},
  projection,
  session,
  tourId,
  versionField,
}) => {
  if (!(tourId instanceof ObjectId)) {
    return null;
  }

  return database.collection('tours').findOneAndUpdate(
    { _id: tourId, ...filter },
    {
      $inc: {
        cashPaymentReferenceVersion: 1,
        ...(versionField ? { [versionField]: 1 } : {}),
      },
    },
    { projection, returnDocument: 'after', session },
  );
};

export const coordinateCashTours = async ({
  database,
  filter = {},
  projection,
  session,
  tourIds,
}) => {
  const orderedTourIds = [...tourIds].sort(compareObjectIds);
  const tours = [];

  for (const tourId of orderedTourIds) {
    const tour = await coordinateCashTour({
      database,
      filter,
      projection,
      session,
      tourId,
    });

    if (!tour) {
      return null;
    }

    tours.push(tour);
  }

  return tours;
};

export const coordinateCashRegister = async ({
  database,
  filter = {},
  projection = { code: 1, currency: 1, name: 1 },
  cashRegisterId,
  session,
}) => {
  if (!(cashRegisterId instanceof ObjectId)) {
    return null;
  }

  return database.collection('cashRegisters').findOneAndUpdate(
    { _id: cashRegisterId, ...filter },
    { $inc: { paymentReferenceVersion: 1 } },
    { projection, returnDocument: 'after', session },
  );
};
