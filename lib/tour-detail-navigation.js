const VIEWS = ['operations', 'produits', 'historique'];
const single = (value) => Array.isArray(value) ? value[0] : value;

export const readTourView = (value, status) => VIEWS.includes(single(value))
  ? single(value)
  : status === 'PREPARATION' ? 'produits' : 'operations';

export const buildTourViewHref = ({ tourId, returnHref, view }) => {
  const params = new URLSearchParams({ retour: returnHref, vue: readTourView(view) });
  return `/tournees/${tourId}?${params}`;
};
