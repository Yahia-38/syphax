import { readTab, TAB_PARAMETER } from './tab-navigation.js';

const single = (value) => Array.isArray(value) ? value[0] : value;

// The filters that belong to the tournées tab: their presence alone names the
// tab, so a link that carries them does not have to name it twice.
const TOUR_FILTER_KEYS = ['tourneeRecherche', 'tourneeDate', 'tourneePage'];

export const DELIVERER_TAB_KEYS = Object.freeze([
  'ensemble',
  'objectifs',
  'tournees',
  'identification',
]);

export const getDelivererTabs = ({ canReadCash, canReadCreditLimit, canReadObjectives, canReadTours }) => [
  ...((canReadCash || canReadCreditLimit) ? [{ key: 'ensemble', label: 'Vue d’ensemble' }] : []),
  ...(canReadObjectives ? [{ key: 'objectifs', label: 'Objectifs' }] : []),
  ...(canReadTours ? [{ key: 'tournees', label: 'Tournées' }] : []),
  { key: 'identification', label: 'Identification' },
];

export const readDelivererTab = (query, tabs) => {
  // Opening the fiche to edit it overrides the tab the address names.
  if (single(query.modifier) === '1') return 'identification';

  const inferred = !(TAB_PARAMETER in query)
    && TOUR_FILTER_KEYS.some((key) => key in query)
    ? 'tournees'
    : undefined;

  return readTab(query, tabs, inferred);
};
