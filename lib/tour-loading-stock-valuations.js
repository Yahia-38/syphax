import {
  STOCK_VALUATION_METHOD,
  STOCK_VALUATION_VERSION,
  calculateStockLoading,
} from './stock-valuation-calculations.js';
import { createStockValuationEntry } from './stock-valuation-records.js';
import { readStoredStockValuationReconciliation } from './stock-valuations.js';

// Internal service. Preview reads need a snapshot transaction; writes additionally
// require the caller's existing product stockReferenceVersion locks.
export const prepareTourLoadingStockValuations = async ({ database, session, lines }) => {
  if (!session?.inTransaction()) {
    throw new TypeError('Loading valuation requires a transaction.');
  }

  const groups = new Map();
  for (const line of lines) {
    const key = line.productId.toHexString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }

  const preparedById = new Map();
  for (const productLines of groups.values()) {
    const { productId, baseUnit } = productLines[0];
    if (productLines.some((line) => line.baseUnit !== baseUnit)) {
      throw new RangeError('Les unités des lignes réservées sont incompatibles.');
    }

    const report = await readStoredStockValuationReconciliation({
      database, session, productId, baseUnit,
    });
    if (!report.complete) {
      throw new RangeError('La valorisation du stock est incomplète. Réconciliez ou migrez l’historique du produit avant de charger.');
    }

    const valuation = await database.collection('stockValuations').findOne({ productId }, { session });
    const allocation = calculateStockLoading({
      balance: valuation,
      lines: productLines.map((line) => ({
        id: line._id.toHexString(), quantityInBaseUnits: line.quantityInBaseUnits,
      })),
    });
    for (const allocatedLine of allocation.lines) {
      preparedById.set(allocatedLine.id, {
        purchaseCostAtLoading: {
          method: STOCK_VALUATION_METHOD,
          version: STOCK_VALUATION_VERSION,
          baseUnit,
          quantityInBaseUnits: allocatedLine.quantityInBaseUnits,
          valueInCentimes: allocatedLine.loadedValueInCentimes,
          currency: 'DZD',
          taxIncluded: true,
        },
        // Included only in the server digest, even when costs are hidden. A new
        // receipt/return/loading invalidates approval even if rounding is unchanged.
        valuationSource: {
          id: valuation._id.toHexString(),
          revision: valuation.revision,
          quantityInBaseUnits: valuation.quantityInBaseUnits,
          valueInCentimes: valuation.valueInCentimes,
          lastLedgerEntryId: valuation.lastLedgerEntryId?.toHexString() ?? null,
        },
      });
    }
  }

  return lines.map((line) => ({ ...line, ...preparedById.get(line._id.toHexString()) }));
};

export const applyTourLoadingStockValuations = async ({ database, session, lines, movements }) => {
  if (!session?.inTransaction()) {
    throw new TypeError('Loading valuation requires a transaction.');
  }

  const movementsByReservation = new Map(movements.map((movement) => [
    movement.sourceTourReservationId.toHexString(), movement,
  ]));
  const balances = new Map();
  for (const line of lines) {
    const key = line.productId.toHexString();
    let valuation = balances.get(key);
    if (!valuation) {
      valuation = await database.collection('stockValuations').findOne({ productId: line.productId }, { session });
      if (!valuation || valuation.revision !== line.valuationSource.revision
        || valuation._id.toHexString() !== line.valuationSource.id) {
        throw new Error('The locked stock valuation changed during loading.');
      }
    }

    const before = {
      quantityInBaseUnits: valuation.quantityInBaseUnits,
      valueInCentimes: valuation.valueInCentimes,
    };
    const after = {
      quantityInBaseUnits: before.quantityInBaseUnits - line.quantityInBaseUnits,
      valueInCentimes: before.valueInCentimes - line.purchaseCostAtLoading.valueInCentimes,
    };
    const movement = movementsByReservation.get(line._id.toHexString());
    const revision = valuation.revision + 1;
    const entry = createStockValuationEntry({ movement, before, after, revision });
    await database.collection('stockValuationEntries').insertOne(entry, { session });
    const updated = {
      ...valuation, ...after, revision, lastLedgerEntryId: entry._id, updatedAt: movement.recordedAt,
    };
    const result = await database.collection('stockValuations').replaceOne(
      { _id: valuation._id, revision: valuation.revision }, updated, { session },
    );
    if (result.matchedCount !== 1) throw new Error('The locked stock valuation changed during loading.');
    balances.set(key, updated);
  }
};
