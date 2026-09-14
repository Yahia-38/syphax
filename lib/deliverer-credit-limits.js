import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getDatabase } from './mongodb.js';
import { parseReceptionAmountInCentimes } from './receptions.js';

export const DELIVERER_CREDIT_LIMIT_READ_PERMISSION =
  'deliverers.credit-limit.read';
export const DELIVERER_CREDIT_LIMIT_UPDATE_PERMISSION =
  'deliverers.credit-limit.update';

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
  const deliverer = await database.collection('deliverers').findOne(
    { _id: new ObjectId(delivererId) },
    { projection: { creditLimit: 1 } },
  );

  if (!deliverer) {
    return { notFound: true };
  }

  const updatedBy = deliverer.creditLimit?.updatedBy;
  const author = updatedBy instanceof ObjectId
    ? await database.collection('users').findOne(
        { _id: updatedBy },
        { projection: { username: 1 } },
      )
    : null;

  return {
    creditLimit: serializeCreditLimit(
      deliverer.creditLimit,
      author?.username,
    ),
  };
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
