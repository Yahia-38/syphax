const RETURN_QUANTITY_PATTERN = /^\d+$/u;

const validateLoadedQuantity = (quantityInBaseUnits) =>
  Number.isSafeInteger(quantityInBaseUnits) && quantityInBaseUnits >= 0;

const validatePrice = (price) => Number.isSafeInteger(price?.amountInCentimes)
  && price.amountInCentimes > 0
  && price.currency === 'DZD'
  && price.taxIncluded === true;

// A pack snapshot is optional: lines reserved by pack also freeze their pack price.
const validatePackagingPrice = (packaging) => packaging === undefined
  || packaging === null
  || (validatePrice(packaging)
    && Number.isSafeInteger(packaging.quantity)
    && packaging.quantity > 0);

const validateHistoricalPrice = (line) => {
  const salePrice = line?.salePriceAtLoading;

  return validatePrice(salePrice)
    && salePrice.unit === line.baseUnit
    && validatePackagingPrice(salePrice.packaging);
};

// Full packs at the pack price, remaining base units at the unit price.
export const calculateSaleValueInCentimes = (quantityInBaseUnits, salePrice) => {
  const packaging = salePrice?.packaging;
  const packCount = packaging ? Math.floor(quantityInBaseUnits / packaging.quantity) : 0;
  const looseQuantity = packaging ? quantityInBaseUnits % packaging.quantity : quantityInBaseUnits;
  const valueInCentimes = packCount * (packaging?.amountInCentimes ?? 0)
    + looseQuantity * salePrice.amountInCentimes;

  return Number.isSafeInteger(valueInCentimes) && valueInCentimes >= 0
    ? valueInCentimes
    : null;
};

export const calculateLoadedLineValue = (line) => {
  const priceAvailable = validateHistoricalPrice(line);

  if (
    !validateLoadedQuantity(line?.quantityInBaseUnits)
    || line.quantityInBaseUnits === 0
  ) {
    return {
      error: 'La quantité chargée historique est invalide.',
      priceAvailable,
      valueInCentimes: null,
    };
  }

  if (!priceAvailable) {
    return {
      error: null,
      priceAvailable: false,
      valueInCentimes: null,
    };
  }

  const valueInCentimes = calculateSaleValueInCentimes(
    line.quantityInBaseUnits,
    line.salePriceAtLoading,
  );

  if (valueInCentimes === null) {
    return {
      error: 'La valeur chargée dépasse la limite numérique autorisée.',
      priceAvailable: true,
      valueInCentimes: null,
    };
  }

  return {
    error: null,
    priceAvailable: true,
    valueInCentimes,
  };
};

export const calculateTourCountingLine = (line, rawReturnedQuantity = '') => {
  const normalizedReturn = typeof rawReturnedQuantity === 'string'
    ? rawReturnedQuantity.trim()
    : '';
  const priceAvailable = validateHistoricalPrice(line);

  if (!validateLoadedQuantity(line?.quantityInBaseUnits)) {
    return {
      amountDueInCentimes: null,
      error: 'La quantité chargée historique est invalide.',
      inputComplete: Boolean(normalizedReturn),
      priceAvailable,
      returnedQuantityInBaseUnits: null,
      soldQuantityInBaseUnits: null,
    };
  }

  if (!normalizedReturn) {
    return {
      amountDueInCentimes: null,
      error: null,
      inputComplete: false,
      priceAvailable,
      returnedQuantityInBaseUnits: null,
      soldQuantityInBaseUnits: null,
    };
  }

  if (/^-\d+$/u.test(normalizedReturn)) {
    return {
      amountDueInCentimes: null,
      error: 'La quantité retournée ne peut pas être négative.',
      inputComplete: true,
      priceAvailable,
      returnedQuantityInBaseUnits: null,
      soldQuantityInBaseUnits: null,
    };
  }

  if (!RETURN_QUANTITY_PATTERN.test(normalizedReturn)) {
    return {
      amountDueInCentimes: null,
      error: 'La quantité retournée doit être un entier en unité de base.',
      inputComplete: true,
      priceAvailable,
      returnedQuantityInBaseUnits: null,
      soldQuantityInBaseUnits: null,
    };
  }

  const returnedQuantityInBaseUnits = Number(normalizedReturn);

  if (!Number.isSafeInteger(returnedQuantityInBaseUnits)) {
    return {
      amountDueInCentimes: null,
      error: 'La quantité retournée dépasse la limite numérique autorisée.',
      inputComplete: true,
      priceAvailable,
      returnedQuantityInBaseUnits: null,
      soldQuantityInBaseUnits: null,
    };
  }

  if (returnedQuantityInBaseUnits > line.quantityInBaseUnits) {
    return {
      amountDueInCentimes: null,
      error: 'La quantité retournée ne peut pas dépasser la quantité chargée.',
      inputComplete: true,
      priceAvailable,
      returnedQuantityInBaseUnits,
      soldQuantityInBaseUnits: null,
    };
  }

  const soldQuantityInBaseUnits = line.quantityInBaseUnits
    - returnedQuantityInBaseUnits;

  if (!priceAvailable) {
    return {
      amountDueInCentimes: null,
      error: null,
      inputComplete: true,
      priceAvailable: false,
      returnedQuantityInBaseUnits,
      soldQuantityInBaseUnits,
    };
  }

  const amountDueInCentimes = calculateSaleValueInCentimes(
    soldQuantityInBaseUnits,
    line.salePriceAtLoading,
  );

  if (amountDueInCentimes === null) {
    return {
      amountDueInCentimes: null,
      error: 'Le montant dû de cette ligne dépasse la limite numérique autorisée.',
      inputComplete: true,
      priceAvailable: true,
      returnedQuantityInBaseUnits,
      soldQuantityInBaseUnits,
    };
  }

  return {
    amountDueInCentimes,
    error: null,
    inputComplete: true,
    priceAvailable: true,
    returnedQuantityInBaseUnits,
    soldQuantityInBaseUnits,
  };
};

export const calculateTourCounting = (lines, returnedQuantities = {}) => {
  const countingLines = Array.isArray(lines) ? lines : [];
  const returnValues = returnedQuantities
    && typeof returnedQuantities === 'object'
    ? returnedQuantities
    : {};
  const calculations = countingLines.map((line) => ({
    id: line.id,
    ...calculateTourCountingLine(line, returnValues[line.id]),
  }));
  const knownAmounts = calculations
    .map((calculation) => calculation.amountDueInCentimes)
    .filter(Number.isSafeInteger);
  let knownSubtotalInCentimes = knownAmounts.length > 0 ? 0 : null;
  let subtotalOverflow = false;

  for (const amount of knownAmounts) {
    knownSubtotalInCentimes += amount;

    if (!Number.isSafeInteger(knownSubtotalInCentimes)) {
      knownSubtotalInCentimes = null;
      subtotalOverflow = true;
      break;
    }
  }

  const incompleteLineCount = calculations.filter(
    (calculation) => !calculation.inputComplete,
  ).length;
  const invalidLineCount = calculations.filter(
    (calculation) => Boolean(calculation.error),
  ).length;
  const missingPriceLineCount = calculations.filter(
    (calculation) => !calculation.priceAvailable,
  ).length;
  const complete = calculations.length > 0
    && incompleteLineCount === 0
    && invalidLineCount === 0
    && missingPriceLineCount === 0
    && !subtotalOverflow
    && knownAmounts.length === calculations.length;

  return {
    calculations,
    complete,
    incompleteLineCount,
    invalidLineCount,
    knownAmountLineCount: knownAmounts.length,
    knownSubtotalInCentimes,
    missingPriceLineCount,
    subtotalOverflow,
    totalDueInCentimes: complete ? knownSubtotalInCentimes : null,
  };
};
