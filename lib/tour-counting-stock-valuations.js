import { STOCK_VALUATION_VERSION, calculateStockReturn } from './stock-valuation-calculations.js';
import { createStockValuationEntry } from './stock-valuation-records.js';
import { readStoredStockValuationReconciliation } from './stock-valuations.js';
import { TOUR_LOADING_OUTPUT_KIND, TOUR_RETURN_INPUT_KIND } from './stock-movements.js';
import { normalizeLoadingPurchaseCost, summarizeCountingPurchaseCosts } from './tour-counting-purchase-costs.js';

// Internal preparation requires a snapshot transaction; applying also requires
// the counting caller's product stockReferenceVersion locks.
export const prepareTourCountingStockValuations = async ({ database, session, tourId, lines }) => {
  if (!session?.inTransaction()) throw new TypeError('Counting valuation requires a transaction.');
  const balances = new Map();
  const transitions = [];
  const allocated = [];
  for (const line of lines) {
    const cost = normalizeLoadingPurchaseCost(line);
    if (!cost) {
      throw new RangeError('Le coût d’achat historique du chargement est manquant ou invalide. Migrez l’historique avant de compter.');
    }
    const productKey = line.productId.toHexString();
    let valuation = balances.get(productKey);
    if (!valuation) {
      const report = await readStoredStockValuationReconciliation({
        database, session, productId: line.productId, baseUnit: line.baseUnit,
      });
      if (!report.complete) {
        throw new RangeError('La valorisation du stock est incomplète. Réconciliez ou migrez l’historique avant de compter.');
      }
      valuation = await database.collection('stockValuations').findOne({ productId: line.productId }, { session });
    }
    if (valuation.baseUnit !== line.baseUnit) throw new RangeError('Les unités historiques du comptage sont incompatibles.');
    const reservationId = line.sourceTourReservationId ?? line._id;
    const loading = await database.collection('stockValuationEntries').findOne({
      kind: TOUR_LOADING_OUTPUT_KIND, sourceTourReservationId: reservationId,
      sourceTourId: tourId, productId: line.productId, version: STOCK_VALUATION_VERSION,
    }, { session });
    const existingReturn = await database.collection('stockValuationEntries').findOne({
      kind: TOUR_RETURN_INPUT_KIND, sourceTourReservationId: reservationId,
      version: STOCK_VALUATION_VERSION,
    }, { session });
    if (!loading || loading.baseUnit !== line.baseUnit
      || -loading.quantityDeltaInBaseUnits !== cost.quantityInBaseUnits
      || -loading.valueDeltaInCentimes !== cost.valueInCentimes || existingReturn) {
      throw new RangeError('Le coût d’achat historique ne correspond pas au chargement valorisé ou un retour existe déjà. Réconciliez l’historique avant de compter.');
    }
    const transition = calculateStockReturn({
      balance: valuation, loadedQuantityInBaseUnits: cost.quantityInBaseUnits,
      loadedValueInCentimes: cost.valueInCentimes,
      returnedQuantityInBaseUnits: line.returnedQuantityInBaseUnits,
    });
    allocated.push({
      ...line, purchaseCostAtLoading: cost,
      returnedValueInCentimes: transition.returnedValueInCentimes,
      costOfGoodsSoldInCentimes: transition.costOfGoodsSoldInCentimes,
    });
    if (line.returnedQuantityInBaseUnits > 0) {
      transitions.push({ reservationId, valuation, before: transition.before, after: transition.after });
      valuation = { ...valuation, ...transition.after, revision: valuation.revision + 1 };
    }
    balances.set(productKey, valuation);
  }
  return { lines: allocated, transitions, ...summarizeCountingPurchaseCosts(allocated) };
};

export const applyTourCountingStockValuations = async ({ database, session, prepared, movements }) => {
  if (!session?.inTransaction()) throw new TypeError('Counting valuation requires a transaction.');
  const byReservation = new Map(movements.map((movement) => [movement.sourceTourReservationId.toHexString(), movement]));
  for (const { reservationId, valuation, before, after } of prepared.transitions) {
    const movement = byReservation.get(reservationId.toHexString());
    const entry = createStockValuationEntry({ movement, before, after, revision: valuation.revision + 1 });
    await database.collection('stockValuationEntries').insertOne(entry, { session });
    const result = await database.collection('stockValuations').updateOne(
      { _id: valuation._id, revision: valuation.revision },
      { $set: { ...after, revision: entry.revision, lastLedgerEntryId: entry._id, updatedAt: movement.recordedAt } },
      { session },
    );
    if (result.matchedCount !== 1) throw new Error('The locked stock valuation changed during counting.');
  }
};
