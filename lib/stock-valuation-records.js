import { ObjectId } from 'mongodb';

import {
  RECEPTION_INPUT_KIND,
  TOUR_LOADING_OUTPUT_KIND,
  TOUR_RETURN_INPUT_KIND,
} from './stock-movements.js';
import {
  STOCK_VALUATION_METHOD,
  STOCK_VALUATION_STATUS_COMPLETE,
  STOCK_VALUATION_STATUS_UNVALUED,
  STOCK_VALUATION_VERSION,
  validateStockValuationBalance,
} from './stock-valuation-calculations.js';

const SOURCE_FIELDS = Object.freeze({
  [RECEPTION_INPUT_KIND]: Object.freeze(['sourceReceptionId', 'sourceReceptionLineId']),
  [TOUR_LOADING_OUTPUT_KIND]: Object.freeze(['sourceTourId', 'sourceTourReservationId']),
  [TOUR_RETURN_INPUT_KIND]: Object.freeze(['sourceTourId', 'sourceTourReservationId', 'sourceTourCountingId']),
});

const isDate = (value) => value instanceof Date && Number.isFinite(value.getTime());
const isBaseUnit = (value) => typeof value === 'string' && value.trim() === value && value.length > 0;
const hasMetadata = (record) => record?.method === STOCK_VALUATION_METHOD
  && record.version === STOCK_VALUATION_VERSION;

export const normalizeStoredStockValuation = (record) => {
  if (
    !(record?._id instanceof ObjectId)
    || !(record.productId instanceof ObjectId)
    || !isBaseUnit(record.baseUnit)
    || !hasMetadata(record)
    || !Number.isSafeInteger(record.revision)
    || record.revision < 0
    || !isDate(record.updatedAt)
    || (record.revision === 0 ? record.lastLedgerEntryId !== null : !(record.lastLedgerEntryId instanceof ObjectId))
    || !Number.isSafeInteger(record.quantityInBaseUnits)
    || record.quantityInBaseUnits < 0
  ) {
    return null;
  }

  if (record.status === STOCK_VALUATION_STATUS_UNVALUED) {
    return record.valueInCentimes === null ? record : null;
  }

  if (record.status !== STOCK_VALUATION_STATUS_COMPLETE) return null;
  if (record.revision === 0 && (record.quantityInBaseUnits !== 0 || record.valueInCentimes !== 0)) return null;

  try {
    validateStockValuationBalance(record);
  } catch {
    return null;
  }

  return record;
};

export const createStockValuationRecord = ({
  productId,
  baseUnit,
  quantityInBaseUnits = 0,
  valueInCentimes = 0,
  status = STOCK_VALUATION_STATUS_COMPLETE,
  revision = 0,
  lastLedgerEntryId = null,
  updatedAt = new Date(),
}) => {
  const record = {
    _id: new ObjectId(),
    productId,
    baseUnit,
    method: STOCK_VALUATION_METHOD,
    version: STOCK_VALUATION_VERSION,
    status,
    quantityInBaseUnits,
    valueInCentimes,
    revision,
    lastLedgerEntryId,
    updatedAt,
  };

  if (!normalizeStoredStockValuation(record)) {
    throw new RangeError('Invalid stock valuation record.');
  }

  return record;
};

export const getStockValuationSourceFields = (kind) =>
  Object.hasOwn(SOURCE_FIELDS, kind) ? SOURCE_FIELDS[kind] : null;

export const isValidStockValuationMovement = (movement) => {
  const sourceFields = getStockValuationSourceFields(movement?.kind);

  return Boolean(sourceFields)
    && movement._id instanceof ObjectId
    && movement.productId instanceof ObjectId
    && isBaseUnit(movement.baseUnit)
    && Number.isSafeInteger(movement.quantityDeltaInBaseUnits)
    && (movement.kind === TOUR_LOADING_OUTPUT_KIND
      ? movement.quantityDeltaInBaseUnits < 0
      : movement.quantityDeltaInBaseUnits > 0)
    && sourceFields.every((field) => movement[field] instanceof ObjectId);
};

export const normalizeStoredStockValuationEntry = (entry) => {
  if (
    !(entry?._id instanceof ObjectId)
    || !(entry.sourceStockMovementId instanceof ObjectId)
    || !hasMetadata(entry)
    || !Number.isSafeInteger(entry.revision)
    || entry.revision < 1
    || !isDate(entry.recordedAt)
    || (entry.recordedBy !== undefined && !(entry.recordedBy instanceof ObjectId))
    || !isValidStockValuationMovement(entry)
    || !Number.isSafeInteger(entry.valueDeltaInCentimes)
  ) {
    return null;
  }

  try {
    validateStockValuationBalance(entry.before);
    validateStockValuationBalance(entry.after);
  } catch {
    return null;
  }

  if (
    BigInt(entry.after.quantityInBaseUnits) - BigInt(entry.before.quantityInBaseUnits)
      !== BigInt(entry.quantityDeltaInBaseUnits)
    || BigInt(entry.after.valueInCentimes) - BigInt(entry.before.valueInCentimes)
      !== BigInt(entry.valueDeltaInCentimes)
    || (entry.kind === TOUR_LOADING_OUTPUT_KIND ? entry.valueDeltaInCentimes > 0 : entry.valueDeltaInCentimes < 0)
  ) {
    return null;
  }

  return entry;
};

export const createStockValuationEntry = ({
  movement,
  before,
  after,
  revision,
  recordedAt = movement?.recordedAt,
}) => {
  if (!isValidStockValuationMovement(movement)) {
    throw new RangeError('A valuation entry requires a valid physical source movement.');
  }

  const entry = {
    _id: new ObjectId(),
    productId: movement.productId,
    baseUnit: movement.baseUnit,
    method: STOCK_VALUATION_METHOD,
    version: STOCK_VALUATION_VERSION,
    revision,
    sourceStockMovementId: movement._id,
    kind: movement.kind,
    quantityDeltaInBaseUnits: movement.quantityDeltaInBaseUnits,
    valueDeltaInCentimes: after?.valueInCentimes - before?.valueInCentimes,
    before: before ? { quantityInBaseUnits: before.quantityInBaseUnits, valueInCentimes: before.valueInCentimes } : null,
    after: after ? { quantityInBaseUnits: after.quantityInBaseUnits, valueInCentimes: after.valueInCentimes } : null,
    recordedAt,
    ...(movement.recordedBy !== undefined ? { recordedBy: movement.recordedBy } : {}),
    ...Object.fromEntries(SOURCE_FIELDS[movement.kind].map((field) => [field, movement[field]])),
  };

  if (!normalizeStoredStockValuationEntry(entry)) {
    throw new RangeError('Invalid stock valuation ledger entry.');
  }

  return entry;
};

export const doesStockValuationEntryMatchMovement = (entry, movement) =>
  Boolean(normalizeStoredStockValuationEntry(entry))
  && isValidStockValuationMovement(movement)
  && entry.sourceStockMovementId.equals(movement._id)
  && entry.productId.equals(movement.productId)
  && entry.baseUnit === movement.baseUnit
  && entry.kind === movement.kind
  && entry.quantityDeltaInBaseUnits === movement.quantityDeltaInBaseUnits
  && SOURCE_FIELDS[movement.kind].every((field) => entry[field].equals(movement[field]));
