import {
  STOCK_VALUATION_STATUS_UNVALUED,
  STOCK_VALUATION_VERSION,
  calculateStockReceipt,
} from './stock-valuation-calculations.js';
import {
  createStockValuationEntry,
  createStockValuationRecord,
  normalizeStoredStockValuation,
} from './stock-valuation-records.js';
import { reconcileStockValuation } from './stock-valuations.js';

const toStockQuantity = (quantity) => {
  if (quantity < 0n || quantity > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('La quantité du stock dépasse les limites autorisées.');
  }

  return Number(quantity);
};

// Internal write service: the caller must hold the products' stockReferenceVersion
// locks and call this before inserting the new reception and physical movements.
export const applyReceptionStockValuations = async ({ database, session, lines, movements }) => {
  if (!session?.inTransaction()) {
    throw new TypeError('Reception valuation requires the reception transaction.');
  }

  const linesByProduct = new Map();

  for (const [index, line] of lines.entries()) {
    const key = line.productId.toHexString();
    if (!linesByProduct.has(key)) linesByProduct.set(key, []);
    linesByProduct.get(key).push({ line, movement: movements[index] });
  }

  // Keep source line order for each product and avoid parallel session operations.
  for (const productLines of linesByProduct.values()) {
    const { productId, baseUnit } = productLines[0].line;
    const stored = await database.collection('stockValuations').findOne({ productId }, { session });
    const normalized = normalizeStoredStockValuation(stored);

    if (stored && (!normalized || stored.baseUnit !== baseUnit)) {
      throw new RangeError('La valorisation existante du produit est invalide. Corrigez-la avant de réceptionner.');
    }

    const previousMovements = await database.collection('stockMovements').find({ productId }, { session }).toArray();
    const entries = await database.collection('stockValuationEntries').find(
      { productId, version: STOCK_VALUATION_VERSION }, { session },
    ).toArray();
    const report = reconcileStockValuation({
      productId, baseUnit, valuation: stored, movements: previousMovements, entries,
    });

    if (report.physicalQuantityInBaseUnits === null) {
      throw new RangeError('Le stock physique du produit est invalide ou utilise une unité incompatible.');
    }

    // Even net-zero history needs migration. Historical receptions without physical
    // movements must not be mistaken for a product with no previous operations.
    const historicalReception = !stored && previousMovements.length === 0 && entries.length === 0
      ? await database.collection('receptions').findOne(
          { 'lines.productId': productId }, { projection: { _id: 1 }, session },
        )
      : null;
    const canInitialize = !stored && previousMovements.length === 0
      && entries.length === 0 && !historicalReception;
    let valuation = stored ?? createStockValuationRecord({
      productId,
      baseUnit,
      ...(canInitialize ? {} : {
        status: STOCK_VALUATION_STATUS_UNVALUED,
        quantityInBaseUnits: report.physicalQuantityInBaseUnits,
        valueInCentimes: null,
      }),
    });

    if (!canInitialize && !report.complete) {
      // Loading/return integration and historical replay follow this phase. Preserve
      // the ledger and its pointer, but never extend an unreconciled known balance.
      valuation = {
        ...valuation,
        status: STOCK_VALUATION_STATUS_UNVALUED,
        quantityInBaseUnits: report.physicalQuantityInBaseUnits,
        valueInCentimes: null,
      };
    }

    for (const { line, movement } of productLines) {
      if (valuation.status === STOCK_VALUATION_STATUS_UNVALUED) {
        valuation = {
          ...valuation,
          quantityInBaseUnits: toStockQuantity(
            BigInt(valuation.quantityInBaseUnits) + BigInt(line.quantityInBaseUnits),
          ),
          updatedAt: movement.recordedAt,
        };
        continue;
      }

      const transition = calculateStockReceipt({
        balance: valuation,
        quantityInBaseUnits: line.quantityInBaseUnits,
        amountInCentimes: line.amountInCentimes,
      });
      const revision = valuation.revision + 1;
      const entry = createStockValuationEntry({ movement, ...transition, revision });
      await database.collection('stockValuationEntries').insertOne(entry, { session });
      valuation = {
        ...valuation,
        ...transition.after,
        revision,
        lastLedgerEntryId: entry._id,
        updatedAt: movement.recordedAt,
      };
    }

    if (stored) {
      const result = await database.collection('stockValuations').replaceOne(
        { _id: stored._id, revision: stored.revision }, valuation, { session },
      );

      if (result.matchedCount !== 1) {
        throw new Error('The locked stock valuation changed during the reception transaction.');
      }
    } else {
      await database.collection('stockValuations').insertOne(valuation, { session });
    }
  }
};
