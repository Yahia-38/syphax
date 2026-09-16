export const STOCK_VALUATION_METHOD = 'MOVING_WEIGHTED_AVERAGE';
export const STOCK_VALUATION_VERSION = 1;
export const STOCK_VALUATION_STATUS_COMPLETE = 'COMPLETE';
export const STOCK_VALUATION_STATUS_UNVALUED = 'UNVALUED';

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

const requireInteger = (value, label, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer of at least ${minimum}.`);
  }

  return BigInt(value);
};

const toSafeInteger = (value, label) => {
  if (value < 0n || value > MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} exceeds the allowed numeric range.`);
  }

  return Number(value);
};

export const validateStockValuationBalance = (balance) => {
  requireInteger(balance?.quantityInBaseUnits, 'Stock quantity');
  requireInteger(balance?.valueInCentimes, 'Stock value');

  if (balance.quantityInBaseUnits === 0 && balance.valueInCentimes !== 0) {
    throw new RangeError('Empty stock must have zero value.');
  }

  return {
    quantityInBaseUnits: balance.quantityInBaseUnits,
    valueInCentimes: balance.valueInCentimes,
  };
};

// This quotient is for display only. All allocations below use the integer totals.
export const getStockAverageUnitCostInCentimes = (balance) => {
  const { quantityInBaseUnits, valueInCentimes } = validateStockValuationBalance(balance);

  return quantityInBaseUnits === 0 ? null : valueInCentimes / quantityInBaseUnits;
};

// Round exact positive rational amounts half up, without floating-point products.
export const allocateStockValueInCentimes = ({
  valueInCentimes,
  quantityInBaseUnits,
  allocatedQuantityInBaseUnits,
}) => {
  const value = requireInteger(valueInCentimes, 'Value');
  const quantity = requireInteger(quantityInBaseUnits, 'Quantity', 1);
  const allocatedQuantity = requireInteger(allocatedQuantityInBaseUnits, 'Allocated quantity');

  if (allocatedQuantity > quantity) {
    throw new RangeError('Allocated quantity exceeds the original quantity.');
  }

  return toSafeInteger(
    (2n * value * allocatedQuantity + quantity) / (2n * quantity),
    'Allocated value',
  );
};

const createTransition = (before, after) => ({
  before,
  after,
  quantityDeltaInBaseUnits: after.quantityInBaseUnits - before.quantityInBaseUnits,
  valueDeltaInCentimes: after.valueInCentimes - before.valueInCentimes,
});

export const calculateStockReceipt = ({ balance, quantityInBaseUnits, amountInCentimes }) => {
  const before = validateStockValuationBalance(balance);
  const quantity = requireInteger(quantityInBaseUnits, 'Received quantity', 1);
  const amount = requireInteger(amountInCentimes, 'Reception amount');
  const after = {
    quantityInBaseUnits: toSafeInteger(BigInt(before.quantityInBaseUnits) + quantity, 'Stock quantity'),
    valueInCentimes: toSafeInteger(BigInt(before.valueInCentimes) + amount, 'Stock value'),
  };

  return createTransition(before, after);
};

export const calculateStockLoading = ({ balance, lines }) => {
  const before = validateStockValuationBalance(balance);

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new RangeError('A loading must contain at least one line for this product.');
  }

  const ids = new Set();
  let totalQuantity = 0n;

  for (const line of lines) {
    if (typeof line?.id !== 'string' || !line.id.trim() || ids.has(line.id)) {
      throw new RangeError('Loading line IDs must be non-empty and unique.');
    }

    ids.add(line.id);
    totalQuantity += requireInteger(line.quantityInBaseUnits, 'Loaded quantity', 1);
  }

  const loadedQuantityInBaseUnits = toSafeInteger(totalQuantity, 'Total loaded quantity');
  const loadedValueInCentimes = allocateStockValueInCentimes({
    ...before,
    allocatedQuantityInBaseUnits: loadedQuantityInBaseUnits,
  });
  let cumulativeQuantity = 0;
  let previousValue = 0;

  // Round cumulative shares in source line order; differences conserve the total.
  const allocatedLines = lines.map((line) => {
    cumulativeQuantity += line.quantityInBaseUnits;
    const cumulativeValue = allocateStockValueInCentimes({
      valueInCentimes: loadedValueInCentimes,
      quantityInBaseUnits: loadedQuantityInBaseUnits,
      allocatedQuantityInBaseUnits: cumulativeQuantity,
    });
    const assignedValueInCentimes = cumulativeValue - previousValue;
    previousValue = cumulativeValue;

    return {
      id: line.id,
      quantityInBaseUnits: line.quantityInBaseUnits,
      loadedValueInCentimes: assignedValueInCentimes,
    };
  });
  const after = {
    quantityInBaseUnits: before.quantityInBaseUnits - loadedQuantityInBaseUnits,
    valueInCentimes: before.valueInCentimes - loadedValueInCentimes,
  };

  return {
    ...createTransition(before, after),
    loadedQuantityInBaseUnits,
    loadedValueInCentimes,
    lines: allocatedLines,
  };
};

export const calculateLoadedStockCostSplit = ({
  loadedQuantityInBaseUnits,
  loadedValueInCentimes,
  returnedQuantityInBaseUnits,
}) => {
  const returnedValueInCentimes = allocateStockValueInCentimes({
    quantityInBaseUnits: loadedQuantityInBaseUnits,
    valueInCentimes: loadedValueInCentimes,
    allocatedQuantityInBaseUnits: returnedQuantityInBaseUnits,
  });

  return {
    returnedQuantityInBaseUnits,
    returnedValueInCentimes,
    soldQuantityInBaseUnits: loadedQuantityInBaseUnits - returnedQuantityInBaseUnits,
    costOfGoodsSoldInCentimes: loadedValueInCentimes - returnedValueInCentimes,
  };
};

export const calculateStockReturn = ({ balance, ...loadedLine }) => {
  const before = validateStockValuationBalance(balance);
  const split = calculateLoadedStockCostSplit(loadedLine);
  const after = {
    quantityInBaseUnits: toSafeInteger(
      BigInt(before.quantityInBaseUnits) + BigInt(split.returnedQuantityInBaseUnits),
      'Stock quantity',
    ),
    valueInCentimes: toSafeInteger(
      BigInt(before.valueInCentimes) + BigInt(split.returnedValueInCentimes),
      'Stock value',
    ),
  };

  return { ...createTransition(before, after), ...split };
};
