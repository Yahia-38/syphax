import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import {
  calculateCashPaymentPreview,
  parseCashPaymentAmountInCentimes,
} from './cash-payment-calculations.js';
import { CASH_CURRENCY } from './cash-registers.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import { TOUR_STATUS_COUNTED } from './tours.js';

export const CASH_READ_PERMISSION = 'cash.read';
export const CASH_PAYMENT_CREATE_PERMISSION = 'cash.payments.create';
export const CASH_PAYMENT_MODE = 'CASH';
export const CASH_PAYMENT_NOTE_MAX_LENGTH = 500;

export const CASH_PAYMENT_FORM_PERMISSIONS = Object.freeze([
  CASH_READ_PERMISSION,
  CASH_PAYMENT_CREATE_PERMISSION,
]);

export const CASH_PAYMENT_RECORD_PERMISSIONS = Object.freeze([
  CASH_READ_PERMISSION,
  CASH_PAYMENT_CREATE_PERMISSION,
  'tours.read',
]);

const CONFIRMATION_KEY_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

class CashPaymentValidationError extends Error {
  constructor(errors) {
    super('Le versement en espèces est invalide.');
    this.name = 'CashPaymentValidationError';
    this.errors = errors;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const createPaymentReference = (paymentId) =>
  `VRS-${paymentId.toHexString().toLocaleUpperCase('en')}`;

const createPaymentRequestDigest = ({
  amountInCentimes,
  cashRegisterId,
  note,
  receivedBy,
  tourId,
}) => createHash('sha256')
  .update(JSON.stringify({
    amountInCentimes,
    cashRegisterId,
    note,
    receivedBy,
    tourId,
  }))
  .digest('hex');

export const ensureCashPaymentIndexes = async (database) => {
  const cashPayments = database.collection('cashPayments');

  await Promise.all([
    cashPayments.createIndex(
      { confirmationKey: 1 },
      { name: 'unique_cash_payment_confirmation_key', unique: true },
    ),
    cashPayments.createIndex(
      { reference: 1 },
      { name: 'unique_cash_payment_reference', unique: true },
    ),
    cashPayments.createIndex(
      { tourId: 1, receivedAt: -1, _id: -1 },
      { name: 'cash_payment_tour_history' },
    ),
    cashPayments.createIndex(
      { cashRegisterId: 1, receivedAt: -1, _id: -1 },
      { name: 'cash_payment_register_journal' },
    ),
  ]);
};

const readActiveCashRegisters = async ({ database, session }) =>
  database.collection('cashRegisters').find(
    { active: true, currency: CASH_CURRENCY },
    {
      projection: {
        code: 1,
        currency: 1,
        name: 1,
      },
      session,
    },
  ).sort({ _id: 1 }).limit(2).toArray();

const selectUniqueActiveCashRegister = (cashRegisters) => {
  if (cashRegisters.length === 0) {
    return {
      cashRegister: null,
      error: 'Aucune caisse active en DZD n’est disponible.',
    };
  }

  if (cashRegisters.length > 1) {
    return {
      cashRegister: null,
      error: 'Plusieurs caisses actives en DZD sont disponibles ; aucune ne peut être choisie automatiquement.',
    };
  }

  const [cashRegister] = cashRegisters;

  if (
    typeof cashRegister.code !== 'string'
    || !cashRegister.code
    || typeof cashRegister.name !== 'string'
    || !cashRegister.name
  ) {
    return {
      cashRegister: null,
      error: 'La caisse active en DZD est incomplète.',
    };
  }

  return { cashRegister, error: null };
};

const calculateStoredPaymentTotal = (payments, sourceTourCountingId) => {
  let totalInCentimes = 0;

  for (const payment of payments) {
    if (
      !Number.isSafeInteger(payment.amountInCentimes)
      || payment.amountInCentimes <= 0
      || payment.currency !== CASH_CURRENCY
      || !(payment.sourceTourCountingId instanceof ObjectId)
      || !payment.sourceTourCountingId.equals(sourceTourCountingId)
    ) {
      return null;
    }

    totalInCentimes += payment.amountInCentimes;

    if (!Number.isSafeInteger(totalInCentimes)) {
      return null;
    }
  }

  return totalInCentimes;
};

const readStoredPayments = async ({ database, session, tourId }) =>
  database.collection('cashPayments').find(
    { tourId },
    {
      projection: {
        amountInCentimes: 1,
        cashRegisterCode: 1,
        cashRegisterId: 1,
        cashRegisterName: 1,
        currency: 1,
        mode: 1,
        note: 1,
        receivedAt: 1,
        receivedBy: 1,
        reference: 1,
        sourceTourCountingId: 1,
      },
      session,
    },
  ).sort({ receivedAt: -1, _id: -1 }).toArray();

const serializePayment = (payment, author = null) => ({
  amountInCentimes: payment.amountInCentimes,
  cashRegister: {
    code: payment.cashRegisterCode,
    id: payment.cashRegisterId?.toString?.() ?? '',
    name: payment.cashRegisterName,
  },
  currency: payment.currency,
  id: payment._id.toString(),
  mode: payment.mode,
  note: payment.note ?? '',
  receivedAt: payment.receivedAt?.toISOString?.() ?? null,
  receivedBy: author,
  reference: payment.reference,
});

const serializePaymentHistory = async ({ database, payments, session }) => {
  const authorIds = [...new Map(
    payments
      .map((payment) => payment.receivedBy)
      .filter((authorId) => authorId instanceof ObjectId)
      .map((authorId) => [authorId.toString(), authorId]),
  ).values()];
  const authors = authorIds.length > 0
    ? await database.collection('users').find(
        { _id: { $in: authorIds } },
        { projection: { username: 1 }, session },
      ).toArray()
    : [];
  const authorsById = new Map(authors.map((author) => [
    author._id.toString(),
    author.username,
  ]));

  return payments.map((payment) => serializePayment(
    payment,
    authorsById.get(payment.receivedBy?.toString()) ?? null,
  ));
};

const readTourAndCounting = async ({ database, session, tourId }) => {
  const tour = await database.collection('tours').findOne(
    { _id: tourId, status: TOUR_STATUS_COUNTED },
    {
      projection: {
        countingId: 1,
        delivererCode: 1,
        delivererId: 1,
        delivererName: 1,
        reference: 1,
      },
      session,
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
    { _id: tour.countingId, tourId },
    { projection: { totalDueInCentimes: 1 }, session },
  );

  if (
    !counting
    || !Number.isSafeInteger(counting.totalDueInCentimes)
    || counting.totalDueInCentimes < 0
  ) {
    return null;
  }

  return { counting, tour };
};

export const getTourPaymentPreview = async ({ tourId, userId }) => {
  for (const permission of [CASH_READ_PERMISSION, 'tours.read']) {
    await requireUserPermission(userId, permission);
  }

  if (typeof tourId !== 'string' || !ObjectId.isValid(tourId)) {
    return null;
  }

  const database = await getDatabase();
  const tourObjectId = new ObjectId(tourId);
  const tourAndCounting = await readTourAndCounting({
    database,
    tourId: tourObjectId,
  });

  if (!tourAndCounting) {
    return null;
  }

  const [cashRegisters, payments] = await Promise.all([
    readActiveCashRegisters({ database }),
    readStoredPayments({ database, tourId: tourObjectId }),
  ]);
  const cashRegisterSelection = selectUniqueActiveCashRegister(cashRegisters);
  const amountPaidInCentimes = calculateStoredPaymentTotal(
    payments,
    tourAndCounting.counting._id,
  );
  const amountDueInCentimes = tourAndCounting.counting.totalDueInCentimes;

  if (
    amountPaidInCentimes === null
    || amountPaidInCentimes > amountDueInCentimes
  ) {
    return {
      errors: {
        form: 'Les versements enregistrés de cette tournée sont incohérents.',
      },
      payments: [],
      tourId,
    };
  }

  const serializedPayments = await serializePaymentHistory({
    database,
    payments,
  });
  const { tour } = tourAndCounting;

  return {
    amountDueInCentimes,
    amountPaidInCentimes,
    cashRegister: cashRegisterSelection.cashRegister
      ? {
          code: cashRegisterSelection.cashRegister.code,
          id: cashRegisterSelection.cashRegister._id.toString(),
          name: cashRegisterSelection.cashRegister.name,
        }
      : null,
    deliverer: {
      code: tour.delivererCode ?? 'Livreur inconnu',
      id: tour.delivererId.toString(),
      name: tour.delivererName ?? '',
    },
    errors: cashRegisterSelection.error
      ? { cashRegister: cashRegisterSelection.error }
      : {},
    paymentCount: payments.length,
    payments: serializedPayments,
    remainingDueInCentimes: amountDueInCentimes - amountPaidInCentimes,
    tourId,
    tourReference: tour.reference ?? null,
  };
};

const readExistingPayment = async ({
  confirmationKey,
  database,
  requestDigest,
  session,
}) => {
  const payment = await database.collection('cashPayments').findOne(
    { confirmationKey },
    { session },
  );

  if (!payment) {
    return null;
  }

  if (payment.requestDigest !== requestDigest) {
    throw new CashPaymentValidationError({
      form: 'Cette demande a déjà été utilisée avec un contenu différent.',
    });
  }

  return {
    payment: serializePayment(payment),
    replayed: true,
  };
};

const throwCashRegisterSelectionError = async ({
  cashRegisters,
  database,
  expectedCashRegisterId,
  session,
}) => {
  if (cashRegisters.length === 0) {
    const expectedCashRegister = await database.collection('cashRegisters')
      .findOne({ _id: expectedCashRegisterId }, { session });

    throw new CashPaymentValidationError({
      form: expectedCashRegister
        ? 'La caisse du récapitulatif n’est plus active. Rechargez la fiche.'
        : 'Aucune caisse active en DZD n’est disponible.',
    });
  }

  if (cashRegisters.length > 1) {
    throw new CashPaymentValidationError({
      form: 'Plusieurs caisses actives en DZD sont disponibles ; aucune ne peut être choisie automatiquement.',
    });
  }

  throw new CashPaymentValidationError({
    form: 'La caisse du récapitulatif n’est plus disponible. Rechargez la fiche.',
  });
};

export const recordTourCashPayment = async ({
  amount,
  confirmationKey,
  expectedCashRegisterId,
  note,
  receivedBy,
  tourId,
}) => {
  const normalizedConfirmationKey = normalizeText(confirmationKey)
    .toLocaleLowerCase('en');
  const normalizedCashRegisterId = normalizeText(expectedCashRegisterId);
  const normalizedNote = normalizeText(note);
  const normalizedReceivedBy = normalizeText(receivedBy);
  const normalizedTourId = normalizeText(tourId);
  const amountInCentimes = parseCashPaymentAmountInCentimes(amount);
  const errors = {};

  if (!CONFIRMATION_KEY_PATTERN.test(normalizedConfirmationKey)) {
    errors.form = 'La clé de confirmation est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedCashRegisterId)) {
    errors.form = 'La caisse du récapitulatif est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedReceivedBy)) {
    errors.form = 'L’auteur du versement est invalide.';
  }

  if (!ObjectId.isValid(normalizedTourId)) {
    errors.form = 'Cette tournée n’existe plus.';
  }

  if (amountInCentimes === null) {
    errors.amount = 'Saisissez un montant strictement positif avec deux décimales maximum.';
  }

  if (normalizedNote.length > CASH_PAYMENT_NOTE_MAX_LENGTH) {
    errors.note = `La note ne peut pas dépasser ${CASH_PAYMENT_NOTE_MAX_LENGTH} caractères.`;
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const cashRegisterObjectId = new ObjectId(normalizedCashRegisterId);
  const receivedByObjectId = new ObjectId(normalizedReceivedBy);
  const tourObjectId = new ObjectId(normalizedTourId);
  const requestDigest = createPaymentRequestDigest({
    amountInCentimes,
    cashRegisterId: normalizedCashRegisterId,
    note: normalizedNote,
    receivedBy: normalizedReceivedBy,
    tourId: normalizedTourId,
  });
  const paymentId = new ObjectId();
  const receivedAt = new Date();

  await ensureCashPaymentIndexes(database);

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      for (const permission of CASH_PAYMENT_RECORD_PERMISSIONS) {
        await requireUserPermission(normalizedReceivedBy, permission, {
          database,
          session,
        });
      }

      const existingPayment = await readExistingPayment({
        confirmationKey: normalizedConfirmationKey,
        database,
        requestDigest,
        session,
      });

      if (existingPayment) {
        return existingPayment;
      }

      const tour = await database.collection('tours').findOneAndUpdate(
        { _id: tourObjectId, status: TOUR_STATUS_COUNTED },
        { $inc: { cashPaymentReferenceVersion: 1 } },
        {
          projection: {
            countingId: 1,
            delivererCode: 1,
            delivererId: 1,
            delivererName: 1,
            reference: 1,
          },
          returnDocument: 'after',
          session,
        },
      );

      if (
        !tour
        || !(tour.countingId instanceof ObjectId)
        || !(tour.delivererId instanceof ObjectId)
      ) {
        throw new CashPaymentValidationError({
          form: 'Cette tournée n’est pas comptée ou n’existe plus.',
        });
      }

      const activeCashRegisters = await readActiveCashRegisters({
        database,
        session,
      });

      if (
        activeCashRegisters.length !== 1
        || !activeCashRegisters[0]._id.equals(cashRegisterObjectId)
      ) {
        await throwCashRegisterSelectionError({
          cashRegisters: activeCashRegisters,
          database,
          expectedCashRegisterId: cashRegisterObjectId,
          session,
        });
      }

      const cashRegister = await database.collection('cashRegisters')
        .findOneAndUpdate(
          {
            _id: cashRegisterObjectId,
            active: true,
            currency: CASH_CURRENCY,
          },
          { $inc: { paymentReferenceVersion: 1 } },
          {
            projection: { code: 1, currency: 1, name: 1 },
            returnDocument: 'after',
            session,
          },
        );

      if (!cashRegister) {
        throw new CashPaymentValidationError({
          form: 'La caisse du récapitulatif n’est plus active. Rechargez la fiche.',
        });
      }

      const counting = await database.collection('tourCountings').findOne(
        { _id: tour.countingId, tourId: tourObjectId },
        { projection: { totalDueInCentimes: 1 }, session },
      );

      if (
        !counting
        || !Number.isSafeInteger(counting.totalDueInCentimes)
        || counting.totalDueInCentimes < 0
      ) {
        throw new CashPaymentValidationError({
          form: 'Le comptage définitif de cette tournée est introuvable ou invalide.',
        });
      }

      const previousPayments = await readStoredPayments({
        database,
        session,
        tourId: tourObjectId,
      });
      const amountPaidInCentimes = calculateStoredPaymentTotal(
        previousPayments,
        tour.countingId,
      );

      if (
        amountPaidInCentimes === null
        || amountPaidInCentimes > counting.totalDueInCentimes
      ) {
        throw new CashPaymentValidationError({
          form: 'Les versements enregistrés de cette tournée sont incohérents.',
        });
      }

      const remainingDueInCentimes =
        counting.totalDueInCentimes - amountPaidInCentimes;
      const calculation = calculateCashPaymentPreview({
        amount,
        remainingDueInCentimes,
      });

      if (calculation.error || calculation.amountInCentimes === null) {
        throw new CashPaymentValidationError({
          amount: calculation.error
            ?? 'Le montant reçu est invalide.',
        });
      }

      const payment = {
        _id: paymentId,
        amountInCentimes: calculation.amountInCentimes,
        cashRegisterCode: cashRegister.code,
        cashRegisterId: cashRegister._id,
        cashRegisterName: cashRegister.name,
        confirmationKey: normalizedConfirmationKey,
        currency: CASH_CURRENCY,
        delivererCode: tour.delivererCode ?? null,
        delivererId: tour.delivererId,
        delivererName: tour.delivererName ?? null,
        mode: CASH_PAYMENT_MODE,
        ...(normalizedNote ? { note: normalizedNote } : {}),
        receivedAt,
        receivedBy: receivedByObjectId,
        reference: createPaymentReference(paymentId),
        requestDigest,
        sourceTourCountingId: tour.countingId,
        tourId: tourObjectId,
        tourReference: tour.reference,
      };

      await database.collection('cashPayments').insertOne(payment, {
        session,
      });

      return {
        amountPaidInCentimes:
          amountPaidInCentimes + calculation.amountInCentimes,
        payment: serializePayment(payment),
        remainingDueInCentimes:
          calculation.remainingAfterPaymentInCentimes,
        replayed: false,
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof CashPaymentValidationError) {
      return { errors: error.errors };
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
