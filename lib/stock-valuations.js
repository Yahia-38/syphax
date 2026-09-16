import { ObjectId } from 'mongodb';

import {
  STOCK_VALUATION_STATUS_UNVALUED,
  STOCK_VALUATION_VERSION,
  calculateLoadedStockCostSplit,
  getStockAverageUnitCostInCentimes,
} from './stock-valuation-calculations.js';
import { TOUR_LOADING_OUTPUT_KIND, TOUR_RETURN_INPUT_KIND } from './stock-movements.js';
import {
  doesStockValuationEntryMatchMovement,
  isValidStockValuationMovement,
  normalizeStoredStockValuation,
  normalizeStoredStockValuationEntry,
} from './stock-valuation-records.js';

// Internal persistence foundations. No client-facing cost DTO or write integration yet.
export const ensureStockValuationIndexes = async (database) => {
  await Promise.all([
    database.collection('stockValuations').createIndex(
      { productId: 1 },
      { name: 'unique_stock_valuation_product', unique: true },
    ),
    database.collection('stockValuationEntries').createIndex(
      { sourceStockMovementId: 1, version: 1 },
      { name: 'unique_stock_valuation_movement_version', unique: true },
    ),
    database.collection('stockValuationEntries').createIndex(
      { productId: 1, version: 1, revision: 1 },
      { name: 'unique_stock_valuation_product_version_revision', unique: true },
    ),
  ]);
};

const balancesMatch = (first, second) => first.quantityInBaseUnits === second.quantityInBaseUnits
  && first.valueInCentimes === second.valueInCentimes;

export const reconcileStockValuation = ({
  productId,
  baseUnit,
  valuation,
  movements,
  entries,
}) => {
  if (!(productId instanceof ObjectId) || typeof baseUnit !== 'string' || !baseUnit.trim()) {
    throw new RangeError('Reconciliation requires a product ID and base unit.');
  }

  if (!Array.isArray(movements) || !Array.isArray(entries)) {
    throw new TypeError('Reconciliation requires physical movements and ledger entries.');
  }

  const issues = [];
  const addIssue = (code, record) => issues.push({
    code,
    ...(record?._id instanceof ObjectId ? { recordId: record._id.toHexString() } : {}),
  });
  const normalizedValuation = normalizeStoredStockValuation(valuation);

  if (!valuation) addIssue('MISSING_VALUATION');
  else if (!normalizedValuation) addIssue('INVALID_VALUATION', valuation);
  else {
    if (!valuation.productId.equals(productId) || valuation.baseUnit !== baseUnit) {
      addIssue('VALUATION_PRODUCT_OR_UNIT_MISMATCH', valuation);
    }

    if (valuation.status === STOCK_VALUATION_STATUS_UNVALUED) addIssue('UNKNOWN_COST', valuation);
  }

  let physicalQuantity = 0n;
  let physicalQuantityAvailable = true;
  const movementsById = new Map();

  for (const movement of movements) {
    if (
      !isValidStockValuationMovement(movement)
      || !movement.productId.equals(productId)
      || movement.baseUnit !== baseUnit
    ) {
      addIssue('INVALID_PHYSICAL_MOVEMENT', movement);
    }

    if (
      !Number.isSafeInteger(movement?.quantityDeltaInBaseUnits)
      || !(movement.productId instanceof ObjectId)
      || !movement.productId.equals(productId)
      || movement.baseUnit !== baseUnit
    ) {
      physicalQuantityAvailable = false;
    } else {
      physicalQuantity += BigInt(movement.quantityDeltaInBaseUnits);
    }

    if (movement?._id instanceof ObjectId) {
      const key = movement._id.toHexString();

      if (movementsById.has(key)) addIssue('DUPLICATE_PHYSICAL_MOVEMENT', movement);
      movementsById.set(key, movement);
    }
  }

  if (physicalQuantity < 0n || physicalQuantity > BigInt(Number.MAX_SAFE_INTEGER)) {
    physicalQuantityAvailable = false;
    addIssue('PHYSICAL_QUANTITY_OUT_OF_RANGE');
  }

  const physicalQuantityInBaseUnits = physicalQuantityAvailable ? Number(physicalQuantity) : null;

  if (
    normalizedValuation
    && physicalQuantityAvailable
    && valuation.quantityInBaseUnits !== physicalQuantityInBaseUnits
  ) {
    addIssue('PHYSICAL_QUANTITY_MISMATCH', valuation);
  }

  const matchedMovementIds = new Set();
  const validEntries = [];

  for (const entry of entries) {
    if (
      !normalizeStoredStockValuationEntry(entry)
      || !entry.productId.equals(productId)
      || entry.baseUnit !== baseUnit
    ) {
      addIssue('INVALID_LEDGER_ENTRY', entry);
      continue;
    }

    validEntries.push(entry);
    const movementId = entry.sourceStockMovementId.toHexString();
    const movement = movementsById.get(movementId);

    if (matchedMovementIds.has(movementId)) addIssue('DUPLICATE_VALUED_MOVEMENT', entry);
    matchedMovementIds.add(movementId);

    if (!movement) addIssue('MISSING_PHYSICAL_SOURCE', entry);
    else if (!doesStockValuationEntryMatchMovement(entry, movement)) addIssue('PHYSICAL_SOURCE_MISMATCH', entry);
  }

  for (const [movementId, movement] of movementsById) {
    if (!matchedMovementIds.has(movementId)) addIssue('UNVALUED_PHYSICAL_MOVEMENT', movement);
  }

  const loadingsByReservation = new Map();
  const returnedReservations = new Set();

  for (const entry of validEntries) {
    if (entry.kind !== TOUR_LOADING_OUTPUT_KIND) continue;
    const reservationId = entry.sourceTourReservationId.toHexString();

    if (loadingsByReservation.has(reservationId)) addIssue('DUPLICATE_TOUR_LOADING_SOURCE', entry);
    loadingsByReservation.set(reservationId, entry);
  }

  for (const entry of validEntries) {
    if (entry.kind !== TOUR_RETURN_INPUT_KIND) continue;
    const reservationId = entry.sourceTourReservationId.toHexString();
    const loading = loadingsByReservation.get(reservationId);

    if (returnedReservations.has(reservationId)) addIssue('DUPLICATE_TOUR_RETURN_SOURCE', entry);
    returnedReservations.add(reservationId);

    if (!loading || !loading.sourceTourId.equals(entry.sourceTourId)) {
      addIssue('MISSING_OR_MISMATCHED_RETURN_LOADING', entry);
      continue;
    }

    if (entry.revision <= loading.revision) addIssue('RETURN_PRECEDES_LOADING', entry);
    if (entry.quantityDeltaInBaseUnits > -loading.quantityDeltaInBaseUnits) {
      addIssue('RETURN_EXCEEDS_LOADED_QUANTITY', entry);
      continue;
    }

    const split = calculateLoadedStockCostSplit({
      loadedQuantityInBaseUnits: -loading.quantityDeltaInBaseUnits,
      loadedValueInCentimes: -loading.valueDeltaInCentimes,
      returnedQuantityInBaseUnits: entry.quantityDeltaInBaseUnits,
    });

    if (entry.valueDeltaInCentimes !== split.returnedValueInCentimes) addIssue('ORIGINAL_RETURN_COST_MISMATCH', entry);
  }

  validEntries.sort((first, second) => first.revision - second.revision);
  let previousBalance = { quantityInBaseUnits: 0, valueInCentimes: 0 };
  let expectedRevision = 1;
  let lastEntry = null;

  for (const entry of validEntries) {
    if (entry.revision !== expectedRevision) addIssue('LEDGER_REVISION_GAP_OR_DUPLICATE', entry);
    if (!balancesMatch(previousBalance, entry.before)) addIssue('LEDGER_BALANCE_DISCONTINUITY', entry);
    previousBalance = entry.after;
    expectedRevision = entry.revision + 1;
    lastEntry = entry;
  }

  if (normalizedValuation) {
    if (valuation.revision !== (lastEntry?.revision ?? 0)) addIssue('VALUATION_REVISION_MISMATCH', valuation);
    if (lastEntry ? !lastEntry._id.equals(valuation.lastLedgerEntryId) : valuation.lastLedgerEntryId !== null) {
      addIssue('VALUATION_LAST_ENTRY_MISMATCH', valuation);
    }

    if (valuation.status !== STOCK_VALUATION_STATUS_UNVALUED && !balancesMatch(previousBalance, valuation)) {
      addIssue('VALUATION_LEDGER_BALANCE_MISMATCH', valuation);
    }
  }

  const complete = issues.length === 0;

  return {
    complete,
    issues,
    physicalQuantityInBaseUnits,
    quantityInBaseUnits: normalizedValuation?.quantityInBaseUnits ?? null,
    valueInCentimes: normalizedValuation?.valueInCentimes ?? null,
    averageUnitCostInCentimes: complete ? getStockAverageUnitCostInCentimes(valuation) : null,
  };
};

// Call within a transaction for a consistent snapshot while business writes run.
// The caller supplies the trusted database/session; this is not a public read API.
export const readStoredStockValuationReconciliation = async ({ database, session, productId, baseUnit }) => {
  if (!(productId instanceof ObjectId)) {
    throw new RangeError('Reconciliation requires a product ID.');
  }

  // MongoDB does not support parallel operations within a transaction.
  const valuation = await database.collection('stockValuations').findOne({ productId }, { session });
  const movements = await database.collection('stockMovements').find({ productId }, { session }).toArray();
  const entries = await database.collection('stockValuationEntries').find(
    { productId, version: STOCK_VALUATION_VERSION },
    { session },
  ).toArray();

  return reconcileStockValuation({ productId, baseUnit, valuation, movements, entries });
};
