const FILTER_KEYS = {
  journal: ['q', 'livreur', 'du', 'au', 'page'],
  restes: ['resteRecherche', 'restePage'],
};

export const readCashView = (value) => (Array.isArray(value) ? value[0] : value) === 'restes' ? 'restes' : 'journal';

export const buildCashViewHref = (search, view) => {
  const parameters = new URLSearchParams(search);
  parameters.set('vue', readCashView(view));
  return `/caisse?${parameters}`;
};

export const buildCashFilterHref = (search, view, fields = []) => {
  const parameters = new URLSearchParams(search);
  const activeView = readCashView(view);
  for (const key of FILTER_KEYS[activeView]) parameters.delete(key);
  for (const [key, value] of fields) {
    if (FILTER_KEYS[activeView].includes(key) && typeof value === 'string' && value.trim()) parameters.set(key, value);
  }
  parameters.set('vue', activeView);
  return `/caisse?${parameters}`;
};

export const formatCashSignedAmount = (value) => Number.isSafeInteger(value)
  ? `${value < 0 ? '−' : ''}${new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 }).format(Math.abs(value) / 100)} DA`
  : 'Non calculable';
