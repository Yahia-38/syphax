import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import {
  calculateCashPaymentPreview,
  calculateDelivererCashAllocationPreview,
  parseCashPaymentAmountInCentimes,
} from './cash-payment-calculations.js';
import {
  coordinateCashDeliverer,
  coordinateCashRegister,
  coordinateCashTour,
  coordinateCashTours,
} from './cash-payment-coordination.js';
import { CASH_CURRENCY } from './cash-registers.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import {
  TOUR_STATUS_CLOSED,
  TOUR_STATUS_COUNTED,
} from './tours.js';

export const CASH_READ_PERMISSION = 'cash.read';
export const CASH_PAYMENT_CREATE_PERMISSION = 'cash.payments.create';
export const CASH_PAYMENT_MODE = 'CASH';
export const CASH_PAYMENT_NOTE_MAX_LENGTH = 500;
export const CASH_PAYMENTS_PER_PAGE = 10;
export const CASH_REMAINDERS_PER_PAGE = 10;

const CASH_JOURNAL_PARAMETERS = new Set([
  'au',
  'du',
  'livreur',
  'page',
  'q',
  'restePage',
  'resteRecherche',
]);
const CASH_JOURNAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export const CASH_PAYMENT_FORM_PERMISSIONS = Object.freeze([
  CASH_READ_PERMISSION,
  CASH_PAYMENT_CREATE_PERMISSION,
]);

export const CASH_PAYMENT_RECORD_PERMISSIONS = Object.freeze([
  CASH_READ_PERMISSION,
  CASH_PAYMENT_CREATE_PERMISSION,
]);

const CONFIRMATION_KEY_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const STORED_PAYMENT_ALLOCATION_AMOUNT_FIELD = 'allocatedAmountInCentimes';

class CashPaymentValidationError extends Error {
  constructor(errors, { stale = false, summary = null } = {}) {
    super('Le versement en espèces est invalide.');
    this.name = 'CashPaymentValidationError';
    this.errors = errors;
    this.stale = stale;
    this.summary = summary;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const escapeRegularExpression = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const readSingleValue = (value) => Array.isArray(value) ? value[0] : value;

const normalizeJournalDate = (value) => {
  const normalizedValue = normalizeText(readSingleValue(value));

  if (!CASH_JOURNAL_DATE_PATTERN.test(normalizedValue)) {
    return '';
  }

  const [year, month, day] = normalizedValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? normalizedValue
    : '';
};

const createAlgiersDayBoundary = (value, nextDay = false) => {
  const [year, month, day] = value.split('-').map(Number);
  const boundary = new Date(Date.UTC(year, month - 1, day, -1));

  if (nextDay) {
    boundary.setUTCDate(boundary.getUTCDate() + 1);
  }

  return boundary;
};

export const readCashJournalState = (searchParams = {}) => {
  const rawDelivererId = normalizeText(readSingleValue(searchParams.livreur));
  const rawPage = readSingleValue(searchParams.page);
  const parsedPage = typeof rawPage === 'string' && /^\d+$/u.test(rawPage)
    ? Number(rawPage)
    : 1;

  return {
    dateFrom: normalizeJournalDate(searchParams.du),
    dateTo: normalizeJournalDate(searchParams.au),
    delivererId: ObjectId.isValid(rawDelivererId) ? rawDelivererId : '',
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    query: normalizeText(readSingleValue(searchParams.q)).slice(0, 100),
  };
};

export const readCashRemaindersState = (searchParams = {}) => {
  const rawPage = readSingleValue(searchParams.restePage);
  const parsedPage = typeof rawPage === 'string' && /^\d+$/u.test(rawPage)
    ? Number(rawPage)
    : 1;

  return {
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    query: normalizeText(readSingleValue(searchParams.resteRecherche))
      .slice(0, 100),
  };
};

export const buildCashJournalHref = ({
  dateFrom = '',
  dateTo = '',
  delivererId = '',
  page = 1,
  query = '',
  remainderPage = 1,
  remainderQuery = '',
} = {}) => {
  const parameters = new URLSearchParams();
  const normalizedQuery = normalizeText(query).slice(0, 100);

  if (normalizedQuery) {
    parameters.set('q', normalizedQuery);
  }

  if (ObjectId.isValid(delivererId)) {
    parameters.set('livreur', delivererId);
  }

  if (normalizeJournalDate(dateFrom)) {
    parameters.set('du', dateFrom);
  }

  if (normalizeJournalDate(dateTo)) {
    parameters.set('au', dateTo);
  }

  if (Number.isSafeInteger(page) && page > 1) {
    parameters.set('page', String(page));
  }

  const normalizedRemainderQuery = normalizeText(remainderQuery).slice(0, 100);

  if (normalizedRemainderQuery) {
    parameters.set('resteRecherche', normalizedRemainderQuery);
  }

  if (Number.isSafeInteger(remainderPage) && remainderPage > 1) {
    parameters.set('restePage', String(remainderPage));
  }

  const search = parameters.toString();

  return search ? `/caisse?${search}` : '/caisse';
};

export const buildCashRemaindersHref = ({
  dateFrom = '',
  dateTo = '',
  delivererId = '',
  journalPage = 1,
  journalQuery = '',
  page = 1,
  query = '',
} = {}) => buildCashJournalHref({
  dateFrom,
  dateTo,
  delivererId,
  page: journalPage,
  query: journalQuery,
  remainderPage: page,
  remainderQuery: query,
});

export const validateCashJournalHref = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/caisse';
  }

  let destination;

  try {
    destination = new URL(value, 'https://syphax.invalid');
  } catch {
    return '/caisse';
  }

  if (
    destination.origin !== 'https://syphax.invalid'
    || destination.pathname !== '/caisse'
    || destination.hash
    || [...destination.searchParams.keys()].some(
      (key) => !CASH_JOURNAL_PARAMETERS.has(key),
    )
  ) {
    return '/caisse';
  }

  const searchParams = Object.fromEntries(destination.searchParams);
  const journalState = readCashJournalState(searchParams);
  const remainderState = readCashRemaindersState(searchParams);

  return buildCashJournalHref({
    ...journalState,
    remainderPage: remainderState.page,
    remainderQuery: remainderState.query,
  });
};

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

const normalizeDelivererPaymentSummary = (value) => {
  let summary = value;

  if (typeof summary === 'string') {
    try {
      summary = JSON.parse(summary);
    } catch {
      return null;
    }
  }

  if (!summary || typeof summary !== 'object' || !Array.isArray(summary.allocations)) {
    return null;
  }

  const integerFields = [
    'amountInCentimes',
    'totalAllocatedInCentimes',
    'totalRemainingAfterPaymentInCentimes',
    'totalRemainingDueInCentimes',
  ];

  if (integerFields.some((field) =>
    !Number.isSafeInteger(summary[field]) || summary[field] < 0)) {
    return null;
  }

  const allocations = [];

  for (const allocation of summary.allocations) {
    const countedAt = typeof allocation?.countedAt === 'string'
      ? new Date(allocation.countedAt)
      : null;

    if (
      !allocation
      || typeof allocation !== 'object'
      || !ObjectId.isValid(allocation.tourId)
      || typeof allocation.tourReference !== 'string'
      || !allocation.tourReference
      || !(countedAt instanceof Date)
      || Number.isNaN(countedAt.getTime())
      || !Number.isSafeInteger(allocation.allocatedAmountInCentimes)
      || allocation.allocatedAmountInCentimes <= 0
      || !Number.isSafeInteger(allocation.remainingBeforePaymentInCentimes)
      || allocation.remainingBeforePaymentInCentimes <= 0
      || !Number.isSafeInteger(allocation.remainingAfterPaymentInCentimes)
      || allocation.remainingAfterPaymentInCentimes < 0
    ) {
      return null;
    }

    allocations.push({
      allocatedAmountInCentimes: allocation.allocatedAmountInCentimes,
      countedAt: countedAt.toISOString(),
      remainingAfterPaymentInCentimes:
        allocation.remainingAfterPaymentInCentimes,
      remainingBeforePaymentInCentimes:
        allocation.remainingBeforePaymentInCentimes,
      tourId: new ObjectId(allocation.tourId).toString(),
      tourReference: allocation.tourReference,
    });
  }

  if (allocations.length === 0) {
    return null;
  }

  return {
    allocations,
    amountInCentimes: summary.amountInCentimes,
    totalAllocatedInCentimes: summary.totalAllocatedInCentimes,
    totalRemainingAfterPaymentInCentimes:
      summary.totalRemainingAfterPaymentInCentimes,
    totalRemainingDueInCentimes: summary.totalRemainingDueInCentimes,
  };
};

export const createDelivererCashPaymentSummaryDigest = (summary) => {
  const normalizedSummary = normalizeDelivererPaymentSummary(summary);

  return normalizedSummary
    ? createHash('sha256')
      .update(JSON.stringify(normalizedSummary))
      .digest('hex')
    : null;
};

const createDelivererPaymentRequestDigest = ({
  amountInCentimes,
  cashRegisterId,
  delivererId,
  expectedSummaryDigest,
  note,
  receivedBy,
}) => createHash('sha256')
  .update(JSON.stringify({
    amountInCentimes,
    cashRegisterId,
    delivererId,
    expectedSummaryDigest,
    note,
    receivedBy,
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
      { 'allocations.tourId': 1, receivedAt: -1, _id: -1 },
      { name: 'cash_payment_allocation_tour_history' },
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

const hasOwnProperty = (value, property) =>
  Object.prototype.hasOwnProperty.call(value, property);

export const normalizeStoredPaymentAllocations = (payment) => {
  if (
    !payment
    || typeof payment !== 'object'
    || !Number.isSafeInteger(payment.amountInCentimes)
    || payment.amountInCentimes <= 0
    || payment.currency !== CASH_CURRENCY
  ) {
    return null;
  }

  const usesExplicitAllocations = hasOwnProperty(payment, 'allocations');
  const sourceAllocations = usesExplicitAllocations
    ? payment.allocations
    : [{
        [STORED_PAYMENT_ALLOCATION_AMOUNT_FIELD]: payment.amountInCentimes,
        sourceTourCountingId: payment.sourceTourCountingId,
        tourId: payment.tourId,
        tourReference: payment.tourReference,
      }];

  if (!Array.isArray(sourceAllocations) || sourceAllocations.length === 0) {
    return null;
  }

  const allocations = [];
  const tourIds = new Set();
  let totalAllocatedInCentimes = 0;

  for (const allocation of sourceAllocations) {
    if (
      !allocation
      || typeof allocation !== 'object'
      || !(allocation.tourId instanceof ObjectId)
      || !(allocation.sourceTourCountingId instanceof ObjectId)
      || !Number.isSafeInteger(
        allocation[STORED_PAYMENT_ALLOCATION_AMOUNT_FIELD],
      )
      || allocation[STORED_PAYMENT_ALLOCATION_AMOUNT_FIELD] <= 0
    ) {
      return null;
    }

    const tourId = allocation.tourId.toString();

    if (tourIds.has(tourId)) {
      return null;
    }

    tourIds.add(tourId);
    totalAllocatedInCentimes +=
      allocation[STORED_PAYMENT_ALLOCATION_AMOUNT_FIELD];

    if (!Number.isSafeInteger(totalAllocatedInCentimes)) {
      return null;
    }

    allocations.push({
      allocatedAmountInCentimes:
        allocation[STORED_PAYMENT_ALLOCATION_AMOUNT_FIELD],
      amountDueInCentimes: allocation.amountDueInCentimes,
      amountPaidBeforeInCentimes: allocation.amountPaidBeforeInCentimes,
      countedAt: allocation.countedAt,
      remainingAfterPaymentInCentimes:
        allocation.remainingAfterPaymentInCentimes,
      remainingBeforePaymentInCentimes:
        allocation.remainingBeforePaymentInCentimes,
      sourceTourCountingId: allocation.sourceTourCountingId,
      tourId: allocation.tourId,
      tourReference: allocation.tourReference,
    });
  }

  if (totalAllocatedInCentimes !== payment.amountInCentimes) {
    return null;
  }

  return {
    allocations,
    amountInCentimes: payment.amountInCentimes,
    usesExplicitAllocations,
  };
};

const paymentAllocationReferencesAreValid = ({
  normalizedPayment,
  payment,
  toursById,
}) => normalizedPayment.allocations.every((allocation) => {
  const tour = toursById.get(allocation.tourId.toString());

  return tour
    && tour.countingId instanceof ObjectId
    && tour.countingId.equals(allocation.sourceTourCountingId)
    && [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED].includes(tour.status)
    && (
      !(payment.delivererId instanceof ObjectId)
      || (
        tour.delivererId instanceof ObjectId
        && payment.delivererId.equals(tour.delivererId)
      )
    );
});

export const resolveStoredTourPayments = ({
  payments,
  sourceTourCountingId,
  tourId,
  toursById,
}) => {
  if (
    !Array.isArray(payments)
    || !(sourceTourCountingId instanceof ObjectId)
    || !(tourId instanceof ObjectId)
  ) {
    return null;
  }

  const resolvedPayments = [];
  let amountInCentimes = 0;

  for (const payment of payments) {
    const normalizedPayment = normalizeStoredPaymentAllocations(payment);

    if (!normalizedPayment) {
      return null;
    }

    if (
      toursById
      && !paymentAllocationReferencesAreValid({
        normalizedPayment,
        payment,
        toursById,
      })
    ) {
      return null;
    }

    const matchingAllocations = normalizedPayment.allocations.filter(
      (allocation) => allocation.tourId.equals(tourId),
    );

    if (matchingAllocations.length === 0) {
      if (normalizedPayment.usesExplicitAllocations) {
        continue;
      }

      return null;
    }

    if (
      matchingAllocations.length !== 1
      || !matchingAllocations[0].sourceTourCountingId.equals(
        sourceTourCountingId,
      )
    ) {
      return null;
    }

    const [allocation] = matchingAllocations;
    amountInCentimes += allocation.allocatedAmountInCentimes;

    if (!Number.isSafeInteger(amountInCentimes)) {
      return null;
    }

    resolvedPayments.push({ allocation, payment });
  }

  return { amountInCentimes, payments: resolvedPayments };
};

export const calculateStoredPaymentTotal = (
  payments,
  sourceTourCountingId,
  tourId,
) => {
  const normalizedTourId = tourId instanceof ObjectId
    ? tourId
    : payments.flatMap((payment) =>
        normalizeStoredPaymentAllocations(payment)?.allocations ?? [])
      .find((allocation) => allocation.sourceTourCountingId.equals(
        sourceTourCountingId,
      ))?.tourId;

  if (!(normalizedTourId instanceof ObjectId)) {
    return payments.length === 0 ? 0 : null;
  }

  return resolveStoredTourPayments({
    payments,
    sourceTourCountingId,
    tourId: normalizedTourId,
  })?.amountInCentimes ?? null;
};

export const readStoredPayments = async ({
  database,
  delivererId,
  session,
  tourId,
}) =>
  database.collection('cashPayments').find(
    {
      $or: [
        { allocations: { $exists: false }, tourId },
        {
          allocations: { $exists: true },
          $or: [
            { 'allocations.tourId': tourId },
            { tourId },
            ...(delivererId instanceof ObjectId ? [{ delivererId }] : []),
          ],
        },
      ],
    },
    {
      projection: {
        allocations: 1,
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
        tourId: 1,
        tourReference: 1,
      },
      session,
    },
  ).sort({ receivedAt: -1, _id: -1 }).toArray();

export const readStoredTourPaymentResolution = async ({
  database,
  delivererId,
  session,
  sourceTourCountingId,
  tourId,
}) => {
  const payments = await readStoredPayments({
    database,
    delivererId,
    session,
    tourId,
  });
  const referencedTourIds = [...new Map(
    payments.flatMap((payment) =>
      normalizeStoredPaymentAllocations(payment)?.allocations ?? [])
      .map((allocation) => [
        allocation.tourId.toString(),
        allocation.tourId,
      ]),
  ).values()];
  const referencedTours = referencedTourIds.length > 0
    ? await database.collection('tours').find(
        { _id: { $in: referencedTourIds } },
        {
          projection: { countingId: 1, delivererId: 1, status: 1 },
          session,
        },
      ).toArray()
    : [];
  const resolution = resolveStoredTourPayments({
    payments,
    sourceTourCountingId,
    tourId,
    toursById: new Map(referencedTours.map((tour) => [
      tour._id.toString(),
      tour,
    ])),
  });

  return resolution;
};

const serializePayment = (
  payment,
  author = null,
  amountInCentimes = payment.amountInCentimes,
) => ({
  amountInCentimes,
  cashRegister: {
    code: payment.cashRegisterCode,
    id: payment.cashRegisterId?.toString?.() ?? '',
    name: payment.cashRegisterName,
  },
  currency: payment.currency,
  delivererId: payment.delivererId?.toString?.() ?? '',
  id: payment._id.toString(),
  mode: payment.mode,
  note: payment.note ?? '',
  receivedAt: payment.receivedAt?.toISOString?.() ?? null,
  receivedBy: author,
  reference: payment.reference,
});

const serializeDelivererPayment = (payment) => {
  const normalizedPayment = normalizeStoredPaymentAllocations(payment);

  return {
    ...serializePayment(payment),
    allocationSummaryDigest: payment.allocationSummaryDigest ?? null,
    allocations: normalizedPayment?.allocations.map((allocation) => ({
      allocatedAmountInCentimes: allocation.allocatedAmountInCentimes,
      amountDueInCentimes: allocation.amountDueInCentimes ?? null,
      amountPaidBeforeInCentimes:
        allocation.amountPaidBeforeInCentimes ?? null,
      countedAt: allocation.countedAt?.toISOString?.()
        ?? allocation.countedAt
        ?? null,
      remainingAfterPaymentInCentimes:
        allocation.remainingAfterPaymentInCentimes ?? null,
      remainingBeforePaymentInCentimes:
        allocation.remainingBeforePaymentInCentimes ?? null,
      sourceTourCountingId: allocation.sourceTourCountingId.toString(),
      tourId: allocation.tourId.toString(),
      tourReference: allocation.tourReference ?? 'Référence indisponible',
    })) ?? [],
    deliverer: {
      code: payment.delivererCode ?? 'Livreur inconnu',
      id: payment.delivererId?.toString?.() ?? '',
      name: payment.delivererName ?? '',
    },
    totalRemainingAfterPaymentInCentimes:
      payment.totalRemainingAfterPaymentInCentimes ?? null,
    totalRemainingBeforePaymentInCentimes:
      payment.totalRemainingBeforePaymentInCentimes ?? null,
  };
};

const serializePaymentHistory = async ({
  database,
  resolvedPayments,
  session,
}) => {
  const authorIds = [...new Map(
    resolvedPayments
      .map(({ payment }) => payment)
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

  return resolvedPayments.map(({ allocation, payment }) => serializePayment(
    payment,
    authorsById.get(payment.receivedBy?.toString()) ?? null,
    allocation.allocatedAmountInCentimes,
  ));
};

const serializeCashJournalPayment = (payment) => {
  const normalizedPayment = normalizeStoredPaymentAllocations(payment);
  const allocations = normalizedPayment
    ? normalizedPayment.allocations.map((allocation) => ({
        amountInCentimes: allocation.allocatedAmountInCentimes,
        id: allocation.tourId.toString(),
        reference: allocation.tourReference ?? 'Référence indisponible',
      }))
    : null;

  return {
    allocations,
    amountInCentimes: payment.amountInCentimes,
    author: payment.author ?? null,
    cashRegister: {
      code: payment.cashRegisterCode ?? 'Caisse inconnue',
      id: payment.cashRegisterId?.toString?.() ?? '',
      name: payment.cashRegisterName ?? '',
    },
    deliverer: {
      code: payment.delivererCode ?? 'Livreur inconnu',
      id: payment.delivererId?.toString?.() ?? '',
      name: payment.delivererName ?? '',
    },
    id: payment._id.toString(),
    note: payment.note ?? '',
    receivedAt: payment.receivedAt?.toISOString?.() ?? null,
    reference: payment.reference ?? 'Référence indisponible',
    tour: allocations?.[0] ?? {
      id: '',
      reference: 'Référence indisponible',
    },
  };
};

const createCashJournalFilter = ({
  dateFrom,
  dateTo,
  delivererId,
  query,
}) => ({
  ...(delivererId ? { delivererId: new ObjectId(delivererId) } : {}),
  ...(dateFrom || dateTo
    ? {
        receivedAt: {
          ...(dateFrom
            ? { $gte: createAlgiersDayBoundary(dateFrom) }
            : {}),
          ...(dateTo
            ? { $lt: createAlgiersDayBoundary(dateTo, true) }
            : {}),
        },
      }
    : {}),
  ...(query
    ? {
        $or: [
          {
            reference: {
              $options: 'i',
              $regex: escapeRegularExpression(query),
            },
          },
          {
            delivererCode: {
              $options: 'i',
              $regex: escapeRegularExpression(query),
            },
          },
          {
            delivererName: {
              $options: 'i',
              $regex: escapeRegularExpression(query),
            },
          },
        ],
      }
    : {}),
});

const createCashJournalPaymentsPipeline = ({ limit, skip }) => [
  { $sort: { receivedAt: -1, _id: -1 } },
  { $skip: skip },
  { $limit: limit },
  {
    $lookup: {
      as: 'authors',
      foreignField: '_id',
      from: 'users',
      localField: 'receivedBy',
    },
  },
  {
    $project: {
      amountInCentimes: 1,
      allocations: 1,
      author: { $arrayElemAt: ['$authors.username', 0] },
      cashRegisterCode: 1,
      cashRegisterId: 1,
      cashRegisterName: 1,
      currency: 1,
      delivererCode: 1,
      delivererId: 1,
      delivererName: 1,
      note: 1,
      receivedAt: 1,
      reference: 1,
      sourceTourCountingId: 1,
      tourId: 1,
      tourReference: 1,
    },
  },
];

export const listCashJournalFilterOptions = async ({ userId } = {}) => {
  await requireUserPermission(userId, CASH_READ_PERMISSION);

  const database = await getDatabase();
  const deliverers = await database.collection('cashPayments').aggregate([
    { $match: { delivererId: { $type: 'objectId' } } },
    { $sort: { receivedAt: -1, _id: -1 } },
    {
      $group: {
        _id: '$delivererId',
        code: { $first: '$delivererCode' },
        name: { $first: '$delivererName' },
      },
    },
    { $sort: { code: 1, name: 1, _id: 1 } },
  ]).toArray();

  return {
    deliverers: deliverers.map((deliverer) => ({
      code: deliverer.code ?? 'Livreur inconnu',
      id: deliverer._id.toString(),
      name: deliverer.name ?? '',
    })),
  };
};

export const listCashPayments = async ({
  dateFrom = '',
  dateTo = '',
  delivererId = '',
  page = 1,
  pageSize = CASH_PAYMENTS_PER_PAGE,
  query = '',
  userId,
} = {}) => {
  await requireUserPermission(userId, CASH_READ_PERMISSION);

  const state = readCashJournalState({
    au: dateTo,
    du: dateFrom,
    livreur: delivererId,
    page: String(page),
    q: query,
  });
  const normalizedPageSize = Number.isSafeInteger(pageSize)
    && pageSize > 0
    && pageSize <= 100
    ? pageSize
    : CASH_PAYMENTS_PER_PAGE;
  const filter = createCashJournalFilter(state);
  const database = await getDatabase();
  const cashPayments = database.collection('cashPayments');
  const [result = {}] = await cashPayments.aggregate([
    { $match: filter },
    {
      $facet: {
        payments: createCashJournalPaymentsPipeline({
          limit: normalizedPageSize,
          skip: (state.page - 1) * normalizedPageSize,
        }),
        summary: [
          {
            $group: {
              _id: null,
              cashRegisters: {
                $addToSet: {
                  code: '$cashRegisterCode',
                  id: '$cashRegisterId',
                  name: '$cashRegisterName',
                },
              },
              totalAmountInCentimes: { $sum: '$amountInCentimes' },
              totalItems: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]).toArray();
  const summary = result.summary?.[0] ?? {
    cashRegisters: [],
    totalAmountInCentimes: 0,
    totalItems: 0,
  };
  const totalItems = Number.isSafeInteger(summary.totalItems)
    ? summary.totalItems
    : 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const activePage = Math.min(state.page, totalPages);
  let payments = result.payments ?? [];

  if (activePage !== state.page && totalItems > 0) {
    payments = await cashPayments.aggregate([
      { $match: filter },
      ...createCashJournalPaymentsPipeline({
        limit: normalizedPageSize,
        skip: (activePage - 1) * normalizedPageSize,
      }),
    ]).toArray();
  }

  return {
    ...state,
    cashRegisters: (summary.cashRegisters ?? [])
      .map((cashRegister) => ({
        code: cashRegister.code ?? 'Caisse inconnue',
        id: cashRegister.id?.toString?.() ?? '',
        name: cashRegister.name ?? '',
      }))
      .sort((first, second) => first.code.localeCompare(second.code, 'fr')),
    page: activePage,
    pageSize: normalizedPageSize,
    payments: payments.map(serializeCashJournalPayment),
    totalAmountInCentimes:
      Number.isSafeInteger(summary.totalAmountInCentimes)
        ? summary.totalAmountInCentimes
        : null,
    totalItems,
    totalPages,
  };
};

const associateInvalidPaymentWithTours = ({
  payment,
  recordsByDelivererId,
  recordsByTourId,
}) => {
  const associatedRecords = new Set();
  const associateTour = (tourId) => {
    if (tourId instanceof ObjectId) {
      const record = recordsByTourId.get(tourId.toString());

      if (record) {
        associatedRecords.add(record);
      }
    }
  };

  associateTour(payment.tourId);

  if (Array.isArray(payment.allocations)) {
    for (const allocation of payment.allocations) {
      associateTour(allocation?.tourId);
    }
  }

  if (payment.delivererId instanceof ObjectId) {
    for (const record of recordsByDelivererId.get(
      payment.delivererId.toString(),
    ) ?? []) {
      associatedRecords.add(record);
    }
  }

  for (const record of associatedRecords) {
    record.invalidPayment = true;
  }
};

const loadCashRemainderRecords = async (
  database,
  session,
  { delivererId } = {},
) => {
  const tours = await database.collection('tours').find(
    {
      ...(delivererId instanceof ObjectId ? { delivererId } : {}),
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
      session,
    },
  ).sort({ _id: -1 }).toArray();

  if (tours.length === 0) {
    return [];
  }

  const tourIds = tours.map((tour) => tour._id);
  const delivererIds = [...new Map(
    tours
      .map((tour) => tour.delivererId)
      .filter((delivererId) => delivererId instanceof ObjectId)
      .map((delivererId) => [delivererId.toString(), delivererId]),
  ).values()];
  const countingIds = tours
    .map((tour) => tour.countingId)
    .filter((countingId) => countingId instanceof ObjectId);
  const countings = await database.collection('tourCountings').find(
    { _id: { $in: countingIds } },
    {
      projection: { countedAt: 1, totalDueInCentimes: 1, tourId: 1 },
      session,
    },
  ).toArray();
  const payments = await database.collection('cashPayments').find(
    {
      $or: [
        {
          allocations: { $exists: false },
          tourId: { $in: tourIds },
        },
        {
          allocations: { $exists: true },
          $or: [
            { 'allocations.tourId': { $in: tourIds } },
            { delivererId: { $in: delivererIds } },
            { tourId: { $in: tourIds } },
          ],
        },
      ],
    },
    {
      projection: {
        allocations: 1,
        amountInCentimes: 1,
        currency: 1,
        delivererId: 1,
        sourceTourCountingId: 1,
        tourId: 1,
      },
      session,
    },
  ).toArray();
  const countingsById = new Map(countings.map((counting) => [
    counting._id.toString(),
    counting,
  ]));
  const records = tours.map((tour) => {
    const counting = tour.countingId instanceof ObjectId
      ? countingsById.get(tour.countingId.toString())
      : null;
    let anomaly = null;

    if (!(tour.delivererId instanceof ObjectId)) {
      anomaly = 'INVALID_DELIVERER';
    } else if (
      !(tour.countingId instanceof ObjectId)
      || !counting
      || !(counting.tourId instanceof ObjectId)
      || !counting.tourId.equals(tour._id)
    ) {
      anomaly = 'MISSING_COUNTING';
    } else if (
      !Number.isSafeInteger(counting.totalDueInCentimes)
      || counting.totalDueInCentimes < 0
    ) {
      anomaly = 'INVALID_COUNTING';
    }

    return {
      ...tour,
      amountDueInCentimes: anomaly ? null : counting.totalDueInCentimes,
      amountPaidInCentimes: 0,
      anomaly,
      countedAt: counting?.countedAt ?? null,
      invalidPayment: false,
    };
  });
  const recordsByTourId = new Map(records.map((record) => [
    record._id.toString(),
    record,
  ]));
  const recordsByDelivererId = new Map();

  for (const record of records) {
    if (!(record.delivererId instanceof ObjectId)) {
      continue;
    }

    const delivererId = record.delivererId.toString();
    const delivererRecords = recordsByDelivererId.get(delivererId) ?? [];
    delivererRecords.push(record);
    recordsByDelivererId.set(delivererId, delivererRecords);
  }

  for (const payment of payments) {
    const normalizedPayment = normalizeStoredPaymentAllocations(payment);
    const paymentIsValid = normalizedPayment
      && paymentAllocationReferencesAreValid({
        normalizedPayment,
        payment,
        toursById: recordsByTourId,
      });

    if (!paymentIsValid) {
      associateInvalidPaymentWithTours({
        payment,
        recordsByDelivererId,
        recordsByTourId,
      });
      continue;
    }

    for (const allocation of normalizedPayment.allocations) {
      const record = recordsByTourId.get(allocation.tourId.toString());
      record.amountPaidInCentimes += allocation.allocatedAmountInCentimes;

      if (!Number.isSafeInteger(record.amountPaidInCentimes)) {
        record.invalidPayment = true;
      }
    }
  }

  return records.map((record) => {
    let anomaly = record.anomaly;

    if (!anomaly && record.invalidPayment) {
      anomaly = 'INVALID_PAYMENTS';
    } else if (
      !anomaly
      && record.amountPaidInCentimes > record.amountDueInCentimes
    ) {
      anomaly = 'OVERPAID';
    }

    return {
      ...record,
      allocationAnomaly: anomaly ?? (
        record.countedAt instanceof Date ? null : 'MISSING_COUNTING_DATE'
      ),
      anomaly,
      remainingDueInCentimes: anomaly
        ? null
        : record.amountDueInCentimes - record.amountPaidInCentimes,
    };
  });
};

const readAggregatedSafeInteger = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const number = typeof value === 'number'
    ? value
    : Number(value.toString?.());

  return Number.isSafeInteger(number) ? number : null;
};

const serializeCashRemainder = (remainder, blockingAnomalies = []) => ({
  blockingAnomalies,
  deliverer: {
    code: remainder.delivererCode ?? 'Livreur inconnu',
    id: remainder._id.toString(),
    name: remainder.delivererName ?? '',
  },
  remainingDueInCentimes: readAggregatedSafeInteger(
    remainder.remainingDueInCentimes,
  ),
  tourCount: readAggregatedSafeInteger(remainder.tourCount) ?? 0,
  tours: remainder.tours.map((tour) => ({
    amountDueInCentimes: readAggregatedSafeInteger(tour.amountDueInCentimes),
    amountPaidInCentimes: readAggregatedSafeInteger(tour.amountPaidInCentimes),
    countedAt: tour.countedAt?.toISOString?.() ?? null,
    id: tour.id.toString(),
    reference: tour.reference ?? 'Référence indisponible',
    remainingDueInCentimes: readAggregatedSafeInteger(
      tour.remainingDueInCentimes,
    ),
    status: tour.status,
  })),
});

const CASH_REMAINDER_ANOMALY_LABELS = Object.freeze({
  INVALID_COUNTING: 'comptage définitif invalide',
  INVALID_DELIVERER: 'identifiant de livreur invalide',
  INVALID_PAYMENTS: 'versements enregistrés incohérents',
  INVALID_TOTAL: 'total financier trop élevé',
  MISSING_COUNTING: 'comptage définitif introuvable',
  MISSING_COUNTING_DATE: 'date du comptage définitif absente',
  OVERPAID: 'versements supérieurs au montant dû',
});

const serializeCashSummaryAnomalies = (records) => records
  .filter((record) => record.allocationAnomaly)
  .map((record) => ({
    code: record.allocationAnomaly,
    label: CASH_REMAINDER_ANOMALY_LABELS[record.allocationAnomaly]
      ?? 'données financières incohérentes',
    tourReference: typeof record.reference === 'string'
      ? record.reference
      : 'Référence indisponible',
  }));

export const getDelivererCashSummary = async ({ delivererId, userId } = {}) => {
  await requireUserPermission(userId, CASH_READ_PERMISSION);

  if (typeof delivererId !== 'string' || !ObjectId.isValid(delivererId)) {
    return null;
  }

  const client = await getMongoClient();
  const database = client.db();
  const session = client.startSession();
  let records;

  try {
    records = await session.withTransaction(
      () => loadCashRemainderRecords(database, session, {
        delivererId: new ObjectId(delivererId),
      }),
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      },
    );
  } finally {
    await session.endSession();
  }

  if (records.length === 0) {
    return {
      amountDueInCentimes: null,
      amountPaidInCentimes: null,
      anomalies: [],
      countedTourCount: 0,
      reliable: true,
      remainingDueInCentimes: null,
    };
  }

  const anomalies = serializeCashSummaryAnomalies(records);

  if (anomalies.length > 0) {
    return {
      amountDueInCentimes: null,
      amountPaidInCentimes: null,
      anomalies,
      countedTourCount: records.length,
      reliable: false,
      remainingDueInCentimes: null,
    };
  }

  const totals = records.reduce((summary, record) => ({
    amountDueInCentimes:
      summary.amountDueInCentimes + record.amountDueInCentimes,
    amountPaidInCentimes:
      summary.amountPaidInCentimes + record.amountPaidInCentimes,
    remainingDueInCentimes:
      summary.remainingDueInCentimes + record.remainingDueInCentimes,
  }), {
    amountDueInCentimes: 0,
    amountPaidInCentimes: 0,
    remainingDueInCentimes: 0,
  });

  if (Object.values(totals).some((total) => !Number.isSafeInteger(total))) {
    return {
      amountDueInCentimes: null,
      amountPaidInCentimes: null,
      anomalies: [{
        code: 'INVALID_TOTAL',
        label: CASH_REMAINDER_ANOMALY_LABELS.INVALID_TOTAL,
        tourReference: 'Toutes les tournées comptées',
      }],
      countedTourCount: records.length,
      reliable: false,
      remainingDueInCentimes: null,
    };
  }

  return {
    ...totals,
    anomalies: [],
    countedTourCount: records.length,
    reliable: true,
  };
};

export const listCashRemainders = async ({
  page = 1,
  pageSize = CASH_REMAINDERS_PER_PAGE,
  query = '',
  userId,
} = {}) => {
  await requireUserPermission(userId, CASH_READ_PERMISSION);

  const state = readCashRemaindersState({
    restePage: String(page),
    resteRecherche: query,
  });
  const normalizedPageSize = Number.isSafeInteger(pageSize)
    && pageSize > 0
    && pageSize <= 100
    ? pageSize
    : CASH_REMAINDERS_PER_PAGE;
  const client = await getMongoClient();
  const database = client.db();
  const session = client.startSession();
  let records;
  let activeCashRegisters;

  try {
    [records, activeCashRegisters] = await session.withTransaction(
      async () => [
        await loadCashRemainderRecords(database, session),
        await readActiveCashRegisters({ database, session }),
      ],
      {
        readConcern: { level: 'snapshot' },
        readPreference: 'primary',
        writeConcern: { w: 'majority' },
      },
    );
  } finally {
    await session.endSession();
  }
  const normalizedQuery = state.query.toLocaleLowerCase('fr');
  const filteredRecords = records.filter((record) =>
    !normalizedQuery
    || [record.delivererCode, record.delivererName].some((value) =>
      typeof value === 'string'
      && value.toLocaleLowerCase('fr').includes(normalizedQuery)));
  const anomalyGroups = new Map();
  const allocationAnomaliesByDeliverer = new Map();
  const remainderGroups = new Map();

  for (const record of filteredRecords) {
    const tourReference = typeof record.reference === 'string'
      ? record.reference
      : 'Référence indisponible';

    if (record.anomaly) {
      const anomaly = anomalyGroups.get(record.anomaly) ?? {
        code: record.anomaly,
        count: 0,
        references: new Set(),
      };
      anomaly.count += 1;
      anomaly.references.add(tourReference);
      anomalyGroups.set(record.anomaly, anomaly);
    }

    if (
      record.allocationAnomaly
      && record.delivererId instanceof ObjectId
    ) {
      const delivererId = record.delivererId.toString();
      const allocationAnomalies = allocationAnomaliesByDeliverer.get(
        delivererId,
      ) ?? [];
      allocationAnomalies.push({
        code: record.allocationAnomaly,
        label: CASH_REMAINDER_ANOMALY_LABELS[record.allocationAnomaly]
          ?? 'données financières incohérentes',
        tourReference,
      });
      allocationAnomaliesByDeliverer.set(delivererId, allocationAnomalies);
    }

    if (
      record.anomaly
      || record.remainingDueInCentimes <= 0
      || !(record.delivererId instanceof ObjectId)
    ) {
      continue;
    }

    const delivererId = record.delivererId.toString();
    const remainder = remainderGroups.get(delivererId) ?? {
      _id: record.delivererId,
      delivererCode: record.delivererCode,
      delivererName: record.delivererName,
      remainingDueInCentimes: 0,
      tourCount: 0,
      tours: [],
    };
    remainder.remainingDueInCentimes += record.remainingDueInCentimes;
    remainder.tourCount += 1;
    remainder.tours.push({
      amountDueInCentimes: record.amountDueInCentimes,
      amountPaidInCentimes: record.amountPaidInCentimes,
      countedAt: record.countedAt,
      id: record._id,
      reference: tourReference,
      remainingDueInCentimes: record.remainingDueInCentimes,
      status: record.status,
    });
    remainderGroups.set(delivererId, remainder);
  }

  const anomalies = [...anomalyGroups.values()]
    .sort((first, second) => first.code.localeCompare(second.code, 'en'))
    .map((anomaly) => ({
      code: anomaly.code,
      count: anomaly.count,
      label: CASH_REMAINDER_ANOMALY_LABELS[anomaly.code]
        ?? 'données financières incohérentes',
      tourReferences: [...anomaly.references]
        .sort((first, second) => first.localeCompare(second, 'fr')),
    }));
  const remainders = [...remainderGroups.values()].sort((first, second) =>
    (first.delivererCode ?? '').localeCompare(
      second.delivererCode ?? '',
      'fr',
    )
      || (first.delivererName ?? '').localeCompare(
        second.delivererName ?? '',
        'fr',
      )
      || first._id.toString().localeCompare(second._id.toString(), 'en'));
  const totalItems = remainders.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const activePage = Math.min(state.page, totalPages);
  const paginatedRemainders = remainders.slice(
    (activePage - 1) * normalizedPageSize,
    activePage * normalizedPageSize,
  );
  const totalRemainingDueInCentimes = remainders.reduce(
    (total, remainder) => total + remainder.remainingDueInCentimes,
    0,
  );
  const cashRegisterSelection = selectUniqueActiveCashRegister(
    activeCashRegisters,
  );

  return {
    anomalies,
    anomalyCount: anomalies.reduce((total, anomaly) => total + anomaly.count, 0),
    cashRegister: cashRegisterSelection.cashRegister
      ? {
          code: cashRegisterSelection.cashRegister.code,
          id: cashRegisterSelection.cashRegister._id.toString(),
          name: cashRegisterSelection.cashRegister.name,
        }
      : null,
    cashRegisterError: cashRegisterSelection.error,
    page: activePage,
    pageSize: normalizedPageSize,
    query: state.query,
    remainders: paginatedRemainders.map((remainder) =>
      serializeCashRemainder(
        remainder,
        allocationAnomaliesByDeliverer.get(remainder._id.toString()) ?? [],
      )),
    totalItems,
    totalPages,
    totalRemainingDueInCentimes: readAggregatedSafeInteger(
      totalRemainingDueInCentimes,
    ),
  };
};

export const formatCashPaymentDateTime = (
  value,
  timeZone = 'Africa/Algiers',
) => {
  if (!value) {
    return 'Non renseignée';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Non renseignée';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    dateStyle: 'medium',
    hourCycle: 'h23',
    timeStyle: 'short',
    timeZone,
  }).format(date);
};

export const formatCashAmount = (amountInCentimes) =>
  Number.isSafeInteger(amountInCentimes) && amountInCentimes >= 0
    ? `${new Intl.NumberFormat('fr-DZ', {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }).format(amountInCentimes / 100)} DA`
    : 'Non calculable';

const readTourAndCounting = async ({ database, session, tourId }) => {
  const tour = await database.collection('tours').findOne(
    {
      _id: tourId,
      status: { $in: [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED] },
    },
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

  const [cashRegisters, resolvedPayments] = await Promise.all([
    readActiveCashRegisters({ database }),
    readStoredTourPaymentResolution({
      database,
      delivererId: tourAndCounting.tour.delivererId,
      sourceTourCountingId: tourAndCounting.counting._id,
      tourId: tourObjectId,
    }),
  ]);
  const cashRegisterSelection = selectUniqueActiveCashRegister(cashRegisters);
  const amountPaidInCentimes = resolvedPayments?.amountInCentimes ?? null;
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
    resolvedPayments: resolvedPayments.payments,
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
    paymentCount: resolvedPayments.payments.length,
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
  serialize = serializePayment,
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
    payment: serialize(payment),
    replayed: true,
  };
};

const throwCashRegisterSelectionError = async ({
  cashRegisters,
  database,
  expectedCashRegisterId,
  session,
  summary = null,
}) => {
  if (cashRegisters.length === 0) {
    const expectedCashRegister = await database.collection('cashRegisters')
      .findOne({ _id: expectedCashRegisterId }, { session });

    throw new CashPaymentValidationError(
      {
        form: expectedCashRegister
          ? 'La caisse du récapitulatif n’est plus active. Vérifiez les chiffres actualisés puis confirmez à nouveau.'
          : 'Aucune caisse active en DZD n’est disponible.',
      },
      { stale: true, summary },
    );
  }

  if (cashRegisters.length > 1) {
    throw new CashPaymentValidationError(
      {
        form: 'Plusieurs caisses actives en DZD sont disponibles ; aucune ne peut être choisie automatiquement.',
      },
      { stale: true, summary },
    );
  }

  throw new CashPaymentValidationError(
    {
      form: 'La caisse du récapitulatif a changé. Vérifiez les chiffres actualisés puis confirmez à nouveau.',
    },
    { stale: true, summary },
  );
};

const createDelivererCashPaymentPreview = ({ amount, records }) => {
  const blockingAnomalies = records
    .filter((record) => record.allocationAnomaly)
    .map((record) => ({
      code: record.allocationAnomaly,
      tourReference: record.reference ?? 'Référence indisponible',
    }));
  const tours = records
    .filter((record) => !record.anomaly && record.remainingDueInCentimes > 0)
    .map((record) => ({
      countedAt: record.countedAt?.toISOString?.() ?? null,
      id: record._id.toString(),
      reference: record.reference ?? 'Référence indisponible',
      remainingDueInCentimes: record.remainingDueInCentimes,
    }));

  return calculateDelivererCashAllocationPreview({
    amount,
    blockingAnomalies,
    tours,
  });
};

const isConfirmationKeyDuplicate = (error) => error?.code === 11000
  && (
    error?.keyPattern?.confirmationKey
    || error?.message?.includes('unique_cash_payment_confirmation_key')
  );

export const recordTourCashPayment = async ({
  amount,
  confirmationKey,
  expectedCashRegisterId,
  expectedRemainingDueInCentimes,
  note,
  receivedBy,
  tourId,
}) => {
  const normalizedConfirmationKey = normalizeText(confirmationKey)
    .toLocaleLowerCase('en');
  const normalizedCashRegisterId = normalizeText(expectedCashRegisterId);
  const normalizedExpectedRemainingDueInCentimes = normalizeText(
    expectedRemainingDueInCentimes,
  );
  const normalizedNote = normalizeText(note);
  const normalizedReceivedBy = normalizeText(receivedBy);
  const normalizedTourId = normalizeText(tourId);
  const amountInCentimes = parseCashPaymentAmountInCentimes(amount);
  const parsedExpectedRemainingDueInCentimes = /^\d+$/u.test(
    normalizedExpectedRemainingDueInCentimes,
  )
    ? Number(normalizedExpectedRemainingDueInCentimes)
    : null;
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

  if (
    !Number.isSafeInteger(parsedExpectedRemainingDueInCentimes)
    || parsedExpectedRemainingDueInCentimes < 0
  ) {
    errors.form = 'Le reste du récapitulatif est invalide. Rechargez la page.';
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

      const preliminaryTour = await database.collection('tours').findOne(
        {
          _id: tourObjectId,
          status: { $in: [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED] },
        },
        {
          projection: { delivererId: 1 },
          session,
        },
      );

      if (
        !preliminaryTour
        || !(preliminaryTour.delivererId instanceof ObjectId)
      ) {
        throw new CashPaymentValidationError({
          form: 'Cette tournée n’est pas comptée ou terminée, ou n’existe plus.',
        });
      }

      const deliverer = await coordinateCashDeliverer({
        database,
        delivererId: preliminaryTour.delivererId,
        session,
      });

      if (!deliverer) {
        throw new CashPaymentValidationError({
          form: 'Le livreur historique de cette tournée est introuvable.',
        });
      }

      const tour = await coordinateCashTour({
        database,
        filter: {
          delivererId: preliminaryTour.delivererId,
          status: { $in: [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED] },
        },
        projection: {
          countingId: 1,
          delivererCode: 1,
          delivererId: 1,
          delivererName: 1,
          reference: 1,
        },
        session,
        tourId: tourObjectId,
      });

      if (!tour || !(tour.countingId instanceof ObjectId)) {
        throw new CashPaymentValidationError({
          form: 'Cette tournée a changé pendant la préparation du versement.',
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

      const cashRegister = await coordinateCashRegister({
        cashRegisterId: cashRegisterObjectId,
        database,
        filter: { active: true, currency: CASH_CURRENCY },
        session,
      });

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

      const previousPayments = await readStoredTourPaymentResolution({
        database,
        delivererId: tour.delivererId,
        session,
        sourceTourCountingId: tour.countingId,
        tourId: tourObjectId,
      });
      const amountPaidInCentimes = previousPayments?.amountInCentimes ?? null;

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

      if (remainingDueInCentimes !== parsedExpectedRemainingDueInCentimes) {
        throw new CashPaymentValidationError(
          {
            form: 'Le reste de cette tournée a changé. Vérifiez les chiffres actualisés puis confirmez à nouveau.',
          },
          { stale: true },
        );
      }

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
      return { errors: error.errors, stale: error.stale };
    }

    if (isConfirmationKeyDuplicate(error)) {
      for (const permission of CASH_PAYMENT_RECORD_PERMISSIONS) {
        await requireUserPermission(normalizedReceivedBy, permission, {
          database,
        });
      }

      try {
        const concurrentPayment = await readExistingPayment({
          confirmationKey: normalizedConfirmationKey,
          database,
          requestDigest,
        });

        if (concurrentPayment) {
          return concurrentPayment;
        }
      } catch (validationError) {
        if (validationError instanceof CashPaymentValidationError) {
          return {
            errors: validationError.errors,
            stale: validationError.stale,
          };
        }

        throw validationError;
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

export const recordDelivererCashPayment = async ({
  amount,
  confirmationKey,
  delivererId,
  expectedAllocationSummary,
  expectedCashRegisterId,
  expectedDigest,
  expectedSummary,
  expectedSummaryDigest,
  note,
  receivedBy,
}) => {
  const normalizedConfirmationKey = normalizeText(confirmationKey)
    .toLocaleLowerCase('en');
  const normalizedCashRegisterId = normalizeText(expectedCashRegisterId);
  const normalizedDelivererId = normalizeText(delivererId);
  const normalizedNote = normalizeText(note);
  const normalizedReceivedBy = normalizeText(receivedBy);
  const amountInCentimes = parseCashPaymentAmountInCentimes(amount);
  const submittedSummary = expectedSummary ?? expectedAllocationSummary;
  const normalizedExpectedSummary = submittedSummary === undefined
    ? null
    : normalizeDelivererPaymentSummary(submittedSummary);
  const suppliedSummaryDigest = normalizeText(
    expectedSummaryDigest ?? expectedDigest,
  ).toLocaleLowerCase('en');
  const derivedSummaryDigest = normalizedExpectedSummary
    ? createDelivererCashPaymentSummaryDigest(normalizedExpectedSummary)
    : '';
  const normalizedExpectedSummaryDigest = suppliedSummaryDigest
    || derivedSummaryDigest;
  const errors = {};

  if (!CONFIRMATION_KEY_PATTERN.test(normalizedConfirmationKey)) {
    errors.form = 'La clé de confirmation est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedCashRegisterId)) {
    errors.form = 'La caisse du récapitulatif est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedDelivererId)) {
    errors.form = 'Ce livreur n’existe plus.';
  }

  if (!ObjectId.isValid(normalizedReceivedBy)) {
    errors.form = 'L’auteur du versement est invalide.';
  }

  if (amountInCentimes === null) {
    errors.amount = 'Saisissez un montant strictement positif avec deux décimales maximum.';
  }

  if (normalizedNote.length > CASH_PAYMENT_NOTE_MAX_LENGTH) {
    errors.note = `La note ne peut pas dépasser ${CASH_PAYMENT_NOTE_MAX_LENGTH} caractères.`;
  }

  if (
    submittedSummary !== undefined
    && normalizedExpectedSummary === null
  ) {
    errors.form = 'Le récapitulatif confirmé est invalide. Rechargez la page.';
  }

  if (!/^[\da-f]{64}$/u.test(normalizedExpectedSummaryDigest)) {
    errors.form = 'Le récapitulatif confirmé est invalide. Rechargez la page.';
  } else if (
    suppliedSummaryDigest
    && derivedSummaryDigest
    && suppliedSummaryDigest !== derivedSummaryDigest
  ) {
    errors.form = 'Le digest ne correspond pas au récapitulatif confirmé.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const cashRegisterObjectId = new ObjectId(normalizedCashRegisterId);
  const delivererObjectId = new ObjectId(normalizedDelivererId);
  const receivedByObjectId = new ObjectId(normalizedReceivedBy);
  const requestDigest = createDelivererPaymentRequestDigest({
    amountInCentimes,
    cashRegisterId: normalizedCashRegisterId,
    delivererId: normalizedDelivererId,
    expectedSummaryDigest: normalizedExpectedSummaryDigest,
    note: normalizedNote,
    receivedBy: normalizedReceivedBy,
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
        serialize: serializeDelivererPayment,
        session,
      });

      if (existingPayment) {
        return existingPayment;
      }

      const deliverer = await coordinateCashDeliverer({
        database,
        delivererId: delivererObjectId,
        session,
      });

      if (!deliverer) {
        throw new CashPaymentValidationError({
          form: 'Ce livreur n’existe plus.',
        });
      }

      const eligibleTours = await database.collection('tours').find(
        {
          delivererId: delivererObjectId,
          status: { $in: [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED] },
        },
        { projection: { _id: 1 }, session },
      ).sort({ _id: 1 }).toArray();
      const lockedTours = await coordinateCashTours({
        database,
        filter: {
          delivererId: delivererObjectId,
          status: { $in: [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED] },
        },
        projection: { _id: 1 },
        session,
        tourIds: eligibleTours.map((tour) => tour._id),
      });

      if (!lockedTours) {
        throw new CashPaymentValidationError(
          {
            form: 'Les tournées du livreur ont changé. Vérifiez le récapitulatif actualisé avant de confirmer à nouveau.',
          },
          { stale: true },
        );
      }

      const records = await loadCashRemainderRecords(database, session, {
        delivererId: delivererObjectId,
      });
      const summary = createDelivererCashPaymentPreview({ amount, records });
      const allocationSummaryDigest =
        createDelivererCashPaymentSummaryDigest(summary);

      if (
        !allocationSummaryDigest
        || summary.blocked
        || summary.error
        || summary.amountInCentimes === null
      ) {
        throw new CashPaymentValidationError(
          {
            form: summary.error
              ?? 'Le récapitulatif du livreur ne peut pas être calculé.',
          },
          { stale: true, summary },
        );
      }

      if (allocationSummaryDigest !== normalizedExpectedSummaryDigest) {
        throw new CashPaymentValidationError(
          {
            form: 'La répartition a changé. Vérifiez le récapitulatif actualisé avant de confirmer à nouveau.',
          },
          { stale: true, summary },
        );
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
          summary,
        });
      }

      const cashRegister = await coordinateCashRegister({
        cashRegisterId: cashRegisterObjectId,
        database,
        filter: { active: true, currency: CASH_CURRENCY },
        session,
      });

      if (!cashRegister) {
        throw new CashPaymentValidationError(
          {
            form: 'La caisse du récapitulatif n’est plus active. Vérifiez les chiffres actualisés puis confirmez à nouveau.',
          },
          { stale: true, summary },
        );
      }

      const recordsByTourId = new Map(records.map((record) => [
        record._id.toString(),
        record,
      ]));
      const allocations = summary.allocations.map((allocation) => {
        const record = recordsByTourId.get(allocation.tourId);

        if (!record || !(record.countingId instanceof ObjectId)) {
          throw new CashPaymentValidationError(
            {
              form: 'Une tournée de la répartition est devenue incohérente.',
            },
            { stale: true, summary },
          );
        }

        return {
          allocatedAmountInCentimes: allocation.allocatedAmountInCentimes,
          amountDueInCentimes: record.amountDueInCentimes,
          amountPaidBeforeInCentimes: record.amountPaidInCentimes,
          countedAt: record.countedAt,
          remainingAfterPaymentInCentimes:
            allocation.remainingAfterPaymentInCentimes,
          remainingBeforePaymentInCentimes:
            allocation.remainingBeforePaymentInCentimes,
          sourceTourCountingId: record.countingId,
          tourId: record._id,
          tourReference: allocation.tourReference,
        };
      });
      const payment = {
        _id: paymentId,
        allocationSummaryDigest,
        allocations,
        amountInCentimes: summary.amountInCentimes,
        cashRegisterCode: cashRegister.code,
        cashRegisterId: cashRegister._id,
        cashRegisterName: cashRegister.name,
        confirmationKey: normalizedConfirmationKey,
        currency: CASH_CURRENCY,
        delivererCode: deliverer.code ?? null,
        delivererId: deliverer._id,
        delivererName: deliverer.name ?? null,
        mode: CASH_PAYMENT_MODE,
        ...(normalizedNote ? { note: normalizedNote } : {}),
        receivedAt,
        receivedBy: receivedByObjectId,
        reference: createPaymentReference(paymentId),
        requestDigest,
        totalRemainingAfterPaymentInCentimes:
          summary.totalRemainingAfterPaymentInCentimes,
        totalRemainingBeforePaymentInCentimes:
          summary.totalRemainingDueInCentimes,
      };

      await database.collection('cashPayments').insertOne(payment, {
        session,
      });

      return {
        payment: serializeDelivererPayment(payment),
        replayed: false,
        summary,
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof CashPaymentValidationError) {
      return {
        errors: error.errors,
        stale: error.stale,
        ...(error.summary ? { summary: error.summary } : {}),
      };
    }

    if (isConfirmationKeyDuplicate(error)) {
      for (const permission of CASH_PAYMENT_RECORD_PERMISSIONS) {
        await requireUserPermission(normalizedReceivedBy, permission, {
          database,
        });
      }

      try {
        const concurrentPayment = await readExistingPayment({
          confirmationKey: normalizedConfirmationKey,
          database,
          requestDigest,
          serialize: serializeDelivererPayment,
        });

        if (concurrentPayment) {
          return concurrentPayment;
        }
      } catch (validationError) {
        if (validationError instanceof CashPaymentValidationError) {
          return {
            errors: validationError.errors,
            stale: validationError.stale,
          };
        }

        throw validationError;
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
