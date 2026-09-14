import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import {
  CASH_READ_PERMISSION,
  readDelivererCashSummary,
} from './cash-payments.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import { parseReceptionAmountInCentimes } from './receptions.js';
import { calculateLoadedLineValue } from './tour-counting-calculations.js';
import { LOADED_RESERVATION_STATUS } from './tour-reservations.js';
import { TOUR_STATUS_LOADED } from './tours.js';

export const DELIVERER_CREDIT_LIMIT_READ_PERMISSION =
  'deliverers.credit-limit.read';
export const DELIVERER_CREDIT_LIMIT_UPDATE_PERMISSION =
  'deliverers.credit-limit.update';
export const DELIVERER_CREDIT_EXPOSURE_READ_PERMISSIONS = Object.freeze([
  DELIVERER_CREDIT_LIMIT_READ_PERMISSION,
  CASH_READ_PERMISSION,
  'pricing.read',
]);

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const serializeCreditLimit = (creditLimit, username) => {
  if (
    !creditLimit
    || !Number.isSafeInteger(creditLimit.amountInCentimes)
    || creditLimit.amountInCentimes < 0
    || !Number.isSafeInteger(creditLimit.version)
    || creditLimit.version < 1
  ) {
    return {
      amountInCentimes: null,
      configured: false,
      updatedAt: null,
      updatedBy: null,
      version: 0,
    };
  }

  return {
    amountInCentimes: creditLimit.amountInCentimes,
    configured: true,
    updatedAt: creditLimit.updatedAt?.toISOString?.() ?? null,
    updatedBy: username ?? null,
    version: creditLimit.version,
  };
};

const readDelivererCreditLimit = async ({
  database,
  delivererId,
  session,
}) => {
  const deliverer = await database.collection('deliverers').findOne(
    { _id: delivererId },
    { projection: { creditLimit: 1 }, session },
  );

  if (!deliverer) {
    return { notFound: true };
  }

  const updatedBy = deliverer.creditLimit?.updatedBy;
  const author = updatedBy instanceof ObjectId
    ? await database.collection('users').findOne(
        { _id: updatedBy },
        { projection: { username: 1 }, session },
      )
    : null;

  return {
    creditLimit: serializeCreditLimit(
      deliverer.creditLimit,
      author?.username,
    ),
  };
};

const createLoadedValueAnomaly = ({ code, label, tour }) => ({
  code,
  label,
  tourReference: typeof tour.reference === 'string' && tour.reference
    ? tour.reference
    : 'Référence indisponible',
});

const readDelivererLoadedValue = async ({
  database,
  delivererId,
  session,
}) => {
  const tours = await database.collection('tours').find(
    { delivererId, status: TOUR_STATUS_LOADED },
    { projection: { reference: 1 }, session },
  ).sort({ _id: 1 }).toArray();

  if (tours.length === 0) {
    return {
      anomalies: [],
      loadedTourCount: 0,
      reliable: true,
      valueInCentimes: 0,
    };
  }

  const tourIds = tours.map((tour) => tour._id);
  const reservations = await database.collection('tourReservations').find(
    {
      status: LOADED_RESERVATION_STATUS,
      tourId: { $in: tourIds },
    },
    {
      projection: {
        baseUnit: 1,
        quantityInBaseUnits: 1,
        salePriceAtLoading: 1,
        tourId: 1,
      },
      session,
    },
  ).sort({ _id: 1 }).toArray();
  const reservationsByTourId = new Map(tours.map((tour) => [
    tour._id.toString(),
    [],
  ]));

  for (const reservation of reservations) {
    const lines = reservationsByTourId.get(reservation.tourId?.toString?.());

    if (lines) {
      lines.push(reservation);
    }
  }

  const anomalies = [];
  let valueInCentimes = 0;

  for (const tour of tours) {
    const lines = reservationsByTourId.get(tour._id.toString());

    if (lines.length === 0) {
      anomalies.push(createLoadedValueAnomaly({
        code: 'MISSING_LOADED_LINES',
        label: 'lignes chargées historiques introuvables',
        tour,
      }));
      continue;
    }

    for (const line of lines) {
      const calculation = calculateLoadedLineValue(line);

      if (!calculation.priceAvailable) {
        anomalies.push(createLoadedValueAnomaly({
          code: line.salePriceAtLoading
            ? 'INVALID_HISTORICAL_PRICE'
            : 'MISSING_HISTORICAL_PRICE',
          label: line.salePriceAtLoading
            ? 'prix de vente historique au chargement invalide'
            : 'prix de vente historique au chargement absent',
          tour,
        }));
        continue;
      }

      if (calculation.error) {
        anomalies.push(createLoadedValueAnomaly({
          code: Number.isSafeInteger(line.quantityInBaseUnits)
            && line.quantityInBaseUnits > 0
            ? 'INVALID_LOADED_VALUE'
            : 'INVALID_LOADED_QUANTITY',
          label: calculation.error.toLocaleLowerCase('fr'),
          tour,
        }));
        continue;
      }

      valueInCentimes += calculation.valueInCentimes;

      if (!Number.isSafeInteger(valueInCentimes)) {
        anomalies.push(createLoadedValueAnomaly({
          code: 'INVALID_LOADED_TOTAL',
          label: 'valeur chargée totale trop élevée',
          tour,
        }));
        valueInCentimes = null;
        break;
      }
    }

    if (valueInCentimes === null) {
      break;
    }
  }

  return {
    anomalies,
    loadedTourCount: tours.length,
    reliable: anomalies.length === 0,
    valueInCentimes: anomalies.length === 0 ? valueInCentimes : null,
  };
};

export const compareDelivererCreditExposure = ({
  engagementInCentimes,
  limitInCentimes,
}) => {
  if (
    !Number.isSafeInteger(engagementInCentimes)
    || engagementInCentimes < 0
    || !Number.isSafeInteger(limitInCentimes)
    || limitInCentimes < 0
  ) {
    return null;
  }

  if (engagementInCentimes > limitInCentimes) {
    return {
      amountInCentimes: engagementInCentimes - limitInCentimes,
      status: 'EXCEEDED',
    };
  }

  if (engagementInCentimes === limitInCentimes) {
    return { amountInCentimes: 0, status: 'REACHED' };
  }

  return {
    amountInCentimes: limitInCentimes - engagementInCentimes,
    status: 'BELOW',
  };
};

export const validateDelivererCreditLimit = (amount) => {
  const normalizedAmount = normalizeText(amount);
  const amountInCentimes = parseReceptionAmountInCentimes(normalizedAmount);

  if (!normalizedAmount) {
    return {
      errors: { amount: 'La limite de crédit est obligatoire.' },
    };
  }

  if (amountInCentimes === null) {
    return {
      errors: {
        amount: 'Saisissez un montant positif ou nul avec deux décimales maximum.',
      },
    };
  }

  return { data: { amountInCentimes } };
};

export const getDelivererCreditLimit = async ({ delivererId, userId }) => {
  await requireUserPermission(
    userId,
    DELIVERER_CREDIT_LIMIT_READ_PERMISSION,
  );

  if (typeof delivererId !== 'string' || !ObjectId.isValid(delivererId)) {
    return { notFound: true };
  }

  const database = await getDatabase();

  return readDelivererCreditLimit({
    database,
    delivererId: new ObjectId(delivererId),
  });
};

export const getDelivererCreditExposure = async ({ delivererId, userId }) => {
  const client = await getMongoClient();
  const database = client.db();
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      for (const permission of DELIVERER_CREDIT_EXPOSURE_READ_PERMISSIONS) {
        await requireUserPermission(userId, permission, { database, session });
      }

      if (typeof delivererId !== 'string' || !ObjectId.isValid(delivererId)) {
        return { notFound: true };
      }

      const delivererObjectId = new ObjectId(delivererId);
      const limitResult = await readDelivererCreditLimit({
        database,
        delivererId: delivererObjectId,
        session,
      });

      if (limitResult.notFound) {
        return limitResult;
      }

      const cashSummary = await readDelivererCashSummary({
        database,
        delivererId: delivererObjectId,
        session,
      });
      const loadedSummary = await readDelivererLoadedValue({
        database,
        delivererId: delivererObjectId,
        session,
      });
      const countedRemainderInCentimes = cashSummary.reliable
        ? cashSummary.remainingDueInCentimes ?? 0
        : null;
      const loadedValueInCentimes = loadedSummary.reliable
        ? loadedSummary.valueInCentimes
        : null;
      const engagementCandidate = countedRemainderInCentimes === null
        || loadedValueInCentimes === null
        ? null
        : countedRemainderInCentimes + loadedValueInCentimes;
      const engagementInCentimes = Number.isSafeInteger(engagementCandidate)
        ? engagementCandidate
        : null;
      const totalAnomalies = [
        ...cashSummary.anomalies.map((anomaly) => ({
          ...anomaly,
          source: 'CASH',
        })),
        ...loadedSummary.anomalies.map((anomaly) => ({
          ...anomaly,
          source: 'LOADED',
        })),
        ...(
          engagementCandidate !== null && engagementInCentimes === null
            ? [{
                code: 'INVALID_ENGAGEMENT_TOTAL',
                label: 'engagement total trop élevé',
                source: 'TOTAL',
                tourReference: 'Toutes les tournées',
              }]
            : []
        ),
      ];
      const reliable = cashSummary.reliable
        && loadedSummary.reliable
        && engagementInCentimes !== null;
      const comparison = limitResult.creditLimit.configured && reliable
        ? compareDelivererCreditExposure({
            engagementInCentimes,
            limitInCentimes: limitResult.creditLimit.amountInCentimes,
          })
        : null;

      return {
        cashSummary,
        creditLimit: limitResult.creditLimit,
        exposure: {
          anomalies: totalAnomalies,
          comparison,
          countedRemainderInCentimes,
          engagementInCentimes,
          loadedTourCount: loadedSummary.loadedTourCount,
          loadedValueInCentimes,
          reliable,
        },
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } finally {
    await session.endSession();
  }
};

export const updateDelivererCreditLimit = async ({
  amount,
  delivererId,
  expectedVersion,
  updatedBy,
}) => {
  await requireUserPermission(
    updatedBy,
    DELIVERER_CREDIT_LIMIT_UPDATE_PERMISSION,
  );

  if (typeof delivererId !== 'string' || !ObjectId.isValid(delivererId)) {
    return { notFound: true };
  }

  const validation = validateDelivererCreditLimit(amount);

  if (validation.errors) {
    return validation;
  }

  if (
    !Number.isSafeInteger(expectedVersion)
    || expectedVersion < 0
  ) {
    return {
      errors: {
        form: 'La version de la limite est invalide. Rechargez la fiche.',
      },
      stale: true,
    };
  }

  const database = await getDatabase();
  const deliverers = database.collection('deliverers');
  const delivererObjectId = new ObjectId(delivererId);
  const currentDeliverer = await deliverers.findOne(
    { _id: delivererObjectId },
    { projection: { creditLimit: 1 } },
  );

  if (!currentDeliverer) {
    return { notFound: true };
  }

  const currentCreditLimit = serializeCreditLimit(currentDeliverer.creditLimit);

  if (currentCreditLimit.version !== expectedVersion) {
    return {
      errors: {
        form: 'La limite de crédit a été modifiée depuis l’ouverture de la fiche. Vérifiez la valeur actualisée puis confirmez à nouveau.',
      },
      stale: true,
    };
  }

  const { amountInCentimes } = validation.data;

  if (
    currentCreditLimit.configured
    && currentCreditLimit.amountInCentimes === amountInCentimes
  ) {
    return {
      changed: false,
      creditLimit: currentCreditLimit,
    };
  }

  const changedAt = new Date();
  const changedBy = new ObjectId(updatedBy);
  const nextVersion = expectedVersion + 1;
  const versionFilter = expectedVersion === 0
    ? { creditLimit: { $exists: false } }
    : { 'creditLimit.version': expectedVersion };
  const result = await deliverers.updateOne(
    { _id: delivererObjectId, ...versionFilter },
    {
      $push: {
        creditLimitHistory: {
          changedAt,
          changedBy,
          newAmountInCentimes: amountInCentimes,
          previousAmountInCentimes: currentCreditLimit.configured
            ? currentCreditLimit.amountInCentimes
            : null,
        },
      },
      $set: {
        creditLimit: {
          amountInCentimes,
          updatedAt: changedAt,
          updatedBy: changedBy,
          version: nextVersion,
        },
      },
    },
  );

  if (result.matchedCount !== 1) {
    const stillExists = await deliverers.countDocuments(
      { _id: delivererObjectId },
      { limit: 1 },
    );

    if (stillExists === 0) {
      return { notFound: true };
    }

    return {
      errors: {
        form: 'La limite de crédit a été modifiée pendant l’enregistrement. Vérifiez la valeur actualisée puis confirmez à nouveau.',
      },
      stale: true,
    };
  }

  return {
    changed: true,
    creditLimit: {
      amountInCentimes,
      configured: true,
      updatedAt: changedAt.toISOString(),
      updatedBy,
      version: nextVersion,
    },
  };
};
