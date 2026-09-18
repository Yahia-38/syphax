import { ObjectId } from 'mongodb';

import { getUserPermissions, requireUserPermission } from './access.js';
import {
  CASH_READ_PERMISSION,
  createAlgiersDayBoundary,
  normalizeStoredPaymentAllocations,
} from './cash-payments.js';
import {
  DAY_RECAP_FILTERS,
  buildDayRecapHref,
  buildDayTourHref,
  normalizeDayRecapDate,
} from './day-recap-navigation.js';
import { getDatabase } from './mongodb.js';
import { calculateLoadedLineValue } from './tour-counting-calculations.js';
import {
  TOUR_EXPENSE_DECLARATION_STATUS_DECLARED,
  TOUR_EXPENSE_DECLARATION_STATUS_HISTORICAL_MISSING,
  TOUR_EXPENSE_DECLARATION_STATUS_MISSING,
  normalizeStoredTourExpenseDeclaration,
} from './tour-expense-records.js';
import { TOUR_EXPENSE_READ_PERMISSION } from './tour-expenses.js';
import { LOADED_RESERVATION_STATUS } from './tour-reservations.js';
import {
  TOUR_STATUS_CANCELLED,
  TOUR_STATUS_CLOSED,
  TOUR_STATUS_COUNTED,
  TOUR_STATUS_LOADED,
  TOUR_STATUS_PREPARATION,
  formatTourDateInput,
} from './tours.js';

export {
  DAY_RECAP_FILTERS,
  DAY_RECAP_PARAMETERS,
  buildDayRecapHref,
  buildDayTourHref,
  formatDayRecapShortDate,
  isDayRecapHref,
  normalizeDayRecapDate,
  readDayRecapHrefDate,
  readDayRecapState,
  validateDayRecapHref,
} from './day-recap-navigation.js';

export const DAY_RECAP_READ_PERMISSION = 'tours.read';
export const DAY_RECAP_TOURS_PER_PAGE = 8;

// Each milestone is a real transition of the workflow, in the order it happens.
export const DAY_RECAP_STAGES = Object.freeze([
  Object.freeze({ key: 'loaded', label: 'Chargé' }),
  Object.freeze({ key: 'returned', label: 'Rentré' }),
  Object.freeze({ key: 'settled', label: 'Réglé' }),
  Object.freeze({ key: 'closed', label: 'Terminée' }),
]);

export const DAY_RECAP_FINANCIAL_FILTERS = Object.freeze(['impayes']);

export const DAY_RECAP_ANOMALY_LABELS = Object.freeze({
  INVALID_COUNTING: 'comptage définitif invalide',
  INVALID_DELIVERER: 'identifiant de livreur invalide',
  INVALID_EXPENSE_DECLARATION: 'déclaration de frais incohérente',
  INVALID_LOADING_VALUE: 'valeur chargée invalide',
  INVALID_PAYMENTS: 'versements enregistrés incohérents',
  INVALID_RETURN_VALUE: 'comptage supérieur à la valeur chargée',
  MISSING_COUNTING: 'comptage définitif introuvable',
  OVERPAID: 'versements supérieurs au montant dû',
});

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

export const todayInAlgiers = (now = new Date()) =>
  formatTourDateInput(now);

export const shiftDayRecapDate = (value, offset) => {
  const normalizedDate = normalizeDayRecapDate(value);

  if (!normalizedDate || !Number.isSafeInteger(offset)) {
    return '';
  }

  const [year, month, day] = normalizedDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day));

  shifted.setUTCDate(shifted.getUTCDate() + offset);

  return Number.isNaN(shifted.getTime())
    ? ''
    : shifted.toISOString().slice(0, 10);
};

export const formatDayRecapDate = (value) => {
  const normalizedDate = normalizeDayRecapDate(value);

  if (!normalizedDate) {
    return 'Date non renseignée';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Algiers',
    weekday: 'long',
    year: 'numeric',
  }).format(new Date(`${normalizedDate}T12:00:00.000Z`));
};

// References carry a 24 character identifier: only its tail tells rows apart.
export const formatDayTourReference = (value) => {
  const normalizedValue = normalizeText(value);
  const match = /^TRN-([\dA-F]{24})$/iu.exec(normalizedValue);

  return match
    ? `TRN-…${match[1].slice(-6).toLocaleUpperCase('en')}`
    : normalizedValue || 'Référence indisponible';
};

export const formatDayRecapTime = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('fr-DZ', {
        hourCycle: 'h23',
        timeStyle: 'short',
        timeZone: 'Africa/Algiers',
      }).format(date);
};

const isAmount = (value) => Number.isSafeInteger(value) && value >= 0;

// Stages are independent: a tour can be closed while a remainder is still due.
export const readDayTourStages = ({
  amountPaidInCentimes = null,
  financialsVisible = true,
  remainingDueInCentimes = null,
  status,
}) => {
  const returned = [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED].includes(status);

  return [
    returned || status === TOUR_STATUS_LOADED,
    returned,
    financialsVisible && returned && isAmount(amountPaidInCentimes)
      ? remainingDueInCentimes === 0
      : null,
    status === TOUR_STATUS_CLOSED,
  ];
};

export const summarizeDayTour = (record) => {
  const {
    amountPaidInCentimes = null,
    anomaly = null,
    financialsVisible = true,
    grossSalesInCentimes = null,
    loadedValueInCentimes = null,
    remainingDueInCentimes = null,
    status,
  } = record ?? {};
  const stages = readDayTourStages({
    amountPaidInCentimes,
    financialsVisible,
    remainingDueInCentimes,
    status,
  });

  if (status === TOUR_STATUS_CANCELLED) {
    return { headline: { amountInCentimes: null, label: 'Annulée', tone: 'muted' }, stages };
  }

  if (anomaly) {
    return {
      headline: {
        amountInCentimes: null,
        label: 'Données à vérifier',
        tone: 'danger',
      },
      stages,
    };
  }

  if (status === TOUR_STATUS_PREPARATION) {
    return {
      headline: {
        amountInCentimes: null,
        label: 'Chargement à valider',
        tone: 'muted',
      },
      stages,
    };
  }

  if (status === TOUR_STATUS_LOADED) {
    return {
      headline: {
        amountInCentimes: loadedValueInCentimes,
        label: 'En tournée',
        suffix: 'de marchandise',
        tone: 'neutral',
      },
      stages,
    };
  }

  if (!financialsVisible) {
    return {
      headline: {
        amountInCentimes: grossSalesInCentimes,
        label: status === TOUR_STATUS_CLOSED ? 'Terminée' : 'Rentré',
        suffix: 'vendus',
        tone: 'neutral',
      },
      stages,
    };
  }

  if (remainingDueInCentimes > 0) {
    return {
      headline: {
        amountInCentimes: remainingDueInCentimes,
        label: 'Reste à encaisser',
        tone: 'warning',
      },
      stages,
    };
  }

  return {
    headline: {
      amountInCentimes: amountPaidInCentimes,
      label: status === TOUR_STATUS_CLOSED ? 'Soldé' : 'Réglé, à terminer',
      suffix: 'versés',
      tone: 'positive',
    },
    stages,
  };
};

// The segments decompose the goods that went out and always add up to it:
// loaded = returns + gross, and gross = expenses + paid + remaining.
export const buildDaySegments = (totals = {}, { financialsVisible = true } = {}) => {
  const total = totals.sortieInCentimes;

  if (!isAmount(total) || total === 0) {
    return [];
  }

  const definitions = financialsVisible
    ? [
        ['paid', 'Encaissé', totals.paidInCentimes],
        ['remaining', 'Reste dû', totals.remainingInCentimes],
        ['expenses', 'Frais', totals.expensesInCentimes],
        ['returns', 'Retours', totals.returnsValueInCentimes],
        ['onTour', 'En tournée', totals.onTourValueInCentimes],
      ]
    : [
        ['sold', 'Vendu', totals.grossSalesInCentimes],
        ['returns', 'Retours', totals.returnsValueInCentimes],
        ['onTour', 'En tournée', totals.onTourValueInCentimes],
      ];

  return definitions
    .filter(([, , amountInCentimes]) =>
      Number.isSafeInteger(amountInCentimes) && amountInCentimes > 0)
    .map(([key, label, amountInCentimes]) => ({
      amountInCentimes,
      key,
      label,
      share: (amountInCentimes / total) * 100,
    }));
};

const DAY_ALERT_ORDER = Object.freeze([
  'ANOMALY',
  'NOT_RETURNED',
  'REMAINING_DUE',
  'MISSING_EXPENSES',
  'TO_CLOSE',
  'PREPARATION',
]);

export const buildDayAlerts = (
  records = [],
  { date = '', returnHref = '/', today = todayInAlgiers() } = {},
) => {
  const isPastDay = Boolean(normalizeDayRecapDate(date))
    && normalizeDayRecapDate(date) < normalizeDayRecapDate(today);
  const alerts = [];

  for (const record of records) {
    const deliverer = record.deliverer?.name || record.deliverer?.code || 'Livreur inconnu';
    const push = (code, label) => alerts.push({
      code,
      deliverer,
      href: buildDayTourHref({ returnHref, tourId: record.id }),
      label,
      tourReference: record.reference,
    });

    if (record.status === TOUR_STATUS_CANCELLED) {
      continue;
    }

    if (record.anomaly) {
      push('ANOMALY', `données à vérifier — ${DAY_RECAP_ANOMALY_LABELS[record.anomaly] ?? 'incohérence financière'}`);
      continue;
    }

    if (record.status === TOUR_STATUS_PREPARATION && isPastDay) {
      push('PREPARATION', 'chargement jamais validé');
      continue;
    }

    if (record.status === TOUR_STATUS_LOADED && isPastDay) {
      push('NOT_RETURNED', 'parti, jamais rentré');
      continue;
    }

    if (record.remainingDueInCentimes > 0) {
      push('REMAINING_DUE', 'reste à encaisser');
    }

    if (record.status === TOUR_STATUS_COUNTED) {
      push(
        record.expenseDeclarationStatus === TOUR_EXPENSE_DECLARATION_STATUS_DECLARED
          ? 'TO_CLOSE'
          : 'MISSING_EXPENSES',
        record.expenseDeclarationStatus === TOUR_EXPENSE_DECLARATION_STATUS_DECLARED
          ? 'tournée à terminer'
          : 'frais non déclarés',
      );
    }
  }

  return alerts.sort((first, second) =>
    DAY_ALERT_ORDER.indexOf(first.code) - DAY_ALERT_ORDER.indexOf(second.code));
};

const matchesDayFilter = (record, filter) => {
  if (filter === 'tournee') {
    return record.status === TOUR_STATUS_LOADED;
  }

  if (filter === 'rentres') {
    return record.status === TOUR_STATUS_COUNTED;
  }

  if (filter === 'impayes') {
    return record.remainingDueInCentimes > 0;
  }

  if (filter === 'terminees') {
    return record.status === TOUR_STATUS_CLOSED;
  }

  return true;
};

const matchesDayQuery = (record, query) => {
  if (!query) {
    return true;
  }

  const haystack = [
    record.deliverer?.name,
    record.deliverer?.code,
    record.reference,
  ].filter((value) => typeof value === 'string').join(' ').toLocaleLowerCase('fr');

  return haystack.includes(query.toLocaleLowerCase('fr'));
};

const readLoadedValues = (reservations) => {
  const values = new Map();

  for (const reservation of reservations) {
    if (!(reservation.tourId instanceof ObjectId)) {
      continue;
    }

    const tourId = reservation.tourId.toString();
    const current = values.get(tourId);

    if (current === null) {
      continue;
    }

    const { error, priceAvailable, valueInCentimes } = calculateLoadedLineValue(
      reservation,
    );

    if (error || !priceAvailable || !isAmount(valueInCentimes)) {
      values.set(tourId, null);
      continue;
    }

    const total = (current ?? 0) + valueInCentimes;
    values.set(tourId, Number.isSafeInteger(total) ? total : null);
  }

  return values;
};

const readTourPayments = (payments, tourIds) => {
  const paid = new Map();
  const invalid = new Set();

  for (const payment of payments) {
    const normalizedPayment = normalizeStoredPaymentAllocations(payment);

    if (!normalizedPayment) {
      const tourId = payment.tourId instanceof ObjectId
        ? payment.tourId.toString()
        : '';

      for (const allocation of Array.isArray(payment.allocations) ? payment.allocations : []) {
        if (allocation?.tourId instanceof ObjectId && tourIds.has(allocation.tourId.toString())) {
          invalid.add(allocation.tourId.toString());
        }
      }

      if (tourIds.has(tourId)) {
        invalid.add(tourId);
      }

      continue;
    }

    for (const allocation of normalizedPayment.allocations) {
      const tourId = allocation.tourId.toString();

      if (!tourIds.has(tourId)) {
        continue;
      }

      const total = (paid.get(tourId) ?? 0) + allocation.allocatedAmountInCentimes;

      if (Number.isSafeInteger(total)) {
        paid.set(tourId, total);
      } else {
        invalid.add(tourId);
      }
    }
  }

  return { invalid, paid };
};

const buildDayRecord = ({
  counting,
  declaration,
  financialsVisible,
  invalidPayment,
  loadedValueInCentimes,
  paidInCentimes,
  tour,
}) => {
  const counted = [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED].includes(tour.status);
  const cancelled = tour.status === TOUR_STATUS_CANCELLED;
  let anomaly = null;

  if (!(tour.delivererId instanceof ObjectId)) {
    anomaly = 'INVALID_DELIVERER';
  } else if (counted && (!counting || !counting.tourId?.equals?.(tour._id))) {
    anomaly = 'MISSING_COUNTING';
  } else if (counted && !isAmount(counting.totalDueInCentimes)) {
    anomaly = 'INVALID_COUNTING';
  } else if (!cancelled && tour.status !== TOUR_STATUS_PREPARATION && loadedValueInCentimes === null) {
    anomaly = 'INVALID_LOADING_VALUE';
  }

  const grossSalesInCentimes = anomaly || !counted
    ? null
    : counting.totalDueInCentimes;
  const returnsValueInCentimes = anomaly || !counted
    ? null
    : loadedValueInCentimes - grossSalesInCentimes;

  if (!anomaly && counted && returnsValueInCentimes < 0) {
    anomaly = 'INVALID_RETURN_VALUE';
  }

  let expenseDeclarationStatus = tour.status === TOUR_STATUS_CLOSED
    ? TOUR_EXPENSE_DECLARATION_STATUS_HISTORICAL_MISSING
    : TOUR_EXPENSE_DECLARATION_STATUS_MISSING;
  let totalExpensesInCentimes = 0;

  if (!anomaly && counted && declaration) {
    const normalizedDeclaration = normalizeStoredTourExpenseDeclaration(
      declaration,
      { sourceTourCountingId: counting._id, tourId: tour._id },
    );

    if (normalizedDeclaration) {
      expenseDeclarationStatus = TOUR_EXPENSE_DECLARATION_STATUS_DECLARED;
      totalExpensesInCentimes = normalizedDeclaration.totalInCentimes;
    } else {
      anomaly = 'INVALID_EXPENSE_DECLARATION';
    }
  }

  const netDueInCentimes = anomaly || !counted
    ? null
    : grossSalesInCentimes - totalExpensesInCentimes;

  if (!anomaly && counted && !isAmount(netDueInCentimes)) {
    anomaly = 'INVALID_EXPENSE_DECLARATION';
  }

  const amountPaidInCentimes = anomaly || !counted ? null : paidInCentimes ?? 0;

  if (!anomaly && counted && invalidPayment) {
    anomaly = 'INVALID_PAYMENTS';
  } else if (!anomaly && counted && amountPaidInCentimes > netDueInCentimes) {
    anomaly = 'OVERPAID';
  }

  const record = {
    amountPaidInCentimes: anomaly ? null : amountPaidInCentimes,
    anomaly,
    closedAt: tour.closedAt?.toISOString?.() ?? null,
    countedAt: counting?.countedAt?.toISOString?.() ?? null,
    deliverer: {
      code: tour.delivererCode ?? '',
      id: tour.delivererId?.toString?.() ?? '',
      name: tour.delivererName ?? 'Livreur inconnu',
    },
    expenseDeclarationStatus,
    financialsVisible,
    grossSalesInCentimes: anomaly ? null : grossSalesInCentimes,
    id: tour._id.toString(),
    loadedAt: tour.loadedAt?.toISOString?.() ?? null,
    loadedValueInCentimes: anomaly ? null : loadedValueInCentimes,
    netDueInCentimes: anomaly ? null : netDueInCentimes,
    reference: tour.reference ?? 'Référence indisponible',
    remainingDueInCentimes: anomaly || !counted
      ? null
      : netDueInCentimes - amountPaidInCentimes,
    returnsValueInCentimes: anomaly ? null : returnsValueInCentimes,
    status: tour.status,
    totalExpensesInCentimes: anomaly || !counted ? null : totalExpensesInCentimes,
  };

  return { ...record, ...summarizeDayTour(record) };
};

const addAmount = (totals, key, amountInCentimes) => {
  if (totals[key] === null) {
    return;
  }

  const total = totals[key] + amountInCentimes;
  totals[key] = Number.isSafeInteger(total) ? total : null;
};

const summarizeDayRecords = (records, { financialsVisible }) => {
  const totals = {
    expensesInCentimes: financialsVisible ? 0 : null,
    grossSalesInCentimes: 0,
    onTourValueInCentimes: 0,
    paidInCentimes: financialsVisible ? 0 : null,
    remainingInCentimes: financialsVisible ? 0 : null,
    returnsValueInCentimes: 0,
    sortieInCentimes: 0,
  };
  const counts = {
    cancelled: 0,
    closed: 0,
    onTour: 0,
    preparation: 0,
    returned: 0,
    shipped: 0,
  };
  const deliverers = new Set();
  let complete = true;

  for (const record of records) {
    if (record.status === TOUR_STATUS_CANCELLED) {
      counts.cancelled += 1;
      continue;
    }

    if (record.status === TOUR_STATUS_PREPARATION) {
      counts.preparation += 1;
      continue;
    }

    if (record.anomaly) {
      complete = false;
      continue;
    }

    if (record.deliverer.id) {
      deliverers.add(record.deliverer.id);
    }

    counts.shipped += 1;
    addAmount(totals, 'sortieInCentimes', record.loadedValueInCentimes);

    if (record.status === TOUR_STATUS_LOADED) {
      counts.onTour += 1;
      addAmount(totals, 'onTourValueInCentimes', record.loadedValueInCentimes);
      continue;
    }

    counts.returned += 1;

    if (record.status === TOUR_STATUS_CLOSED) {
      counts.closed += 1;
    }

    addAmount(totals, 'grossSalesInCentimes', record.grossSalesInCentimes);
    addAmount(totals, 'returnsValueInCentimes', record.returnsValueInCentimes);

    if (financialsVisible) {
      addAmount(totals, 'expensesInCentimes', record.totalExpensesInCentimes);
      addAmount(totals, 'paidInCentimes', record.amountPaidInCentimes);
      addAmount(totals, 'remainingInCentimes', record.remainingDueInCentimes);
    }
  }

  return {
    ...totals,
    complete,
    counts: { ...counts, deliverers: deliverers.size },
    segments: buildDaySegments(totals, { financialsVisible }),
  };
};

const readDayCash = async ({ database, dayTourIds, date }) => {
  const dayStart = createAlgiersDayBoundary(date);
  const dayEnd = createAlgiersDayBoundary(date, true);
  const [payments, withdrawals] = await Promise.all([
    database.collection('cashPayments').find(
      { receivedAt: { $gte: dayStart, $lt: dayEnd } },
      {
        projection: {
          allocations: 1,
          amountInCentimes: 1,
          currency: 1,
          sourceTourCountingId: 1,
          tourId: 1,
        },
      },
    ).toArray(),
    database.collection('cashWithdrawals').find(
      { withdrawnAt: { $gte: dayStart, $lt: dayEnd } },
      { projection: { amountInCentimes: 1 } },
    ).toArray(),
  ]);
  let receivedInCentimes = 0;
  let receivedForDayToursInCentimes = 0;
  let complete = true;

  for (const payment of payments) {
    const normalizedPayment = normalizeStoredPaymentAllocations(payment);

    if (!normalizedPayment) {
      complete = false;
      continue;
    }

    receivedInCentimes += normalizedPayment.amountInCentimes;

    for (const allocation of normalizedPayment.allocations) {
      if (dayTourIds.has(allocation.tourId.toString())) {
        receivedForDayToursInCentimes += allocation.allocatedAmountInCentimes;
      }
    }
  }

  let withdrawnInCentimes = 0;

  for (const withdrawal of withdrawals) {
    if (!isAmount(withdrawal.amountInCentimes)) {
      complete = false;
      continue;
    }

    withdrawnInCentimes += withdrawal.amountInCentimes;
  }

  const safe = (value) => Number.isSafeInteger(value) ? value : null;

  return {
    complete,
    paymentCount: payments.length,
    receivedForDayToursInCentimes: safe(receivedForDayToursInCentimes),
    receivedForOtherToursInCentimes: safe(
      receivedInCentimes - receivedForDayToursInCentimes,
    ),
    receivedInCentimes: safe(receivedInCentimes),
    withdrawalCount: withdrawals.length,
    withdrawnInCentimes: safe(withdrawnInCentimes),
  };
};

export const getDayRecap = async ({
  date = '',
  filter = '',
  page = 1,
  pageSize = DAY_RECAP_TOURS_PER_PAGE,
  query = '',
  today = todayInAlgiers(),
  userId,
} = {}) => {
  await requireUserPermission(userId, DAY_RECAP_READ_PERMISSION);

  const permissions = await getUserPermissions(userId);
  const canReadCash = permissions.includes(CASH_READ_PERMISSION);
  const canReadExpenses = permissions.includes(TOUR_EXPENSE_READ_PERMISSION);
  const financialsVisible = canReadCash && canReadExpenses;
  const normalizedDate = normalizeDayRecapDate(date)
    || normalizeDayRecapDate(today)
    || todayInAlgiers();
  const normalizedFilter = filter
    && Object.hasOwn(DAY_RECAP_FILTERS, filter)
    && (financialsVisible || !DAY_RECAP_FINANCIAL_FILTERS.includes(filter))
    ? filter
    : '';
  const normalizedQuery = normalizeText(query).slice(0, 100);
  const normalizedPageSize = Number.isSafeInteger(pageSize)
    && pageSize > 0
    && pageSize <= 100
    ? pageSize
    : DAY_RECAP_TOURS_PER_PAGE;
  const database = await getDatabase();
  const tours = await database.collection('tours').find(
    { plannedDate: new Date(`${normalizedDate}T00:00:00.000Z`) },
    {
      projection: {
        closedAt: 1,
        countingId: 1,
        delivererCode: 1,
        delivererId: 1,
        delivererName: 1,
        loadedAt: 1,
        plannedDate: 1,
        reference: 1,
        status: 1,
      },
    },
  ).sort({ delivererName: 1, createdAt: 1, _id: 1 }).toArray();
  const tourIds = tours.map((tour) => tour._id);
  const tourIdSet = new Set(tourIds.map((tourId) => tourId.toString()));
  const countingIds = tours
    .map((tour) => tour.countingId)
    .filter((countingId) => countingId instanceof ObjectId);
  const [reservations, countings, declarations, payments] = await Promise.all([
    tourIds.length > 0
      ? database.collection('tourReservations').find(
          { status: LOADED_RESERVATION_STATUS, tourId: { $in: tourIds } },
          {
            projection: {
              baseUnit: 1,
              quantityInBaseUnits: 1,
              salePriceAtLoading: 1,
              tourId: 1,
            },
          },
        ).toArray()
      : [],
    countingIds.length > 0
      ? database.collection('tourCountings').find(
          { _id: { $in: countingIds } },
          { projection: { countedAt: 1, totalDueInCentimes: 1, tourId: 1 } },
        ).toArray()
      : [],
    canReadExpenses && tourIds.length > 0
      ? database.collection('tourExpenses').find(
          { tourId: { $in: tourIds } },
        ).toArray()
      : [],
    canReadCash && tourIds.length > 0
      ? database.collection('cashPayments').find(
          {
            $or: [
              { allocations: { $exists: false }, tourId: { $in: tourIds } },
              {
                allocations: { $exists: true },
                $or: [
                  { 'allocations.tourId': { $in: tourIds } },
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
              sourceTourCountingId: 1,
              tourId: 1,
            },
          },
        ).toArray()
      : [],
  ]);
  const loadedValues = readLoadedValues(reservations);
  const countingsById = new Map(countings.map((counting) => [
    counting._id.toString(),
    counting,
  ]));
  const declarationsByTourId = new Map(declarations.map((declaration) => [
    declaration.tourId?.toString?.(),
    declaration,
  ]));
  const { invalid, paid } = readTourPayments(payments, tourIdSet);
  const records = tours.map((tour) => buildDayRecord({
    counting: tour.countingId instanceof ObjectId
      ? countingsById.get(tour.countingId.toString()) ?? null
      : null,
    declaration: declarationsByTourId.get(tour._id.toString()) ?? null,
    financialsVisible,
    invalidPayment: invalid.has(tour._id.toString()),
    loadedValueInCentimes: loadedValues.get(tour._id.toString()) ?? null,
    paidInCentimes: paid.get(tour._id.toString()) ?? 0,
    tour,
  }));
  const totals = summarizeDayRecords(records, { financialsVisible });
  const matching = records.filter((record) =>
    matchesDayFilter(record, normalizedFilter)
    && matchesDayQuery(record, normalizedQuery));
  const totalPages = Math.max(1, Math.ceil(matching.length / normalizedPageSize));
  const activePage = Math.min(
    Number.isSafeInteger(page) && page > 0 ? page : 1,
    totalPages,
  );
  // Every tour link carries the recap it was opened from: the day, the filter,
  // the search and the page the reader will expect to find again.
  const returnHref = buildDayRecapHref({
    date: normalizedDate,
    filter: normalizedFilter,
    page: activePage,
    query: normalizedQuery,
  });
  const alerts = buildDayAlerts(records, {
    date: normalizedDate,
    returnHref,
    today,
  });

  return {
    alerts,
    cash: canReadCash
      ? await readDayCash({ database, date: normalizedDate, dayTourIds: tourIdSet })
      : null,
    date: normalizedDate,
    filter: normalizedFilter,
    financialsVisible,
    isToday: normalizedDate === normalizeDayRecapDate(today),
    page: activePage,
    pageSize: normalizedPageSize,
    query: normalizedQuery,
    tours: matching.slice(
      (activePage - 1) * normalizedPageSize,
      activePage * normalizedPageSize,
    ).map((record) => ({
      ...record,
      href: buildDayTourHref({ returnHref, tourId: record.id }),
    })),
    totalItems: matching.length,
    totalPages,
    totalTourCount: records.length,
    totals,
  };
};
