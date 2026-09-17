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

export const OBJECTIVE_ACHIEVEMENT_STATUSES = Object.freeze({
  ongoing: 'En cours', reached: 'Atteint', missed: 'Non atteint',
  undefined: 'Objectif non défini', incomplete: 'Calcul incomplet',
});

export const getObjectiveAchievementStatus = (achievement, currentMonth = getObjectiveCurrentMonth()) => {
  if (!achievement.complete) return 'incomplete';
  if (achievement.targetInCentimes === null) return 'undefined';
  if (achievement.reached) return 'reached';
  return achievement.month < currentMonth ? 'missed' : 'ongoing';
};

export const formatObjectivePercentage = (value) => value === null ? '—'
  : `${new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 1 }).format(value)} %`;

export const readObjectiveAchievementState = (params = {}, currentMonth = getObjectiveCurrentMonth()) => {
  const month = single(params.bilanMois);
  const year = single(params.bilanAnnee);
  const status = single(params.bilanStatut);
  const query = single(params.bilanRecherche);
  const rawPage = single(params.bilanPage);
  const page = typeof rawPage === 'string' && /^\d+$/u.test(rawPage) ? Number(rawPage) : 1;
  return {
    achievementMonth: isObjectiveMonth(month) ? month : currentMonth,
    historyYear: typeof year === 'string' && /^[1-9]\d{3}$/u.test(year) ? year : currentMonth.slice(0, 4),
    historyStatus: typeof status === 'string' && Object.hasOwn(OBJECTIVE_ACHIEVEMENT_STATUSES, status) ? status : '',
    historyQuery: typeof query === 'string' ? query.trim().slice(0, 100) : '',
    historyPage: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
};

export const readObjectiveDirectoryState = (params = {}, currentMonth = getObjectiveCurrentMonth()) => {
  const month = single(params.mois);
  const status = single(params.realisation);
  return {
    month: isObjectiveMonth(month) ? month : currentMonth,
    achievementStatus: typeof status === 'string' && Object.hasOwn(OBJECTIVE_ACHIEVEMENT_STATUSES, status) ? status : '',
  };
};

export const buildObjectiveMonthlyHistory = ({ firstMonth, currentMonth, state, readMonth }) => {
  const firstYear = Number(firstMonth.slice(0, 4));
  const currentYear = Number(currentMonth.slice(0, 4));
  const years = Array.from({ length: currentYear - firstYear + 1 }, (_, index) => String(currentYear - index));
  const historyYear = years.includes(state.historyYear) ? state.historyYear : String(currentYear);
  const rows = Array.from({ length: 12 }, (_, index) => `${historyYear}-${String(12 - index).padStart(2, '0')}`)
    .filter((month) => month >= firstMonth && month <= currentMonth).map(readMonth)
    .filter((row) => (!state.historyStatus || row.status === state.historyStatus)
      && `${row.month} ${formatObjectiveMonth(row.month)} ${OBJECTIVE_ACHIEVEMENT_STATUSES[row.status]}`
        .toLocaleLowerCase('fr').includes(state.historyQuery.toLocaleLowerCase('fr')));
  const totalPages = Math.max(1, Math.ceil(rows.length / 5));
  const historyPage = Math.min(state.historyPage, totalPages);
  return {
    ...state, historyYear, historyPage, years, totalItems: rows.length, totalPages,
    rows: rows.slice((historyPage - 1) * 5, historyPage * 5),
  };
};

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
