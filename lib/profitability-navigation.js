// Pure profitability addressing: no database, no tour domain, so both the
// profitability page and the tour fiche can depend on it without a cycle.
import { normalizeDayRecapDate } from './day-recap-navigation.js';
import { TAB_PARAMETER } from './tab-navigation.js';

const ORIGIN = 'https://syphax.invalid';
const PATHNAME = '/rentabilite';
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/iu;

// The address names the tour status in French; the reader keeps its own codes.
export const PROFITABILITY_STATUS_FILTERS = Object.freeze({
  comptees: { label: 'Comptées', status: 'COUNTED' },
  terminees: { label: 'Terminées', status: 'CLOSED' },
});

export const PROFITABILITY_PARAMETERS = new Set([
  'au',
  'du',
  'livreur',
  'page',
  'q',
  'statut',
]);

const readSingleValue = (value) => Array.isArray(value) ? value[0] : value;

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

export const readProfitabilityState = (searchParams = {}) => {
  let dateFrom = normalizeDayRecapDate(searchParams.du);
  let dateTo = normalizeDayRecapDate(searchParams.au);
  const rawDelivererId = normalizeText(readSingleValue(searchParams.livreur));
  const rawStatus = normalizeText(readSingleValue(searchParams.statut));
  const rawPage = readSingleValue(searchParams.page);
  const parsedPage = typeof rawPage === 'string' && /^\d+$/u.test(rawPage)
    ? Number(rawPage)
    : 1;

  // A reversed period is read as the same period, like the reader does.
  if (dateFrom && dateTo && dateFrom > dateTo) {
    [dateFrom, dateTo] = [dateTo, dateFrom];
  }

  return {
    dateFrom,
    dateTo,
    delivererId: OBJECT_ID_PATTERN.test(rawDelivererId) ? rawDelivererId.toLowerCase() : '',
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    query: normalizeText(readSingleValue(searchParams.q)).slice(0, 100),
    status: Object.hasOwn(PROFITABILITY_STATUS_FILTERS, rawStatus) ? rawStatus : '',
  };
};

// The reader's own filter names, from the state the address carries.
export const toProfitabilityReportFilters = ({ dateFrom, dateTo, delivererId, page, query, status }) => ({
  dateFrom,
  dateTo,
  delivererId,
  page,
  query,
  status: PROFITABILITY_STATUS_FILTERS[status]?.status ?? '',
});

export const buildProfitabilityHref = (state = {}) => {
  const { dateFrom, dateTo, delivererId, page, query, status } = readProfitabilityState({
    au: state.dateTo,
    du: state.dateFrom,
    livreur: state.delivererId,
    page: Number.isSafeInteger(state.page) ? String(state.page) : undefined,
    q: state.query,
    statut: state.status,
  });
  const parameters = new URLSearchParams();

  if (dateFrom) parameters.set('du', dateFrom);
  if (dateTo) parameters.set('au', dateTo);
  if (delivererId) parameters.set('livreur', delivererId);
  if (status) parameters.set('statut', status);
  if (query) parameters.set('q', query);
  if (page > 1) parameters.set('page', String(page));

  const search = parameters.toString();

  return search ? `${PATHNAME}?${search}` : PATHNAME;
};

// Only tells the profitability page apart from other destinations: never
// trusts its query.
export const isProfitabilityHref = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return false;
  }

  try {
    const destination = new URL(value, ORIGIN);

    return destination.origin === ORIGIN && destination.pathname === PATHNAME;
  } catch {
    return false;
  }
};

export const validateProfitabilityHref = (value) => {
  if (!isProfitabilityHref(value)) {
    return PATHNAME;
  }

  const destination = new URL(value, ORIGIN);
  const keys = [...destination.searchParams.keys()];

  if (
    destination.hash
    || keys.some((key) => !PROFITABILITY_PARAMETERS.has(key))
    || keys.some((key) => destination.searchParams.getAll(key).length > 1)
  ) {
    return PATHNAME;
  }

  return buildProfitabilityHref(
    readProfitabilityState(Object.fromEntries(destination.searchParams)),
  );
};

// Opens the tour on its operations, at the counting card, with a way back to
// the exact selection the reader came from.
export const buildProfitabilityCountingHref = ({ returnHref = PATHNAME, tourId = '' } = {}) => {
  const parameters = new URLSearchParams({
    retour: validateProfitabilityHref(returnHref),
    [TAB_PARAMETER]: 'operations',
  });

  return `/tournees/${tourId}?${parameters}#comptage`;
};
