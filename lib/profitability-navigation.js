// Pure profitability addressing: no database, no tour domain, so both the
// profitability page and the tour fiche can depend on it without a cycle.
import { normalizeDayRecapDate } from './day-recap-navigation.js';
import { TAB_PARAMETER } from './tab-navigation.js';

const ORIGIN = 'https://syphax.invalid';
const PATHNAME = '/rentabilite';

export const PROFITABILITY_PATHNAME = PATHNAME;
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

// The month that holds the given Algiers day, from its first to its last day.
export const getProfitabilityMonth = (today) => {
  const day = normalizeDayRecapDate(today);

  if (!day) {
    return { dateFrom: '', dateTo: '' };
  }

  const [year, month] = day.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = day.slice(0, 8);

  return { dateFrom: `${prefix}01`, dateTo: `${prefix}${String(lastDay).padStart(2, '0')}` };
};

// An address that names no period opens on the current month; one that names
// an empty period (du=) covers every period.
export const readProfitabilityState = (searchParams = {}, { today = '' } = {}) => {
  const namesPeriod = searchParams.du !== undefined || searchParams.au !== undefined;
  const defaultPeriod = namesPeriod ? { dateFrom: '', dateTo: '' } : getProfitabilityMonth(today);
  let dateFrom = normalizeDayRecapDate(searchParams.du) || defaultPeriod.dateFrom;
  let dateTo = normalizeDayRecapDate(searchParams.au) || defaultPeriod.dateTo;
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

  // A named but empty period is still written (du=), so that it does not fall
  // back to the current month.
  if (dateFrom || state.dateFrom !== undefined || state.dateTo !== undefined) parameters.set('du', dateFrom);
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

  const query = Object.fromEntries(destination.searchParams);
  const state = readProfitabilityState(query);

  // An address without a period keeps opening on the current month.
  return buildProfitabilityHref(query.du === undefined && query.au === undefined
    ? { ...state, dateFrom: undefined, dateTo: undefined }
    : state);
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
