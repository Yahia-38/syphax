import { readTab, TAB_PARAMETER, withTab } from './tab-navigation.js';

export const CASH_TABS = Object.freeze([
  { key: 'journal', label: 'Journal' },
  { key: 'restes', label: 'À encaisser' },
]);

const FILTER_KEYS = {
  journal: ['q', 'livreur', 'du', 'au', 'page'],
  restes: ['resteRecherche', 'restePage'],
};

export const readCashTab = (value) => readTab({ [TAB_PARAMETER]: value }, CASH_TABS);

export const buildCashTabHref = (search, tab) => `/caisse?${withTab(search, readCashTab(tab))}`;

// Switching tabs keeps the other tab's filters: each view owns its own keys.
export const buildCashFilterHref = (search, tab, fields = []) => {
  const activeTab = readCashTab(tab);
  const parameters = withTab(search, activeTab);
  for (const key of FILTER_KEYS[activeTab]) parameters.delete(key);
  for (const [key, value] of fields) {
    if (FILTER_KEYS[activeTab].includes(key) && typeof value === 'string' && value.trim()) parameters.set(key, value);
  }
  return `/caisse?${parameters}`;
};

export const formatCashSignedAmount = (value) => Number.isSafeInteger(value)
  ? `${value < 0 ? '−' : ''}${new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 }).format(Math.abs(value) / 100)} DA`
  : 'Non calculable';
