// Addressing for the product catalogue: pure, so the client table and the
// server pages that return to it agree on a single set of parameters.
const ORIGIN = 'https://syphax.invalid';
const PRODUCT_LIST_PARAMETERS = new Set([
  'page',
  'q',
  'sansPrix',
  'sens',
  'stock',
  'tri',
  'unite',
]);
const STOCK_STATUSES = new Set(['ALL', 'POSITIVE', 'ZERO', 'NEGATIVE']);
const SORT_DIRECTIONS = new Set(['asc', 'desc']);
// Base unit codes are validated by shape: the table keeps the list of the ones
// its catalogue actually uses.
const UNIT_PATTERN = /^[A-Z]{1,20}$/u;

// The sortable columns of the catalogue table.
export const PRODUCT_SORT_KEYS = Object.freeze([
  'availableQuantityInBaseUnits',
  'baseUnit',
  'code',
  'designation',
  'reservedQuantityInBaseUnits',
  'salePriceCentimes',
  'stockQuantityInBaseUnits',
]);

const readSingleValue = (value) => Array.isArray(value) ? value[0] : value;

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

export const readProductListState = (searchParams = {}) => {
  const rawPage = readSingleValue(searchParams.page);
  const parsedPage = typeof rawPage === 'string' && /^\d+$/u.test(rawPage)
    ? Number(rawPage)
    : 1;
  const sortDir = readSingleValue(searchParams.sens);
  const sortKey = readSingleValue(searchParams.tri);
  const stock = readSingleValue(searchParams.stock);
  const unit = readSingleValue(searchParams.unite);

  return {
    missingPrice: readSingleValue(searchParams.sansPrix) === '1',
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    query: normalizeText(readSingleValue(searchParams.q)).slice(0, 100),
    sortDir: SORT_DIRECTIONS.has(sortDir) ? sortDir : 'asc',
    sortKey: PRODUCT_SORT_KEYS.includes(sortKey) ? sortKey : 'designation',
    stock: STOCK_STATUSES.has(stock) ? stock : 'ALL',
    unit: typeof unit === 'string' && UNIT_PATTERN.test(unit) ? unit : 'ALL',
  };
};

export const buildProductListHref = ({
  missingPrice = false,
  page = 1,
  query = '',
  sortDir = 'asc',
  sortKey = 'designation',
  stock = 'ALL',
  unit = 'ALL',
} = {}) => {
  const parameters = new URLSearchParams();
  const normalizedQuery = normalizeText(query).slice(0, 100);

  if (normalizedQuery) {
    parameters.set('q', normalizedQuery);
  }

  if (STOCK_STATUSES.has(stock) && stock !== 'ALL') {
    parameters.set('stock', stock);
  }

  if (typeof unit === 'string' && UNIT_PATTERN.test(unit) && unit !== 'ALL') {
    parameters.set('unite', unit);
  }

  if (missingPrice) {
    parameters.set('sansPrix', '1');
  }

  if (PRODUCT_SORT_KEYS.includes(sortKey) && sortKey !== 'designation') {
    parameters.set('tri', sortKey);
  }

  if (SORT_DIRECTIONS.has(sortDir) && sortDir !== 'asc') {
    parameters.set('sens', sortDir);
  }

  if (Number.isSafeInteger(page) && page > 1) {
    parameters.set('page', String(page));
  }

  const search = parameters.toString();

  return search ? `/produits?${search}` : '/produits';
};

export const validateProductListHref = (value) => {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
  ) {
    return '/produits';
  }

  let destination;

  try {
    destination = new URL(value, ORIGIN);
  } catch {
    return '/produits';
  }

  if (
    destination.origin !== ORIGIN
    || destination.pathname !== '/produits'
    || destination.hash
    || [...destination.searchParams.keys()].some(
      (key) => !PRODUCT_LIST_PARAMETERS.has(key)
        || destination.searchParams.getAll(key).length > 1,
    )
  ) {
    return '/produits';
  }

  return buildProductListHref(
    readProductListState(Object.fromEntries(destination.searchParams)),
  );
};

export const buildProductHref = ({
  productId = '',
  returnHref = '/produits',
  section = '',
} = {}) => {
  const parameters = new URLSearchParams();

  if (section) {
    parameters.set('section', section);
  }

  parameters.set('retour', validateProductListHref(returnHref));

  return `/produits/${productId}?${parameters}`;
};

export const buildNewProductHref = (returnHref) =>
  `/produits/nouveau?${new URLSearchParams({
    retour: validateProductListHref(returnHref),
  })}`;

// The deletion notice is a one-off message, never part of the list state.
export const buildProductDeletionHref = (returnHref) => {
  const destination = new URL(validateProductListHref(returnHref), ORIGIN);

  destination.searchParams.set('deleted', '1');

  return `${destination.pathname}${destination.search}`;
};
