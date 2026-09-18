// How the report's totals read on the page: which tours each one covers and
// whether it can be shown as an amount. Presentation only: the totals come
// from the reader and are never recomputed here.
export const PROFITABILITY_TOTAL_STATES = Object.freeze({
  COMPLETE: 'COMPLETE',
  EMPTY: 'EMPTY',
  OVERFLOW: 'OVERFLOW',
  PARTIAL: 'PARTIAL',
  UNKNOWN: 'UNKNOWN',
});

// The reader adds only known amounts, so a total with no known amount is 0:
// it reads as unknown, never as a zero result.
export const describeProfitabilityTotal = ({ amountInCentimes, complete, unknownCount }, tourCount) => {
  const knownCount = Math.max(0, tourCount - unknownCount);
  const state = (() => {
    if (tourCount === 0) return PROFITABILITY_TOTAL_STATES.EMPTY;
    if (knownCount === 0) return PROFITABILITY_TOTAL_STATES.UNKNOWN;
    if (amountInCentimes === null) return PROFITABILITY_TOTAL_STATES.OVERFLOW;

    return complete ? PROFITABILITY_TOTAL_STATES.COMPLETE : PROFITABILITY_TOTAL_STATES.PARTIAL;
  })();

  return {
    amountInCentimes: state === PROFITABILITY_TOTAL_STATES.UNKNOWN || state === PROFITABILITY_TOTAL_STATES.OVERFLOW
      ? null
      : amountInCentimes,
    knownCount,
    state,
    tourCount,
    unknownCount,
  };
};

const COVERAGE_LABELS = Object.freeze({
  COMPLETE: 'complet',
  OVERFLOW: 'total non calculable',
  PARTIAL: 'partiel',
  UNKNOWN: 'aucun montant connu',
});

export const formatProfitabilityCoverage = ({ knownCount, state, tourCount }) => {
  if (state === PROFITABILITY_TOTAL_STATES.EMPTY) return 'Aucune tournée dans la sélection';

  return `${knownCount} / ${tourCount} ${tourCount > 1 ? 'tournées' : 'tournée'} · ${COVERAGE_LABELS[state]}`;
};

// A known result keeps its colour: red when negative, amber when partial,
// green only when complete and positive. An unknown result stays neutral.
export const getProfitabilityResultTone = ({ amountInCentimes, state }) => {
  if (amountInCentimes === null || state === PROFITABILITY_TOTAL_STATES.EMPTY) return 'neutral';
  if (amountInCentimes < 0) return 'negative';
  if (state === PROFITABILITY_TOTAL_STATES.PARTIAL) return 'partial';

  return amountInCentimes > 0 ? 'positive' : 'neutral';
};

// Margin over sales, only when both cover every tour of the selection.
export const getProfitabilityMarginRate = ({ margin, sales }) =>
  margin.complete && sales.complete && sales.amountInCentimes > 0
    ? (margin.amountInCentimes / sales.amountInCentimes) * 100
    : null;

// Totals can be read against each other only when each covers every tour.
export const areProfitabilityTotalsComplete = (totals) =>
  ['sales', 'costOfGoodsSold', 'margin', 'expenses', 'result'].every((key) => totals[key].complete);
