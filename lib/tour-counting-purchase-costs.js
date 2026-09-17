import {
  STOCK_VALUATION_METHOD,
  STOCK_VALUATION_VERSION,
  calculateLoadedStockCostSplit,
} from './stock-valuation-calculations.js';

// Whitelist snapshot fields before exposing historical costs to an authorized reader.
export const normalizeLoadingPurchaseCost = (line) => {
  const cost = line?.purchaseCostAtLoading;
  if (typeof line?.baseUnit !== 'string' || !line.baseUnit.trim()
    || cost?.method !== STOCK_VALUATION_METHOD
    || cost.version !== STOCK_VALUATION_VERSION
    || cost.baseUnit !== line.baseUnit
    || cost.quantityInBaseUnits !== line.quantityInBaseUnits
    || !Number.isSafeInteger(cost.quantityInBaseUnits) || cost.quantityInBaseUnits <= 0
    || !Number.isSafeInteger(cost.valueInCentimes) || cost.valueInCentimes < 0
    || cost.currency !== 'DZD' || cost.taxIncluded !== true) return null;

  return {
    method: cost.method, version: cost.version, baseUnit: cost.baseUnit,
    quantityInBaseUnits: cost.quantityInBaseUnits, valueInCentimes: cost.valueInCentimes,
    currency: cost.currency, taxIncluded: cost.taxIncluded,
  };
};

export const summarizeCountingPurchaseCosts = (lines) => {
  const totals = {
    totalPurchaseCostInCentimes: 0n,
    totalReturnedValueInCentimes: 0n,
    totalCostOfGoodsSoldInCentimes: 0n,
  };
  for (const line of lines) {
    totals.totalPurchaseCostInCentimes += BigInt(line.purchaseCostAtLoading.valueInCentimes);
    totals.totalReturnedValueInCentimes += BigInt(line.returnedValueInCentimes);
    totals.totalCostOfGoodsSoldInCentimes += BigInt(line.costOfGoodsSoldInCentimes);
  }
  if (Object.values(totals).some((value) => value > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new RangeError('Le coût d’achat total du comptage dépasse la limite autorisée.');
  }
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)]));
};

// Client previews use only permission-filtered snapshots. The server rechecks their sources.
export const calculateCountingPurchaseCosts = (lines, calculations) => {
  const byId = new Map(calculations.map((line) => [line.id, line]));
  try {
    const allocated = lines.map((line) => {
      const cost = normalizeLoadingPurchaseCost(line);
      const calculation = byId.get(line.id);
      if (!cost || calculation?.error
        || !Number.isSafeInteger(calculation?.returnedQuantityInBaseUnits)) {
        throw new RangeError('Les coûts nécessitent un coût historique valide et un retour entier pour chaque ligne.');
      }
      return {
        id: line.id,
        purchaseCostAtLoading: cost,
        ...calculateLoadedStockCostSplit({
          loadedQuantityInBaseUnits: cost.quantityInBaseUnits,
          loadedValueInCentimes: cost.valueInCentimes,
          returnedQuantityInBaseUnits: calculation.returnedQuantityInBaseUnits,
        }),
      };
    });
    return { complete: allocated.length > 0, lines: allocated, ...summarizeCountingPurchaseCosts(allocated) };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { complete: false, lines: [], error: error.message };
  }
};

// Stored allocations must exist and agree with the original snapshot. Do not
// silently reconstruct missing historical fields for a recorded counting.
export const readRecordedCountingPurchaseCosts = (counting) => {
  const lines = (counting.lines ?? []).map((line) => {
    const cost = normalizeLoadingPurchaseCost(line);
    const result = { purchaseCostAtLoading: cost, returnedValueInCentimes: null, costOfGoodsSoldInCentimes: null };
    if (!cost) return result;
    try {
      const expected = calculateLoadedStockCostSplit({
        loadedQuantityInBaseUnits: cost.quantityInBaseUnits, loadedValueInCentimes: cost.valueInCentimes,
        returnedQuantityInBaseUnits: line.returnedQuantityInBaseUnits,
      });
      if (line.returnedValueInCentimes !== expected.returnedValueInCentimes
        || line.costOfGoodsSoldInCentimes !== expected.costOfGoodsSoldInCentimes
        || line.soldQuantityInBaseUnits !== expected.soldQuantityInBaseUnits) return result;
      return { ...result, returnedValueInCentimes: expected.returnedValueInCentimes, costOfGoodsSoldInCentimes: expected.costOfGoodsSoldInCentimes };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return result;
    }
  });
  const unknownTotals = { totalPurchaseCostInCentimes: null, totalReturnedValueInCentimes: null, totalCostOfGoodsSoldInCentimes: null };
  if (!lines.length || lines.some((line) => line.returnedValueInCentimes === null)) return { lines, ...unknownTotals };
  try {
    const totals = summarizeCountingPurchaseCosts(lines);
    return { lines, ...(Object.entries(totals).every(([key, value]) => counting[key] === value) ? totals : unknownTotals) };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { lines, ...unknownTotals };
  }
};
