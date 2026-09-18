import { readTab, TAB_PARAMETER } from './tab-navigation.js';

export const TOUR_TABS = Object.freeze([
  { key: 'operations', label: 'Opérations' },
  { key: 'produits', label: 'Produits & chargement' },
  { key: 'historique', label: 'Traçabilité' },
]);

// A tour still being prepared opens on its products; any other status opens on
// its operations.
const defaultTourTab = (status) => status === 'PREPARATION' ? 'produits' : 'operations';

export const readTourTab = (value, status) => readTab(
  { [TAB_PARAMETER]: value },
  TOUR_TABS,
  defaultTourTab(status),
);

export const buildTourTabHref = ({ tourId, returnHref, tab }) => {
  const params = new URLSearchParams({
    retour: returnHref,
    [TAB_PARAMETER]: readTourTab(tab),
  });

  return `/tournees/${tourId}?${params}`;
};
