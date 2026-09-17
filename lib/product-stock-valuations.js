import { STOCK_VALUATION_VERSION } from './stock-valuation-calculations.js';
import { createStockValuationRecord } from './stock-valuation-records.js';
import { reconcileStockValuation } from './stock-valuations.js';

// Internal reader: the product service checks access and supplies one snapshot
// for physical stock, permissions, the balance, and its immutable ledger.
export const readProductStockValuation = async ({ database, session, productId, baseUnit }) => {
  if (!session?.inTransaction()) throw new TypeError('Product valuation requires a transaction.');
  let valuation = await database.collection('stockValuations').findOne({ productId }, { session });
  const movements = await database.collection('stockMovements').find({ productId }, { session }).toArray();
  const entries = await database.collection('stockValuationEntries').find(
    { productId, version: STOCK_VALUATION_VERSION }, { session },
  ).toArray();
  const receptionWithoutMovements = !movements.length
    ? await database.collection('receptions').findOne(
        { 'lines.productId': productId }, { projection: { _id: 1 }, session },
      )
    : null;
  // A pristine product has an empty warehouse, without creating a stored balance.
  // Net-zero legacy history and receptions missing movements remain unknown.
  if (!valuation && !movements.length && !entries.length && !receptionWithoutMovements) {
    valuation = createStockValuationRecord({ productId, baseUnit });
  }
  const report = reconcileStockValuation({ productId, baseUnit, valuation, movements, entries });
  const complete = report.complete && !receptionWithoutMovements;
  return {
    valuation: {
      complete,
      valueInCentimes: complete ? report.valueInCentimes : null,
      averageUnitCostInCentimes: complete ? report.averageUnitCostInCentimes : null,
      currency: 'DZD',
      taxIncluded: true,
    },
    // Reconciliation proves the ledger/source pairing and the original return
    // allocation. Never substitute today's average for an assigned movement cost.
    movementValues: new Map(complete
      ? entries.map((entry) => [entry.sourceStockMovementId.toHexString(), entry.valueDeltaInCentimes])
      : []),
  };
};
