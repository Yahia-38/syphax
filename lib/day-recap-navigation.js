// Pure day recap addressing: no database, no tour domain, so both the recap and
// the tour fiche can depend on it without a cycle.
const ORIGIN = 'https://syphax.invalid';
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

const readSingleValue = (value) => Array.isArray(value) ? value[0] : value;

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

export const DAY_RECAP_FILTERS = Object.freeze({
  '': 'Toutes',
  tournee: 'En tournée',
  rentres: 'Rentrés',
  impayes: 'Reste à encaisser',
  terminees: 'Terminées',
});

export const DAY_RECAP_PARAMETERS = new Set([
  'jour',
  'jourEtat',
  'jourPage',
  'jourRecherche',
]);

export const normalizeDayRecapDate = (value) => {
  const normalizedValue = normalizeText(readSingleValue(value));
  const match = DAY_PATTERN.exec(normalizedValue);

  if (!match) {
    return '';
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? normalizedValue
    : '';
};

// The stored day is already an Algiers calendar day: no conversion to redo.
export const formatDayRecapShortDate = (value) => {
  const normalizedDate = normalizeDayRecapDate(value);

  if (!normalizedDate) {
    return '';
  }

  const [, month, day] = normalizedDate.split('-');

  return `${day}/${month}`;
};

export const readDayRecapState = (searchParams = {}, { today = '' } = {}) => {
  const rawFilter = normalizeText(readSingleValue(searchParams.jourEtat));
  const rawPage = readSingleValue(searchParams.jourPage);
  const parsedPage = typeof rawPage === 'string' && /^\d+$/u.test(rawPage)
    ? Number(rawPage)
    : 1;

  return {
    date: normalizeDayRecapDate(searchParams.jour)
      || normalizeDayRecapDate(today),
    filter: rawFilter && Object.hasOwn(DAY_RECAP_FILTERS, rawFilter)
      ? rawFilter
      : '',
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    query: normalizeText(readSingleValue(searchParams.jourRecherche))
      .slice(0, 100),
  };
};

export const buildDayRecapHref = ({
  date = '',
  filter = '',
  page = 1,
  query = '',
} = {}) => {
  const parameters = new URLSearchParams();
  const normalizedDate = normalizeDayRecapDate(date);
  const normalizedQuery = normalizeText(query).slice(0, 100);

  if (normalizedDate) {
    parameters.set('jour', normalizedDate);
  }

  if (filter && Object.hasOwn(DAY_RECAP_FILTERS, filter)) {
    parameters.set('jourEtat', filter);
  }

  if (normalizedQuery) {
    parameters.set('jourRecherche', normalizedQuery);
  }

  if (Number.isSafeInteger(page) && page > 1) {
    parameters.set('jourPage', String(page));
  }

  const search = parameters.toString();

  return search ? `/?${search}` : '/';
};

// Only tells the dashboard apart from other destinations: never trusts its query.
export const isDayRecapHref = (value) => {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
  ) {
    return false;
  }

  try {
    const destination = new URL(value, ORIGIN);

    return destination.origin === ORIGIN && destination.pathname === '/';
  } catch {
    return false;
  }
};

export const validateDayRecapHref = (value) => {
  if (!isDayRecapHref(value)) {
    return '/';
  }

  const destination = new URL(value, ORIGIN);

  if (
    destination.hash
    || [...destination.searchParams.keys()].some(
      (key) => !DAY_RECAP_PARAMETERS.has(key),
    )
  ) {
    return '/';
  }

  return buildDayRecapHref(
    readDayRecapState(Object.fromEntries(destination.searchParams)),
  );
};

export const readDayRecapHrefDate = (value) => normalizeDayRecapDate(
  new URL(validateDayRecapHref(value), ORIGIN).searchParams.get('jour'),
);

export const buildDayTourHref = ({ returnHref = '/', tourId = '' } = {}) => {
  const parameters = new URLSearchParams({
    retour: validateDayRecapHref(returnHref),
  });

  return `/tournees/${tourId}?${parameters}`;
};
