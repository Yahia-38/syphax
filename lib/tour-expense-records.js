import { ObjectId } from 'mongodb';

export const TOUR_EXPENSE_DECLARATION_STATUS_DECLARED = 'DECLARED';
export const TOUR_EXPENSE_DECLARATION_STATUS_MISSING = 'MISSING';
export const TOUR_EXPENSE_DECLARATION_STATUS_HISTORICAL_MISSING =
  'HISTORICAL_MISSING';

const hasValidStoredLines = (declaration) => {
  if (!Array.isArray(declaration.lines)) {
    return false;
  }

  if (declaration.choice === 'NONE') {
    return declaration.lines.length === 0
      && declaration.totalInCentimes === 0;
  }

  if (declaration.choice !== 'DECLARE' || declaration.lines.length === 0) {
    return false;
  }

  let totalInCentimes = 0;

  for (const line of declaration.lines) {
    if (
      !line
      || typeof line.reason !== 'string'
      || !line.reason
      || line.reason !== line.reason.trim()
      || line.reason.length > 200
      || !Number.isSafeInteger(line.amountInCentimes)
      || line.amountInCentimes <= 0
    ) {
      return false;
    }

    totalInCentimes += line.amountInCentimes;

    if (!Number.isSafeInteger(totalInCentimes)) {
      return false;
    }
  }

  return totalInCentimes === declaration.totalInCentimes;
};

export const normalizeStoredTourExpenseDeclaration = (
  declaration,
  { sourceTourCountingId, tourId } = {},
) => {
  if (!declaration) {
    return null;
  }

  if (
    !(declaration._id instanceof ObjectId)
    || !(declaration.tourId instanceof ObjectId)
    || !(declaration.sourceTourCountingId instanceof ObjectId)
    || !(declaration.declaredAt instanceof Date)
    || !(declaration.declaredBy instanceof ObjectId)
    || !Number.isSafeInteger(declaration.totalInCentimes)
    || declaration.totalInCentimes < 0
    || (tourId instanceof ObjectId && !declaration.tourId.equals(tourId))
    || (
      sourceTourCountingId instanceof ObjectId
      && !declaration.sourceTourCountingId.equals(sourceTourCountingId)
    )
    || !hasValidStoredLines(declaration)
  ) {
    return null;
  }

  return declaration;
};

export const readStoredTourExpenseResolution = async ({
  database,
  session,
  sourceTourCountingId,
  tourId,
}) => {
  const declaration = await database.collection('tourExpenses').findOne(
    { tourId },
    { session },
  );

  if (!declaration) {
    return {
      declaration: null,
      status: TOUR_EXPENSE_DECLARATION_STATUS_MISSING,
      totalExpensesInCentimes: 0,
    };
  }

  const normalizedDeclaration = normalizeStoredTourExpenseDeclaration(
    declaration,
    { sourceTourCountingId, tourId },
  );

  if (!normalizedDeclaration) {
    return null;
  }

  return {
    declaration: normalizedDeclaration,
    status: TOUR_EXPENSE_DECLARATION_STATUS_DECLARED,
    totalExpensesInCentimes: normalizedDeclaration.totalInCentimes,
  };
};
