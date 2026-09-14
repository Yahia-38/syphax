import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import {
  CASH_READ_PERMISSION,
  readStoredTourPaymentResolution,
} from './cash-payments.js';
import {
  coordinateCashDeliverer,
  coordinateCashTour,
} from './cash-payment-coordination.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import {
  calculateTourExpensePreview,
  validateTourExpenseDeclarationInput,
} from './tour-expense-calculations.js';
import {
  TOUR_EXPENSE_DECLARATION_STATUS_DECLARED,
  TOUR_EXPENSE_DECLARATION_STATUS_HISTORICAL_MISSING,
  TOUR_EXPENSE_DECLARATION_STATUS_MISSING,
  normalizeStoredTourExpenseDeclaration,
  readStoredTourExpenseResolution,
} from './tour-expense-records.js';
import {
  TOUR_STATUS_CLOSED,
  TOUR_STATUS_COUNTED,
} from './tours.js';

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

const CONFIRMATION_KEY_PATTERN =
  /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const DIGEST_PATTERN = /^[\da-f]{64}$/iu;

class TourExpenseValidationError extends Error {
  constructor(errors, { stale = false, summary = null } = {}) {
    super('La déclaration de frais est invalide.');
    this.name = 'TourExpenseValidationError';
    this.errors = errors;
    this.stale = stale;
    this.summary = summary;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const createExpenseRequestDigest = ({
  choice,
  declaredBy,
  expenseLines,
  tourId,
}) => createHash('sha256')
  .update(JSON.stringify({
    choice,
    declaredBy,
    lines: expenseLines.map((line) => ({
      amountInCentimes: line.amountInCentimes,
      reason: line.reason,
    })),
    tourId,
  }))
  .digest('hex');

const createExpenseFinancialDigest = ({ counting, resolvedPayments }) =>
  createHash('sha256')
    .update(JSON.stringify({
      counting: {
        id: counting._id.toString(),
        totalDueInCentimes: counting.totalDueInCentimes,
      },
      payments: resolvedPayments
        .map(({ allocation, payment }) => ({
          amountInCentimes: allocation.allocatedAmountInCentimes,
          id: payment._id.toString(),
          sourceTourCountingId: allocation.sourceTourCountingId.toString(),
        }))
        .sort((first, second) => first.id.localeCompare(second.id, 'en')),
    }))
    .digest('hex');

const readExpenseAuthor = async ({ database, declaration, session }) => {
  if (!(declaration?.declaredBy instanceof ObjectId)) {
    return null;
  }

  const author = await database.collection('users').findOne(
    { _id: declaration.declaredBy },
    { projection: { username: 1 }, session },
  );

  return typeof author?.username === 'string' ? author.username : null;
};

const serializeDeclaration = ({ author, declaration }) => ({
  choice: declaration.choice,
  declaredAt: declaration.declaredAt.toISOString(),
  declaredBy: author,
  id: declaration._id.toString(),
  lines: declaration.lines.map((line) => ({
    amountInCentimes: line.amountInCentimes,
    reason: line.reason,
  })),
  totalExpensesInCentimes: declaration.totalInCentimes,
});

export const ensureTourExpenseIndexes = async (database) => {
  await Promise.all([
    database.collection('tourExpenses').createIndex(
      { tourId: 1 },
      { name: 'unique_tour_expense_tour', unique: true },
    ),
    database.collection('tourExpenses').createIndex(
      { confirmationKey: 1 },
      { name: 'unique_tour_expense_confirmation_key', unique: true },
    ),
  ]);
};

const readTourExpenseFinancialSummary = async ({
  database,
  session,
  tour,
}) => {
  if (!(tour.countingId instanceof ObjectId)) {
    throw new TourExpenseValidationError({
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
    throw new TourExpenseValidationError({
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
  const totalPaidInCentimes = resolvedPayments?.amountInCentimes ?? null;

  if (
    totalPaidInCentimes === null
    || totalPaidInCentimes > counting.totalDueInCentimes
  ) {
    throw new TourExpenseValidationError({
      form: 'Les versements enregistrés de cette tournée sont incohérents.',
    });
  }

  if (!expenseResolution) {
    throw new TourExpenseValidationError({
      form: 'La déclaration de frais enregistrée est incohérente.',
    });
  }

  const netDueInCentimes = counting.totalDueInCentimes
    - expenseResolution.totalExpensesInCentimes;

  if (
    !Number.isSafeInteger(netDueInCentimes)
    || netDueInCentimes < 0
    || totalPaidInCentimes > netDueInCentimes
  ) {
    throw new TourExpenseValidationError({
      form: 'Les montants financiers de cette tournée sont incohérents.',
    });
  }

  return {
    counting,
    digest: createExpenseFinancialDigest({
      counting,
      resolvedPayments: resolvedPayments.payments,
    }),
    expenseResolution,
    grossSalesInCentimes: counting.totalDueInCentimes,
    maximumExpensesInCentimes:
      counting.totalDueInCentimes - totalPaidInCentimes,
    netDueInCentimes,
    remainingDueInCentimes: netDueInCentimes - totalPaidInCentimes,
    resolvedPayments,
    totalPaidInCentimes,
  };
};

export const getTourExpensePreview = async ({ tourId, userId } = {}) => {
  for (const permission of TOUR_EXPENSE_PREVIEW_PERMISSIONS) {
    await requireUserPermission(userId, permission);
  }

  if (typeof tourId !== 'string' || !ObjectId.isValid(tourId)) {
    return null;
  }

  const database = await getDatabase();
  const tour = await database.collection('tours').findOne(
    {
      _id: new ObjectId(tourId),
      status: { $in: [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED] },
    },
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
    const summary = await readTourExpenseFinancialSummary({ database, tour });
    const declaration = summary.expenseResolution.declaration;
    const author = await readExpenseAuthor({ database, declaration });
    const declarationStatus = declaration
      ? TOUR_EXPENSE_DECLARATION_STATUS_DECLARED
      : tour.status === TOUR_STATUS_CLOSED
        ? TOUR_EXPENSE_DECLARATION_STATUS_HISTORICAL_MISSING
        : TOUR_EXPENSE_DECLARATION_STATUS_MISSING;

    return {
      declaration: declaration
        ? serializeDeclaration({ author, declaration })
        : null,
      declarationStatus,
      deliverer: {
        code: tour.delivererCode ?? 'Livreur inconnu',
        id: tour.delivererId.toString(),
        name: tour.delivererName ?? '',
      },
      digest: summary.digest,
      errors: {},
      grossSalesInCentimes: summary.grossSalesInCentimes,
      maximumExpensesInCentimes: summary.maximumExpensesInCentimes,
      netDueInCentimes: summary.netDueInCentimes,
      remainingDueInCentimes: summary.remainingDueInCentimes,
      totalPaidInCentimes: summary.totalPaidInCentimes,
      tourId,
      tourReference: tour.reference ?? 'Référence indisponible',
      tourStatus: tour.status,
    };
  } catch (error) {
    if (error instanceof TourExpenseValidationError) {
      return { errors: error.errors, tourId };
    }

    throw error;
  }
};

const readExistingDeclaration = async ({
  confirmationKey,
  database,
  requestDigest,
  session,
}) => {
  const declaration = await database.collection('tourExpenses').findOne(
    { confirmationKey },
    { session },
  );

  if (!declaration) {
    return null;
  }

  const normalizedDeclaration = normalizeStoredTourExpenseDeclaration(
    declaration,
  );

  if (!normalizedDeclaration) {
    throw new TourExpenseValidationError({
      form: 'La déclaration de frais enregistrée est incohérente.',
    });
  }

  if (normalizedDeclaration.requestDigest !== requestDigest) {
    throw new TourExpenseValidationError({
      form: 'Cette demande a déjà été utilisée avec un contenu différent.',
    });
  }

  const author = await readExpenseAuthor({
    database,
    declaration: normalizedDeclaration,
    session,
  });

  return {
    declaration: serializeDeclaration({
      author,
      declaration: normalizedDeclaration,
    }),
    delivererId: normalizedDeclaration.delivererId?.toString?.() ?? '',
    replayed: true,
  };
};

const isDeclarationDuplicate = (error) => error?.code === 11000
  && (
    error?.keyPattern?.confirmationKey
    || error?.keyPattern?.tourId
    || error?.message?.includes('unique_tour_expense_')
  );

export const recordTourExpenseDeclaration = async ({
  choice,
  confirmationKey,
  declaredBy,
  expectedDigest,
  expenses,
  tourId,
}) => {
  const normalizedConfirmationKey = normalizeText(confirmationKey)
    .toLocaleLowerCase('en');
  const normalizedDeclaredBy = normalizeText(declaredBy);
  const normalizedDigest = normalizeText(expectedDigest)
    .toLocaleLowerCase('en');
  const normalizedTourId = normalizeText(tourId);
  const validatedInput = validateTourExpenseDeclarationInput({
    choice,
    expenses,
  });
  const errors = {};

  if (!CONFIRMATION_KEY_PATTERN.test(normalizedConfirmationKey)) {
    errors.form = 'La clé de confirmation est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedDeclaredBy)) {
    errors.form = 'L’auteur de la déclaration est invalide.';
  }

  if (!DIGEST_PATTERN.test(normalizedDigest)) {
    errors.form = 'Le récapitulatif confirmé est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedTourId)) {
    errors.form = 'Cette tournée n’existe plus.';
  }

  if (
    validatedInput.choiceError
    || validatedInput.financialError
    || validatedInput.totalExpensesInCentimes === null
  ) {
    errors.form = validatedInput.choiceError
      ?? validatedInput.financialError
      ?? 'Une ou plusieurs lignes de frais sont invalides.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const requestDigest = createExpenseRequestDigest({
    choice: validatedInput.choice,
    declaredBy: normalizedDeclaredBy,
    expenseLines: validatedInput.expenseLines,
    tourId: normalizedTourId,
  });
  const client = await getMongoClient();
  const database = client.db();
  const declaredByObjectId = new ObjectId(normalizedDeclaredBy);
  const tourObjectId = new ObjectId(normalizedTourId);

  await ensureTourExpenseIndexes(database);

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      for (const permission of TOUR_EXPENSE_FORM_PERMISSIONS) {
        await requireUserPermission(normalizedDeclaredBy, permission, {
          database,
          session,
        });
      }

      const existingDeclaration = await readExistingDeclaration({
        confirmationKey: normalizedConfirmationKey,
        database,
        requestDigest,
        session,
      });

      if (existingDeclaration) {
        return existingDeclaration;
      }

      const preliminaryTour = await database.collection('tours').findOne(
        { _id: tourObjectId },
        { projection: { delivererId: 1 }, session },
      );

      if (
        !preliminaryTour
        || !(preliminaryTour.delivererId instanceof ObjectId)
      ) {
        throw new TourExpenseValidationError({
          form: 'Cette tournée n’existe plus ou son livreur historique est invalide.',
        });
      }

      const deliverer = await coordinateCashDeliverer({
        database,
        delivererId: preliminaryTour.delivererId,
        session,
      });

      if (!deliverer) {
        throw new TourExpenseValidationError({
          form: 'Le livreur historique de cette tournée est introuvable.',
        });
      }

      const tour = await coordinateCashTour({
        database,
        filter: { delivererId: preliminaryTour.delivererId },
        projection: {
          countingId: 1,
          delivererCode: 1,
          delivererId: 1,
          delivererName: 1,
          reference: 1,
          status: 1,
        },
        session,
        tourId: tourObjectId,
      });

      if (!tour || tour.status !== TOUR_STATUS_COUNTED) {
        throw new TourExpenseValidationError({
          form: 'Seule une tournée comptée et non clôturée peut recevoir une déclaration de frais.',
        });
      }

      const declarationForTour = await database.collection('tourExpenses')
        .findOne({ tourId: tourObjectId }, { session });

      if (declarationForTour) {
        throw new TourExpenseValidationError({
          form: 'Une déclaration définitive existe déjà pour cette tournée.',
        });
      }

      const summary = await readTourExpenseFinancialSummary({
        database,
        session,
        tour,
      });
      const calculation = calculateTourExpensePreview({
        choice: validatedInput.choice,
        expenses: validatedInput.expenseLines.map((line) => ({
          amount: line.amount,
          id: line.id,
          reason: line.reason,
        })),
        grossSalesInCentimes: summary.grossSalesInCentimes,
        totalPaidInCentimes: summary.totalPaidInCentimes,
      });

      if (!calculation.complete) {
        throw new TourExpenseValidationError(
          {
            form: calculation.financialError
              ?? calculation.choiceError
              ?? 'Une ou plusieurs lignes de frais sont invalides.',
          },
          {
            stale: summary.digest !== normalizedDigest,
            summary,
          },
        );
      }

      if (summary.digest !== normalizedDigest) {
        throw new TourExpenseValidationError(
          {
            form: 'Les encaissements ont changé. Vérifiez le maximum actualisé puis confirmez à nouveau.',
          },
          { stale: true, summary },
        );
      }

      const declarationId = new ObjectId();
      const declaredAt = new Date();
      const declaration = {
        _id: declarationId,
        choice: calculation.choice,
        confirmationKey: normalizedConfirmationKey,
        declaredAt,
        declaredBy: declaredByObjectId,
        delivererId: tour.delivererId,
        financialSnapshot: {
          grossSalesInCentimes: calculation.grossSalesInCentimes,
          maximumExpensesInCentimes: calculation.maximumExpensesInCentimes,
          netDueInCentimes: calculation.netDueInCentimes,
          remainingDueInCentimes: calculation.remainingDueInCentimes,
          totalPaidInCentimes: calculation.totalPaidInCentimes,
        },
        lines: calculation.expenseLines.map((line) => ({
          amountInCentimes: line.amountInCentimes,
          reason: line.reason,
        })),
        requestDigest,
        sourceTourCountingId: summary.counting._id,
        totalInCentimes: calculation.totalExpensesInCentimes,
        tourId: tourObjectId,
      };

      await database.collection('tourExpenses').insertOne(declaration, {
        session,
      });

      const author = await readExpenseAuthor({
        database,
        declaration,
        session,
      });

      return {
        declaration: serializeDeclaration({ author, declaration }),
        delivererId: tour.delivererId.toString(),
        replayed: false,
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof TourExpenseValidationError) {
      return {
        errors: error.errors,
        stale: error.stale,
        ...(error.summary ? { summary: error.summary } : {}),
      };
    }

    if (isDeclarationDuplicate(error)) {
      for (const permission of TOUR_EXPENSE_FORM_PERMISSIONS) {
        await requireUserPermission(normalizedDeclaredBy, permission, {
          database,
        });
      }

      try {
        const concurrentDeclaration = await readExistingDeclaration({
          confirmationKey: normalizedConfirmationKey,
          database,
          requestDigest,
        });

        if (concurrentDeclaration) {
          return concurrentDeclaration;
        }
      } catch (validationError) {
        if (validationError instanceof TourExpenseValidationError) {
          return { errors: validationError.errors };
        }

        throw validationError;
      }

      return {
        errors: {
          form: 'Une déclaration définitive existe déjà pour cette tournée.',
        },
      };
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
