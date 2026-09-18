import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { createAlgiersDayBoundary } from './cash-payments.js';
import { normalizeDayRecapDate } from './day-recap-navigation.js';
import { readRecordedCountingSales } from './deliverer-monthly-achievement.js';
import { getMongoClient } from './mongodb.js';
import { readRecordedCountingPurchaseCosts } from './tour-counting-purchase-costs.js';
import {
  TOUR_EXPENSE_DECLARATION_STATUS_DECLARED,
  TOUR_EXPENSE_DECLARATION_STATUS_HISTORICAL_MISSING,
  TOUR_EXPENSE_DECLARATION_STATUS_MISSING,
  normalizeStoredTourExpenseDeclaration,
} from './tour-expense-records.js';
import { TOUR_EXPENSE_READ_PERMISSION } from './tour-expenses.js';
import { TOUR_STATUS_CLOSED, TOUR_STATUS_COUNTED } from './tours.js';

export const PROFITABILITY_READ_PERMISSION = 'profitability.read';
// Purchase costs and expenses keep their own permissions: the page never
// exposes them to a reader who could not see them elsewhere.
export const PROFITABILITY_READ_PERMISSIONS = Object.freeze([
  PROFITABILITY_READ_PERMISSION,
  'tours.read',
  'stock.valuation.read',
  TOUR_EXPENSE_READ_PERMISSION,
]);
export const PROFITABILITY_TOURS_PER_PAGE = 10;
export const PROFITABILITY_TOUR_STATUSES = Object.freeze([
  TOUR_STATUS_COUNTED,
  TOUR_STATUS_CLOSED,
]);

export const PROFITABILITY_STATUS_FINAL = 'FINAL';
export const PROFITABILITY_STATUS_PENDING_EXPENSES = 'PENDING_EXPENSES';
export const PROFITABILITY_STATUS_INCOMPLETE = 'INCOMPLETE';
export const TOUR_EXPENSE_DECLARATION_STATUS_INVALID = 'INVALID';

export const PROFITABILITY_ISSUE_LABELS = Object.freeze({
  COUNTED_AT_INVALID: 'Date de comptage absente ou incohérente',
  COUNTING_MISSING: 'Comptage définitif introuvable ou incohérent',
  COST_UNKNOWN: 'Coût d’achat non calculable',
  EXPENSES_HISTORICAL_MISSING: 'Frais jamais déclarés avant la clôture',
  EXPENSES_INVALID: 'Déclaration de frais incohérente',
  SALES_INVALID: 'Ventes du comptage incohérentes',
});

const METRICS = Object.freeze([
  ['sales', 'salesInCentimes'],
  ['costOfGoodsSold', 'costOfGoodsSoldInCentimes'],
  ['margin', 'marginInCentimes'],
  ['expenses', 'expensesInCentimes'],
  ['result', 'resultInCentimes'],
]);

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const escapeRegularExpression = (value) =>
  value.replace(/[$()*+.?[\\\]^{|}]/gu, '\\$&');

const isValidDate = (value) =>
  value instanceof Date && Number.isFinite(value.getTime());

const sameId = (first, second) => first instanceof ObjectId
  && second instanceof ObjectId
  && first.equals(second);

const readExpenses = ({ counting, declaration, tour }) => {
  if (declaration) {
    const normalizedDeclaration = normalizeStoredTourExpenseDeclaration(
      declaration,
      { sourceTourCountingId: counting._id, tourId: tour._id },
    );

    return normalizedDeclaration
      ? {
          expenseDeclarationStatus: TOUR_EXPENSE_DECLARATION_STATUS_DECLARED,
          expensesInCentimes: normalizedDeclaration.totalInCentimes,
        }
      : {
          expenseDeclarationStatus: TOUR_EXPENSE_DECLARATION_STATUS_INVALID,
          expensesInCentimes: null,
          issue: 'EXPENSES_INVALID',
        };
  }

  // A declaration is required before closing: a closed tour without one
  // predates that rule, and its expenses are unknown rather than zero.
  return tour.status === TOUR_STATUS_CLOSED
    ? {
        expenseDeclarationStatus: TOUR_EXPENSE_DECLARATION_STATUS_HISTORICAL_MISSING,
        expensesInCentimes: null,
        issue: 'EXPENSES_HISTORICAL_MISSING',
      }
    : {
        expenseDeclarationStatus: TOUR_EXPENSE_DECLARATION_STATUS_MISSING,
        expensesInCentimes: null,
      };
};

// Every amount comes from the recorded counting and expense declaration.
// An unknown amount stays null and is never replaced by zero.
export const buildTourProfitability = ({ counting = null, declaration = null, tour }) => {
  const issues = [];
  const linked = Boolean(counting)
    && sameId(counting._id, tour.countingId)
    && sameId(counting.tourId, tour._id)
    && Array.isArray(counting.lines);
  let countedAt = null;
  let salesInCentimes = null;
  let costOfGoodsSoldInCentimes = null;
  let expenses = {
    expenseDeclarationStatus: null,
    expensesInCentimes: null,
  };

  if (!linked) {
    issues.push('COUNTING_MISSING');
  } else {
    if (
      isValidDate(counting.countedAt)
      && (tour.countedAt == null
        || (isValidDate(tour.countedAt)
          && tour.countedAt.getTime() === counting.countedAt.getTime()))
    ) {
      countedAt = counting.countedAt;
    } else {
      issues.push('COUNTED_AT_INVALID');
    }

    const sales = readRecordedCountingSales(counting);
    salesInCentimes = sales.error ? null : sales.salesInCentimes;

    if (salesInCentimes === null) {
      issues.push('SALES_INVALID');
    }

    costOfGoodsSoldInCentimes =
      readRecordedCountingPurchaseCosts(counting).totalCostOfGoodsSoldInCentimes;

    if (costOfGoodsSoldInCentimes === null) {
      issues.push('COST_UNKNOWN');
    }

    expenses = readExpenses({ counting, declaration, tour });

    if (expenses.issue) {
      issues.push(expenses.issue);
    }
  }

  const marginInCentimes = salesInCentimes !== null && costOfGoodsSoldInCentimes !== null
    ? salesInCentimes - costOfGoodsSoldInCentimes
    : null;
  const resultInCentimes = marginInCentimes !== null && expenses.expensesInCentimes !== null
    ? marginInCentimes - expenses.expensesInCentimes
    : null;
  let profitabilityStatus = PROFITABILITY_STATUS_FINAL;

  if (issues.length > 0) {
    profitabilityStatus = PROFITABILITY_STATUS_INCOMPLETE;
  } else if (resultInCentimes === null) {
    profitabilityStatus = PROFITABILITY_STATUS_PENDING_EXPENSES;
  }

  return {
    closedAt: isValidDate(tour.closedAt) ? tour.closedAt.toISOString() : null,
    costOfGoodsSoldInCentimes,
    countedAt: countedAt?.toISOString() ?? null,
    deliverer: {
      code: tour.delivererCode ?? '',
      id: tour.delivererId?.toString?.() ?? '',
      name: tour.delivererName ?? 'Livreur inconnu',
    },
    expenseDeclarationStatus: expenses.expenseDeclarationStatus,
    expensesInCentimes: expenses.expensesInCentimes,
    id: tour._id.toString(),
    issues: issues.map((code) => ({ code, label: PROFITABILITY_ISSUE_LABELS[code] })),
    marginInCentimes,
    profitabilityStatus,
    reference: tour.reference ?? 'Référence indisponible',
    resultInCentimes,
    salesInCentimes,
    status: tour.status,
  };
};

// Each total adds the known amounts and reports how many tours are missing
// from it, so a partial total can never pass for a complete one.
export const summarizeTourProfitability = (records) => {
  const sums = Object.fromEntries(METRICS.map(([key]) => [key, 0n]));
  const unknownCounts = Object.fromEntries(METRICS.map(([key]) => [key, 0]));
  const counts = {
    final: 0,
    incomplete: 0,
    pendingExpenses: 0,
    tours: records.length,
  };

  for (const record of records) {
    if (record.profitabilityStatus === PROFITABILITY_STATUS_FINAL) {
      counts.final += 1;
    } else if (record.profitabilityStatus === PROFITABILITY_STATUS_PENDING_EXPENSES) {
      counts.pendingExpenses += 1;
    } else {
      counts.incomplete += 1;
    }

    for (const [key, field] of METRICS) {
      if (record[field] === null) {
        unknownCounts[key] += 1;
      } else {
        sums[key] += BigInt(record[field]);
      }
    }
  }

  return {
    counts,
    ...Object.fromEntries(METRICS.map(([key]) => {
      const withinLimits = sums[key] <= BigInt(Number.MAX_SAFE_INTEGER)
        && sums[key] >= BigInt(Number.MIN_SAFE_INTEGER);

      return [key, {
        amountInCentimes: withinLimits ? Number(sums[key]) : null,
        complete: withinLimits && unknownCounts[key] === 0,
        unknownCount: unknownCounts[key],
      }];
    })),
  };
};

export const normalizeProfitabilityFilters = ({
  dateFrom = '',
  dateTo = '',
  delivererId = '',
  query = '',
  status = '',
} = {}) => {
  let from = normalizeDayRecapDate(dateFrom);
  let to = normalizeDayRecapDate(dateTo);

  if (from && to && from > to) {
    [from, to] = [to, from];
  }

  const normalizedDelivererId = normalizeText(delivererId);

  return {
    dateFrom: from,
    dateTo: to,
    delivererId: ObjectId.isValid(normalizedDelivererId)
      && normalizedDelivererId.length === 24
      ? normalizedDelivererId
      : '',
    query: normalizeText(query).slice(0, 100),
    status: PROFITABILITY_TOUR_STATUSES.includes(status) ? status : '',
  };
};

const buildTourFilter = ({ dateFrom, dateTo, delivererId, query, status }) => {
  const conditions = [
    { status: status || { $in: PROFITABILITY_TOUR_STATUSES } },
  ];

  if (delivererId) {
    conditions.push({ delivererId: new ObjectId(delivererId) });
  }

  // Tours without a counting date are kept so that the reader reports them
  // as incomplete instead of silently leaving them out of the period.
  if (dateFrom || dateTo) {
    conditions.push({
      $or: [
        {
          countedAt: {
            ...(dateFrom ? { $gte: createAlgiersDayBoundary(dateFrom) } : {}),
            ...(dateTo ? { $lt: createAlgiersDayBoundary(dateTo, true) } : {}),
          },
        },
        { countedAt: null },
      ],
    });
  }

  if (query) {
    const pattern = { $options: 'i', $regex: escapeRegularExpression(query) };

    conditions.push({
      $or: [
        { reference: pattern },
        { delivererName: pattern },
        { delivererCode: pattern },
      ],
    });
  }

  return { $and: conditions };
};

const isWithinPeriod = (record, { dateFrom, dateTo }) => {
  if (!record.countedAt) {
    return true;
  }

  const countedAt = new Date(record.countedAt);

  return (!dateFrom || countedAt >= createAlgiersDayBoundary(dateFrom))
    && (!dateTo || countedAt < createAlgiersDayBoundary(dateTo, true));
};

const compareRecords = (first, second) => {
  if (first.countedAt !== second.countedAt) {
    if (!first.countedAt) {
      return -1;
    }

    if (!second.countedAt) {
      return 1;
    }

    return second.countedAt.localeCompare(first.countedAt, 'en');
  }

  return second.id.localeCompare(first.id, 'en');
};

export const getProfitabilityReport = async ({
  page = 1,
  pageSize = PROFITABILITY_TOURS_PER_PAGE,
  userId,
  ...filters
} = {}) => {
  const normalizedFilters = normalizeProfitabilityFilters(filters);
  const normalizedPageSize = Number.isSafeInteger(pageSize)
    && pageSize > 0
    && pageSize <= 100
    ? pageSize
    : PROFITABILITY_TOURS_PER_PAGE;
  const client = await getMongoClient();
  const database = client.db();
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      for (const permission of PROFITABILITY_READ_PERMISSIONS) {
        await requireUserPermission(userId, permission, { database, session });
      }

      const tours = await database.collection('tours').find(
        buildTourFilter(normalizedFilters),
        {
          projection: {
            closedAt: 1,
            countedAt: 1,
            countingId: 1,
            delivererCode: 1,
            delivererId: 1,
            delivererName: 1,
            reference: 1,
            status: 1,
          },
          session,
        },
      ).toArray();
      const tourIds = tours.map(({ _id }) => _id);
      const countingIds = tours
        .map(({ countingId }) => countingId)
        .filter((countingId) => countingId instanceof ObjectId);
      const countings = countingIds.length > 0
        ? await database.collection('tourCountings').find(
            { _id: { $in: countingIds } },
            {
              projection: {
                countedAt: 1,
                lines: 1,
                totalCostOfGoodsSoldInCentimes: 1,
                totalDueInCentimes: 1,
                totalPurchaseCostInCentimes: 1,
                totalReturnedValueInCentimes: 1,
                tourId: 1,
              },
              session,
            },
          ).toArray()
        : [];
      const declarations = tourIds.length > 0
        ? await database.collection('tourExpenses').find(
            { tourId: { $in: tourIds } },
            { session },
          ).toArray()
        : [];
      const countingsById = new Map(countings.map((counting) => [
        counting._id.toString(),
        counting,
      ]));
      const declarationsByTourId = new Map(declarations.map((declaration) => [
        declaration.tourId?.toString?.(),
        declaration,
      ]));
      const records = tours
        .map((tour) => buildTourProfitability({
          counting: tour.countingId instanceof ObjectId
            ? countingsById.get(tour.countingId.toString()) ?? null
            : null,
          declaration: declarationsByTourId.get(tour._id.toString()) ?? null,
          tour,
        }))
        .filter((record) => isWithinPeriod(record, normalizedFilters))
        .sort(compareRecords);
      const totalPages = Math.max(1, Math.ceil(records.length / normalizedPageSize));
      const activePage = Math.min(
        Number.isSafeInteger(page) && page > 0 ? page : 1,
        totalPages,
      );

      return {
        filters: normalizedFilters,
        page: activePage,
        pageSize: normalizedPageSize,
        totalItems: records.length,
        totalPages,
        totals: summarizeTourProfitability(records),
        tours: records.slice(
          (activePage - 1) * normalizedPageSize,
          activePage * normalizedPageSize,
        ),
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
