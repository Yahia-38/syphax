import { isPackagingEnabledForReception } from './product-packaging.js';

export const RECEPTION_FORM_PERMISSIONS = Object.freeze([
  'receptions.read',
  'receptions.create',
  'suppliers.read',
  'products.read',
  'packaging.read',
]);

export const getMissingReceptionFormPermissions = (permissions) => {
  const permissionSet = new Set(Array.isArray(permissions) ? permissions : []);

  return RECEPTION_FORM_PERMISSIONS.filter(
    (permission) => !permissionSet.has(permission),
  );
};

export const formatReceptionDateInput = (
  date,
  timeZone = 'Africa/Algiers',
) => {
  const parts = new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
};

export const formatReceptionDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return 'Non renseignée';
  }

  const date = new Date(`${value}T12:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return 'Non renseignée';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    day: '2-digit',
    month: 'long',
    timeZone: 'Africa/Algiers',
    year: 'numeric',
  }).format(date);
};

export const formatReceptionRecordedAt = (
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
    dateStyle: 'long',
    hourCycle: 'h23',
    timeStyle: 'short',
    timeZone,
  }).format(date);
};

const formatAmountInCentimes = (amountInCentimes, maximumFractionDigits = 2) =>
  `${new Intl.NumberFormat('fr-DZ', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(amountInCentimes / 100)} DA`;

export const formatReceptionMoney = (amountInCentimes) =>
  Number.isSafeInteger(amountInCentimes) && amountInCentimes >= 0
    ? formatAmountInCentimes(amountInCentimes)
    : 'Non renseigné';

export const formatReceptionDifference = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) {
    return 'Non calculable';
  }

  const formattedAmount = formatAmountInCentimes(Math.abs(amountInCentimes));

  return amountInCentimes > 0
    ? `+${formattedAmount}`
    : amountInCentimes < 0
      ? `−${formattedAmount}`
      : formattedAmount;
};

export const calculateReceptionUnitCostInCentimes = ({
  amountInCentimes,
  quantityInBaseUnits,
}) => Number.isSafeInteger(amountInCentimes)
  && amountInCentimes >= 0
  && Number.isSafeInteger(quantityInBaseUnits)
  && quantityInBaseUnits > 0
  ? amountInCentimes / quantityInBaseUnits
  : null;

export const formatReceptionUnitCost = (line) => {
  const unitCostInCentimes = calculateReceptionUnitCostInCentimes(line);

  return unitCostInCentimes === null
    ? 'Non calculable'
    : formatAmountInCentimes(unitCostInCentimes, 4);
};

export const summarizeReceptionAmounts = (
  lines,
  documentTotalInCentimes = null,
) => {
  const receptionLines = Array.isArray(lines) ? lines : [];
  const knownAmounts = receptionLines
    .map(({ amountInCentimes }) => amountInCentimes)
    .filter((amount) => Number.isSafeInteger(amount) && amount >= 0);
  const knownSubtotalInCentimes = knownAmounts.length > 0
    ? knownAmounts.reduce((total, amount) => total + amount, 0)
    : null;
  const incompleteLineCount = receptionLines.length - knownAmounts.length;
  const complete = receptionLines.length > 0 && incompleteLineCount === 0;
  const hasDocumentTotal = Number.isSafeInteger(documentTotalInCentimes)
    && documentTotalInCentimes >= 0;

  return {
    complete,
    documentTotalInCentimes: hasDocumentTotal
      ? documentTotalInCentimes
      : null,
    gapInCentimes: complete && hasDocumentTotal
      ? documentTotalInCentimes - knownSubtotalInCentimes
      : null,
    incompleteLineCount,
    knownSubtotalInCentimes,
  };
};

const RECEPTION_ID_PATTERN = /^[a-f\d]{24}$/iu;
const RECEPTION_HISTORY_PARAMETERS = new Set([
  'fournisseur',
  'onglet',
  'page',
  'recherche',
]);

const readSingleValue = (value) => Array.isArray(value) ? value[0] : value;

export const readReceptionHistoryState = (query = {}) => {
  const rawQuery = readSingleValue(query?.recherche);
  const rawSupplierId = readSingleValue(query?.fournisseur);
  const rawPage = readSingleValue(query?.page);
  const parsedPage = typeof rawPage === 'string' && /^\d+$/u.test(rawPage)
    ? Number(rawPage)
    : 1;

  return {
    query: typeof rawQuery === 'string' ? rawQuery.slice(0, 100) : '',
    supplierId: typeof rawSupplierId === 'string'
      && RECEPTION_ID_PATTERN.test(rawSupplierId)
      ? rawSupplierId
      : 'ALL',
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
};

export const buildReceptionHistoryHref = ({
  page = 1,
  query = '',
  supplierId = 'ALL',
} = {}) => {
  const parameters = new URLSearchParams();
  const normalizedQuery = typeof query === 'string' ? query.slice(0, 100) : '';

  if (normalizedQuery) {
    parameters.set('recherche', normalizedQuery);
  }

  if (typeof supplierId === 'string' && RECEPTION_ID_PATTERN.test(supplierId)) {
    parameters.set('fournisseur', supplierId);
  }

  if (Number.isSafeInteger(page) && page > 1) {
    parameters.set('page', String(page));
  }

  const search = parameters.toString();

  return search ? `/receptions?${search}` : '/receptions';
};

export const validateReceptionHistoryHref = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/receptions';
  }

  let destination;

  try {
    destination = new URL(value, 'https://syphax.invalid');
  } catch {
    return '/receptions';
  }

  const hasUnexpectedParameter = [...destination.searchParams.keys()].some(
    (key) => !RECEPTION_HISTORY_PARAMETERS.has(key),
  );

  if (
    destination.origin !== 'https://syphax.invalid'
    || destination.pathname !== '/receptions'
    || destination.hash
    || hasUnexpectedParameter
    || (destination.searchParams.has('onglet')
      && destination.searchParams.get('onglet') !== 'receptions')
  ) {
    return '/receptions';
  }

  return buildReceptionHistoryHref(readReceptionHistoryState(
    Object.fromEntries(destination.searchParams),
  ));
};

export const createEmptyReceptionLine = (id) => ({
  id,
  amount: '',
  directQuantity: '',
  packagingCount: '',
  packagingId: '',
  productId: '',
  productQuery: '',
  quantityMode: 'DIRECT',
});

export const changeReceptionLineProduct = (line, productId) => ({
  ...createEmptyReceptionLine(line.id),
  productId,
});

export const getReceptionPackagings = (product) =>
  (product?.packagings ?? []).filter(isPackagingEnabledForReception);

const parsePositiveInteger = (value) => {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!/^\d+$/u.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : null;
};

export const parseReceptionAmountInCentimes = (value) => {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/u.exec(normalizedValue);

  if (!match) {
    return null;
  }

  const amountInCentimes = Number(match[1]) * 100
    + Number((match[2] ?? '').padEnd(2, '0'));

  return Number.isSafeInteger(amountInCentimes) && amountInCentimes >= 0
    ? amountInCentimes
    : null;
};

export const calculateReceptionLine = (line, product) => {
  const amountInCentimes = parseReceptionAmountInCentimes(line.amount);
  let quantityInBaseUnits = null;

  if (product && line.quantityMode === 'DIRECT') {
    quantityInBaseUnits = parsePositiveInteger(line.directQuantity);
  }

  if (product && line.quantityMode === 'PACKAGING') {
    const packaging = getReceptionPackagings(product).find(
      ({ id }) => id === line.packagingId,
    );
    const packagingCount = parsePositiveInteger(line.packagingCount);

    if (packaging && packagingCount !== null) {
      const calculatedQuantity = packaging.quantity * packagingCount;

      quantityInBaseUnits = Number.isSafeInteger(calculatedQuantity)
        ? calculatedQuantity
        : null;
    }
  }

  return { amountInCentimes, quantityInBaseUnits };
};

export const validateReceptionLine = (line, product) => {
  const errors = {};
  const calculation = calculateReceptionLine(line, product);

  if (calculation.amountInCentimes === null) {
    errors.amount = 'Saisissez un montant TTC positif ou nul avec deux décimales maximum.';
  }

  if (!product) {
    errors.product = 'Sélectionnez un produit du catalogue.';
  } else if (line.quantityMode === 'PACKAGING') {
    const packaging = product.packagings.find(
      ({ id }) => id === line.packagingId,
    );

    if (!packaging) {
      errors.packaging = 'Sélectionnez un conditionnement du produit.';
    } else if (!isPackagingEnabledForReception(packaging)) {
      errors.packaging = 'Ce conditionnement n’est pas activé pour la réception.';
    }

    if (!/^\d+$/u.test(line.packagingCount.trim())) {
      errors.packagingCount = 'Saisissez un nombre entier positif.';
    } else if (!errors.packaging && calculation.quantityInBaseUnits === null) {
      errors.packagingCount = 'Saisissez un nombre entier positif valide.';
    }
  } else if (calculation.quantityInBaseUnits === null) {
    errors.directQuantity = 'Saisissez une quantité entière positive.';
  }

  return Object.keys(errors).length > 0
    ? { errors }
    : {
        data: {
          amountInCentimes: calculation.amountInCentimes,
          quantityInBaseUnits: calculation.quantityInBaseUnits,
        },
      };
};

export const validateReceptionDraft = ({ hasLineDraft, lineCount }) => {
  if (hasLineDraft) {
    return {
      error: 'Validez ou annulez la ligne en cours avant de valider la réception.',
    };
  }

  if (!Number.isSafeInteger(lineCount) || lineCount < 1) {
    return {
      error: 'Ajoutez et validez au moins une ligne de réception.',
    };
  }

  return { valid: true };
};
