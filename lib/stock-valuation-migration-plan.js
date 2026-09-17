import { createHash } from 'node:crypto';
import { BSON, ObjectId } from 'mongodb';

import {
  STOCK_VALUATION_METHOD, STOCK_VALUATION_VERSION,
  calculateStockLoading, calculateStockReceipt, calculateStockReturn,
} from './stock-valuation-calculations.js';
import {
  createStockValuationEntry, createStockValuationRecord,
  isValidStockValuationMovement, normalizeStoredStockValuation,
} from './stock-valuation-records.js';
import { reconcileStockValuation } from './stock-valuations.js';
import { normalizeLoadingPurchaseCost, summarizeCountingPurchaseCosts } from './tour-counting-purchase-costs.js';

export const STOCK_MIGRATION_COLLECTIONS = [
  'products', 'receptions', 'tours', 'tourReservations', 'tourCountings',
  'stockMovements', 'stockValuations', 'stockValuationEntries',
];
export const STOCK_MIGRATION_VERSION = 1;

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const fingerprintStockMigration = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value === undefined ? { $undefined: true } : BSON.EJSON.serialize(value, { relaxed: false })))).digest('hex');
const id = (value) => value instanceof ObjectId ? value.toHexString() : '';
const sameId = (first, second) => Boolean(id(first)) && id(first) === id(second);
const isDate = (value) => value instanceof Date && Number.isFinite(value.getTime());
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const linesOf = (record) => Array.isArray(record.lines) ? record.lines.filter((line) => line && typeof line === 'object') : [];
const stableId = (kind, source) => new ObjectId(createHash('sha256')
  .update(`syphax-stock-migration:${STOCK_VALUATION_VERSION}:${kind}:${source}`).digest('hex').slice(0, 24));
const equalFields = (record, expected) => Object.entries(expected).every(([key, value]) =>
  fingerprintStockMigration(record?.[key]) === fingerprintStockMigration(value));
const snapshotCost = (line, value) => ({
  method: STOCK_VALUATION_METHOD, version: STOCK_VALUATION_VERSION,
  baseUnit: line.baseUnit, quantityInBaseUnits: line.quantityInBaseUnits,
  valueInCentimes: value, currency: 'DZD', taxIncluded: true,
});

const applyOperation = (state, operation) => {
  const append = (movement, transition) => {
    if (!movement) return;
    const entry = createStockValuationEntry({
      movement, ...transition, revision: state.entries.length + 1, recordedAt: operation.time,
    });
    entry._id = stableId('movement', id(movement._id));
    state.entries.push(entry);
  };
  if (operation.kind === 'RECEPTION_IN') {
    for (const { line, movement } of operation.lines) {
      const transition = calculateStockReceipt({ balance: state.balance, ...line });
      append(movement, transition);
      state.balance = transition.after;
    }
  } else if (operation.kind === 'TOUR_LOADING_OUT') {
    const allocation = calculateStockLoading({
      balance: state.balance,
      lines: operation.lines.map(({ line }) => ({ id: id(line._id), quantityInBaseUnits: line.quantityInBaseUnits })),
    });
    for (const [index, { line, movement }] of operation.lines.entries()) {
      const cost = snapshotCost(line, allocation.lines[index].loadedValueInCentimes);
      state.loaded.set(id(line._id), cost);
      const after = {
        quantityInBaseUnits: state.balance.quantityInBaseUnits - line.quantityInBaseUnits,
        valueInCentimes: state.balance.valueInCentimes - cost.valueInCentimes,
      };
      append(movement, { before: state.balance, after });
      state.balance = after;
    }
  } else {
    for (const { line, movement, index } of operation.lines) {
      const cost = state.loaded.get(id(line.sourceTourReservationId));
      if (!cost) throw new RangeError('Counting precedes its original loading.');
      const transition = calculateStockReturn({
        balance: state.balance, loadedQuantityInBaseUnits: cost.quantityInBaseUnits,
        loadedValueInCentimes: cost.valueInCentimes,
        returnedQuantityInBaseUnits: line.returnedQuantityInBaseUnits,
      });
      state.counted.set(`${operation.key}/${index}`, {
        purchaseCostAtLoading: cost, returnedValueInCentimes: transition.returnedValueInCentimes,
        costOfGoodsSoldInCentimes: transition.costOfGoodsSoldInCentimes,
      });
      state.countedReservations.add(id(line.sourceTourReservationId));
      append(movement, transition);
      state.balance = transition.after;
    }
  }
};
const cloneState = (state) => ({ ...state, balance: { ...state.balance }, entries: [...state.entries],
  loaded: new Map(state.loaded), counted: new Map(state.counted), countedReservations: new Set(state.countedReservations) });
const costFingerprint = (state) => fingerprintStockMigration({ balance: state.balance,
  loaded: [...state.loaded].sort(), counted: [...state.counted].sort() });
const permutations = function* (values) {
  if (!values.length) { yield []; return; }
  for (const [index, value] of values.entries()) {
    for (const rest of permutations(values.filter((_, position) => position !== index))) yield [value, ...rest];
  }
};

const replay = (operations, storedEntries) => {
  const state = { balance: { quantityInBaseUnits: 0, valueInCentimes: 0 }, entries: [],
    loaded: new Map(), counted: new Map(), countedReservations: new Set() };
  const storedByMovement = new Map(storedEntries.map((entry) => [id(entry.sourceStockMovementId), entry]));
  operations.sort((first, second) => first.time - second.time || first.key.localeCompare(second.key));
  for (let offset = 0; offset < operations.length;) {
    let end = offset + 1;
    while (end < operations.length && +operations[end].time === +operations[offset].time) end += 1;
    let group = operations.slice(offset, end);
    if (group.length > 1) {
      // An existing immutable ledger proves ordering only when all movements of
      // these operations are present and their revision ranges do not overlap.
      const ranges = group.map((operation) => {
        const revisions = operation.lines.map(({ movement }) => movement ? storedByMovement.get(id(movement._id))?.revision : null);
        return revisions.length && revisions.every((revision) => integer(revision, 1))
          ? { operation, min: Math.min(...revisions), max: Math.max(...revisions) } : null;
      });
      const ordered = ranges.every(Boolean) ? ranges.sort((first, second) => first.min - second.min) : null;
      if (ordered && ordered.every((range, index) => !index || ordered[index - 1].max < range.min)) {
        group = ordered.map((range) => range.operation);
      } else if (group.some((operation) => operation.kind === 'TOUR_LOADING_OUT')) {
        if (group.length > 6) throw new RangeError('AMBIGUOUS_ORDER: more than six simultaneous operations include a loading.');
        let expected;
        for (const order of permutations(group)) {
          const probe = cloneState(state);
          try { for (const operation of order) applyOperation(probe, operation); }
          catch { throw new RangeError('AMBIGUOUS_ORDER: simultaneous operations require an unproven order.'); }
          const result = costFingerprint(probe);
          if (expected && expected !== result) throw new RangeError('AMBIGUOUS_ORDER: simultaneous operations change assigned costs.');
          expected = result;
        }
      }
    }
    for (const operation of group) applyOperation(state, operation);
    offset = end;
  }
  return state;
};

export const planStockValuationMigration = (snapshot) => {
  const issues = [];
  const proposals = [];
  const reservationUpdates = [];
  const countingCosts = new Map();
  const countingUpdates = [];
  const productsById = new Map(snapshot.products.map((product) => [id(product._id), product]));
  const toursById = new Map(snapshot.tours.map((tour) => [id(tour._id), tour]));
  const reservationsById = new Map(snapshot.tourReservations.map((line) => [id(line._id), line]));
  const addIssue = (code, record, productId, detail) => issues.push({
    code, recordId: id(record?._id) || null, productId: id(productId) || null, ...(detail ? { detail } : {}),
  });
  for (const name of ['receptions', 'tourCountings']) {
    for (const record of snapshot[name]) {
      if (!Array.isArray(record.lines) || !record.lines.length || linesOf(record).length !== record.lines.length) addIssue('INVALID_SOURCE_LINES', record);
      for (const line of linesOf(record)) {
        if (!productsById.has(id(line.productId))) addIssue('MISSING_PRODUCT', record, line.productId);
      }
    }
  }
  for (const name of ['tourReservations', 'stockMovements', 'stockValuations', 'stockValuationEntries']) {
    for (const record of snapshot[name]) {
      if (!productsById.has(id(record.productId))) addIssue('MISSING_PRODUCT', record, record.productId);
    }
  }
  for (const tour of snapshot.tours) {
    if (['LOADED', 'COUNTED', 'CLOSED'].includes(tour.status)
      && !snapshot.tourReservations.some((line) => sameId(line.tourId, tour._id) && line.status === 'LOADED')) {
      addIssue('MISSING_LOADED_RESERVATIONS', tour);
    }
    const countings = snapshot.tourCountings.filter((counting) => sameId(counting.tourId, tour._id));
    if (countings.length > 1 || (['COUNTED', 'CLOSED'].includes(tour.status) ? countings.length !== 1 : countings.length !== 0)) {
      addIssue('TOUR_COUNTING_STATE_MISMATCH', tour);
    }
  }
  for (const counting of snapshot.tourCountings) {
    const tour = toursById.get(id(counting.tourId));
    if (!tour || (tour.countingId && !sameId(tour.countingId, counting._id))
      || (tour.countedAt !== undefined && (!isDate(tour.countedAt) || +tour.countedAt !== +counting.countedAt))) addIssue('COUNTING_TOUR_MISMATCH', counting);
    const seen = new Set();
    for (const line of linesOf(counting)) {
      const reservation = reservationsById.get(id(line.sourceTourReservationId));
      if (!reservation || !sameId(reservation.tourId, counting.tourId) || reservation.status !== 'LOADED'
        || seen.has(id(line.sourceTourReservationId))) addIssue('COUNTING_RESERVATION_MISMATCH', counting, line.productId);
      seen.add(id(line.sourceTourReservationId));
    }
    for (const reservation of snapshot.tourReservations.filter((line) => sameId(line.tourId, counting.tourId) && line.status === 'LOADED')) {
      if (!seen.has(id(reservation._id))) addIssue('MISSING_COUNTING_LINE', counting, reservation.productId);
    }
  }

  for (const product of snapshot.products) {
    const productId = product._id;
    const startIssues = issues.length;
    const movements = snapshot.stockMovements.filter((movement) => sameId(movement.productId, productId));
    const storedEntries = snapshot.stockValuationEntries.filter((entry) => sameId(entry.productId, productId));
    const storedBalances = snapshot.stockValuations.filter((valuation) => sameId(valuation.productId, productId));
    const consumed = new Set();
    const operations = [];
    const checkLine = (line, record) => {
      if (typeof product.baseUnit !== 'string' || !product.baseUnit.trim() || line.baseUnit !== product.baseUnit
        || !integer(line.quantityInBaseUnits, 1)) addIssue('SOURCE_UNIT_OR_QUANTITY_MISMATCH', record, productId);
      if (line.packaging && (!integer(line.quantityInBaseUnits, 1) || !integer(line.packaging.quantity, 2) || !integer(line.packaging.count, 1)
        || BigInt(line.packaging.quantity) * BigInt(line.packaging.count) !== BigInt(line.quantityInBaseUnits ?? 0))) {
        addIssue('PACKAGING_QUANTITY_MISMATCH', record, productId);
      }
    };
    const movementFor = (kind, source, quantity, time, record) => {
      const matches = snapshot.stockMovements.filter((movement) => movement.kind === kind
        && Object.entries(source).every(([key, value]) => sameId(movement[key], value)));
      if (matches.length !== (quantity === 0 ? 0 : 1)) {
        addIssue('MISSING_OR_DUPLICATE_MOVEMENT', record, productId, kind); return null;
      }
      const movement = matches[0];
      if (!movement) return null;
      consumed.add(id(movement._id));
      if (!isValidStockValuationMovement(movement) || !sameId(movement.productId, productId)
        || movement.baseUnit !== product.baseUnit || movement.quantityDeltaInBaseUnits !== quantity
        || (movement.recordedAt !== undefined && (!isDate(movement.recordedAt) || +movement.recordedAt !== +time))) {
        addIssue('MOVEMENT_SOURCE_MISMATCH', movement, productId);
      }
      return movement;
    };
    const timestamp = (time, record) => {
      if (!isDate(time)) addIssue('MISSING_RECORDING_TIME', record, productId);
      return time;
    };
    for (const reception of snapshot.receptions) {
      const lines = linesOf(reception).filter((line) => sameId(line.productId, productId));
      if (!lines.length) continue;
      const time = timestamp(reception.createdAt, reception);
      const prepared = lines.map((line) => {
        checkLine(line, reception);
        if (!id(line._id) || !integer(line.amountInCentimes)
          || (line.currency !== undefined && line.currency !== 'DZD')
          || (reception.currency !== undefined && reception.currency !== 'DZD')
          || (line.taxIncluded !== undefined && line.taxIncluded !== true)
          || (reception.taxIncluded !== undefined && reception.taxIncluded !== true)) {
          addIssue('UNKNOWN_RECEPTION_COST', reception, productId);
        }
        return { line, movement: movementFor('RECEPTION_IN', {
          sourceReceptionId: reception._id, sourceReceptionLineId: line._id,
        }, line.quantityInBaseUnits, time, reception) };
      });
      operations.push({ kind: 'RECEPTION_IN', key: id(reception._id), time, lines: prepared });
    }
    const loadedReservations = snapshot.tourReservations.filter((line) => sameId(line.productId, productId) && line.status === 'LOADED');
    const loadingGroups = new Map();
    for (const line of loadedReservations) {
      checkLine(line, line);
      const tour = toursById.get(id(line.tourId));
      if (!tour || !['LOADED', 'COUNTED', 'CLOSED'].includes(tour.status)) addIssue('LOADING_TOUR_MISMATCH', line, productId);
      const time = timestamp(tour?.loadedAt ?? line.loadedAt, line);
      if (line.loadedAt !== undefined && (!isDate(line.loadedAt) || +line.loadedAt !== +time)) addIssue('LOADING_TIME_MISMATCH', line, productId);
      const movement = movementFor('TOUR_LOADING_OUT', { sourceTourId: line.tourId, sourceTourReservationId: line._id }, -line.quantityInBaseUnits, time, line);
      const key = id(line.tourId);
      if (!loadingGroups.has(key)) loadingGroups.set(key, { kind: 'TOUR_LOADING_OUT', key, time, lines: [] });
      if (+loadingGroups.get(key).time !== +time) addIssue('LOADING_TIME_MISMATCH', line, productId);
      loadingGroups.get(key).lines.push({ line, movement });
    }
    for (const group of loadingGroups.values()) {
      group.lines.sort((first, second) => id(first.line._id).localeCompare(id(second.line._id)));
      operations.push(group);
    }
    for (const counting of snapshot.tourCountings) {
      const prepared = [];
      for (const [index, line] of linesOf(counting).entries()) {
        if (!sameId(line.productId, productId)) continue;
        checkLine(line, counting);
        const reservation = reservationsById.get(id(line.sourceTourReservationId));
        if (!reservation || !sameId(reservation.productId, productId)
          || reservation.quantityInBaseUnits !== line.quantityInBaseUnits || reservation.baseUnit !== line.baseUnit
          || !integer(line.returnedQuantityInBaseUnits) || line.returnedQuantityInBaseUnits > line.quantityInBaseUnits
          || line.soldQuantityInBaseUnits !== line.quantityInBaseUnits - line.returnedQuantityInBaseUnits) {
          addIssue('COUNTING_QUANTITY_MISMATCH', counting, productId);
        }
        const time = timestamp(counting.countedAt, counting);
        const movement = movementFor('TOUR_RETURN_IN', { sourceTourCountingId: counting._id,
          sourceTourId: counting.tourId, sourceTourReservationId: line.sourceTourReservationId,
        }, line.returnedQuantityInBaseUnits, time, counting);
        prepared.push({ line, movement, index });
      }
      if (prepared.length) operations.push({ kind: 'TOUR_RETURN_IN', key: id(counting._id), time: counting.countedAt, lines: prepared });
    }
    for (const movement of movements) {
      if (!consumed.has(id(movement._id))) addIssue('ORPHAN_OR_UNSUPPORTED_MOVEMENT', movement, productId);
    }
    const summary = { productId: id(productId), code: product.code, designation: product.designation,
      baseUnit: product.baseUnit, complete: false, quantityInBaseUnits: null, valueInCentimes: null,
      heldOnToursValueInCentimes: null, costOfGoodsSoldInCentimes: null, movementCount: movements.length };
    if (issues.length !== startIssues || issues.some((issue) => issue.productId === id(productId))) {
      proposals.push({ summary }); continue;
    }
    try {
      const state = replay(operations, storedEntries);
      const expectedByMovement = new Map(state.entries.map((entry) => [id(entry.sourceStockMovementId), entry]));
      const seen = new Set();
      for (const entry of storedEntries) {
        const expected = expectedByMovement.get(id(entry.sourceStockMovementId));
        if (!expected || seen.has(id(entry.sourceStockMovementId)) || !equalFields(entry, { ...expected, _id: entry._id })) {
          throw new RangeError('Existing immutable ledger disagrees with replay.');
        }
        seen.add(id(entry.sourceStockMovementId));
        expected._id = entry._id;
      }
      if (storedBalances.length > 1) throw new RangeError('Duplicate current valuations.');
      const stored = storedBalances[0];
      const last = state.entries.at(-1);
      const valuation = createStockValuationRecord({ productId, baseUnit: product.baseUnit, ...state.balance,
        revision: state.entries.length, lastLedgerEntryId: last?._id ?? null,
        updatedAt: last?.recordedAt ?? (isDate(product.createdAt) ? product.createdAt : new Date(0)) });
      valuation._id = stored?._id ?? stableId('product', id(productId));
      if (stored && isDate(stored.updatedAt)) valuation.updatedAt = stored.updatedAt;
      if (stored && (!normalizeStoredStockValuation(stored)
        || (stored.status === 'COMPLETE' && !equalFields(stored, valuation)))) {
        throw new RangeError('Existing current valuation disagrees with replay.');
      }
      const updates = [];
      for (const line of loadedReservations) {
        const expected = state.loaded.get(id(line._id));
        if (line.purchaseCostAtLoading !== undefined && line.purchaseCostAtLoading !== null) {
          if (fingerprintStockMigration(normalizeLoadingPurchaseCost(line)) !== fingerprintStockMigration(expected)) {
            throw new RangeError('Existing original loading cost disagrees with replay.');
          }
        } else updates.push({ _id: line._id, purchaseCostAtLoading: expected });
      }
      const report = reconcileStockValuation({ productId, baseUnit: product.baseUnit, valuation, movements, entries: state.entries });
      if (!report.complete) throw new RangeError(`Replay does not reconcile: ${report.issues.map((issue) => issue.code).join(', ')}.`);
      let held = 0n;
      let sold = 0n;
      for (const [reservationId, cost] of state.loaded) if (!state.countedReservations.has(reservationId)) held += BigInt(cost.valueInCentimes);
      for (const cost of state.counted.values()) sold += BigInt(cost.costOfGoodsSoldInCentimes);
      const purchased = operations.filter((operation) => operation.kind === 'RECEPTION_IN')
        .reduce((total, operation) => total + operation.lines.reduce((sum, { line }) => sum + BigInt(line.amountInCentimes), 0n), 0n);
      if (purchased !== BigInt(state.balance.valueInCentimes) + held + sold) throw new RangeError('Purchase value is not conserved across warehouse, tours, and sold goods.');
      if (held > BigInt(Number.MAX_SAFE_INTEGER) || sold > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Combined historical cost exceeds the allowed numeric range.');
      summary.complete = true;
      Object.assign(summary, state.balance, { heldOnToursValueInCentimes: Number(held), costOfGoodsSoldInCentimes: Number(sold) });
      proposals.push({ summary, valuation, newEntries: state.entries.filter((entry) => !seen.has(id(entry.sourceStockMovementId))),
        updateValuation: (!stored && state.entries.length > 0) || stored?.status === 'UNVALUED' });
      reservationUpdates.push(...updates);
      for (const [key, cost] of state.counted) countingCosts.set(key, cost);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      addIssue(error.message.startsWith('AMBIGUOUS_ORDER:') ? 'AMBIGUOUS_ORDER' : 'REPLAY_OR_EXISTING_COST_MISMATCH', product, productId, error.message);
      proposals.push({ summary });
    }
  }
  for (const counting of snapshot.tourCountings) {
    if (!Array.isArray(counting.lines) || !counting.lines.length || linesOf(counting).length !== counting.lines.length) continue;
    const costs = counting.lines.map((_, index) => countingCosts.get(`${id(counting._id)}/${index}`));
    if (costs.some((cost) => !cost)) continue;
    try {
      const totals = summarizeCountingPurchaseCosts(costs);
      const fields = {};
      for (const [index, cost] of costs.entries()) {
        for (const [key, value] of Object.entries(cost)) {
          if (counting.lines[index][key] !== undefined && counting.lines[index][key] !== null) {
            if (fingerprintStockMigration(counting.lines[index][key]) !== fingerprintStockMigration(value)) throw new RangeError('Existing counting cost disagrees with replay.');
          } else fields[`lines.${index}.${key}`] = value;
        }
      }
      for (const [key, value] of Object.entries(totals)) {
        if (counting[key] !== undefined && counting[key] !== null) {
          if (counting[key] !== value) throw new RangeError('Existing counting total disagrees with replay.');
        } else fields[key] = value;
      }
      if (Object.keys(fields).length) countingUpdates.push({ _id: counting._id, fields });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      addIssue('COUNTING_COST_MISMATCH', counting, null, error.message);
    }
  }
  return { canApply: !issues.length, issues, products: proposals.map(({ summary }) => summary),
    proposals, reservationUpdates, countingUpdates };
};
