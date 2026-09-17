export const isObjectiveMonth = (value) => typeof value === 'string'
  && /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/u.test(value);

export const getObjectiveCurrentMonth = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Algiers', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  return `${parts.find(({ type }) => type === 'year').value}-${parts.find(({ type }) => type === 'month').value}`;
};

export const formatObjectiveMonth = (month) => isObjectiveMonth(month)
  ? new Intl.DateTimeFormat('fr-DZ', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T00:00:00Z`)) : 'Mois indisponible';

export const formatObjectiveChangedAt = (value) => value
  ? new Intl.DateTimeFormat('fr-DZ', {
    dateStyle: 'long', timeStyle: 'short', hourCycle: 'h23', timeZone: 'Africa/Algiers',
  }).format(new Date(value)) : 'Date indisponible';

// Later revisions at the same effective month supersede earlier revisions.
// A change never replaces a separately scheduled change for a later month.
export const resolveDelivererObjective = (history, month) => {
  if (!isObjectiveMonth(month)) return null;
  return (history ?? []).reduce((selected, entry) => {
    if (entry.effectiveMonth > month) return selected;
    return !selected || entry.effectiveMonth > selected.effectiveMonth
      || (entry.effectiveMonth === selected.effectiveMonth && entry.version > selected.version)
      ? entry : selected;
  }, null);
};

const single = (value) => Array.isArray(value) ? value[0] : value;

export const readObjectiveHistoryState = (params = {}) => {
  const query = single(params.objectifRecherche);
  const month = single(params.objectifMois);
  const rawPage = single(params.objectifPage);
  const page = typeof rawPage === 'string' && /^\d+$/u.test(rawPage) ? Number(rawPage) : 1;
  return {
    objectiveQuery: typeof query === 'string' ? query.trim().slice(0, 100) : '',
    objectiveMonth: isObjectiveMonth(month) ? month : '',
    objectivePage: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
};
