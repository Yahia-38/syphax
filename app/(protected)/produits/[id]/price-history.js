'use client';

import { useMemo, useState } from 'react';

const HISTORY_PER_PAGE = 5;

const CHANGE_TYPES = [
  { label: 'Premier prix', value: 'INITIAL' },
  { label: 'Hausses', value: 'INCREASE' },
  { label: 'Baisses', value: 'DECREASE' },
  { label: 'Sans variation', value: 'UNCHANGED' },
];

const formatDate = (value) => {
  if (!value) {
    return 'Date non renseignée';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Africa/Algiers',
  }).format(new Date(value));
};

const formatMoney = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) {
    return 'Non renseigné';
  }

  return `${new Intl.NumberFormat('fr-DZ', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amountInCentimes / 100)} DA`;
};

const getChangeType = (entry) => {
  if (!Number.isSafeInteger(entry.oldAmountInCentimes)) {
    return 'INITIAL';
  }

  if (entry.newAmountInCentimes > entry.oldAmountInCentimes) {
    return 'INCREASE';
  }

  if (entry.newAmountInCentimes < entry.oldAmountInCentimes) {
    return 'DECREASE';
  }

  return 'UNCHANGED';
};

const PriceHistory = ({ history }) => {
  const [query, setQuery] = useState('');
  const [changeType, setChangeType] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const availableChangeTypes = useMemo(() => {
    const usedTypes = new Set(history.map(getChangeType));
    return CHANGE_TYPES.filter(({ value }) => usedTypes.has(value));
  }, [history]);
  const filteredHistory = useMemo(
    () => history.filter((entry) => {
      const searchText = [
        entry.changedBy ?? 'Compte indisponible',
        formatDate(entry.changedAt),
        formatMoney(entry.oldAmountInCentimes),
        formatMoney(entry.newAmountInCentimes),
      ].join(' ').toLocaleLowerCase('fr');
      const matchesQuery = !normalizedQuery
        || searchText.includes(normalizedQuery);
      const matchesType = changeType === 'ALL'
        || getChangeType(entry) === changeType;

      return matchesQuery && matchesType;
    }),
    [changeType, history, normalizedQuery],
  );
  const filtersActive = Boolean(normalizedQuery || changeType !== 'ALL');
  const totalPages = Math.max(
    1,
    Math.ceil(filteredHistory.length / HISTORY_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstHistoryIndex = (activePage - 1) * HISTORY_PER_PAGE;
  const paginatedHistory = filteredHistory.slice(
    firstHistoryIndex,
    firstHistoryIndex + HISTORY_PER_PAGE,
  );

  if (history.length === 0) {
    return null;
  }

  const resetFilters = () => {
    setQuery('');
    setChangeType('ALL');
    setCurrentPage(1);
  };

  return (
    <section
      aria-labelledby='price-history-title'
      className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='border-b border-slate-100 px-6 py-5'>
        <h2
          className='text-lg font-semibold text-slate-900'
          id='price-history-title'
        >
          Historique du prix
        </h2>
        <p className='mt-1 text-sm leading-6 text-slate-600'>
          {history.length === 1
            ? '1 changement enregistré.'
            : `${history.length} changements enregistrés.`}
        </p>
      </div>

      <div className='flex flex-wrap items-end gap-3 border-b border-slate-100 p-4'>
        <div className='min-w-[220px] flex-1'>
          <label className='sr-only' htmlFor='price-history-search'>
            Rechercher dans l’historique
          </label>
          <input
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
            id='price-history-search'
            maxLength={100}
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrentPage(1);
            }}
            placeholder='Rechercher par auteur, date ou montant'
            type='search'
            value={query}
          />
        </div>
        <div>
          <label className='sr-only' htmlFor='price-change-filter'>
            Filtrer par type de variation
          </label>
          <select
            className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
            id='price-change-filter'
            onChange={(event) => {
              setChangeType(event.target.value);
              setCurrentPage(1);
            }}
            value={changeType}
          >
            <option value='ALL'>Toutes les variations</option>
            {availableChangeTypes.map(({ label, value }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {filtersActive && (
          <button
            className='rounded-lg px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={resetFilters}
            type='button'
          >
            Réinitialiser
          </button>
        )}
      </div>

      <div className='border-b border-slate-100 px-6 py-3'>
        <p className='text-sm text-slate-500'>
          {filteredHistory.length > 0
            ? `${firstHistoryIndex + 1}–${firstHistoryIndex + paginatedHistory.length} sur ${filteredHistory.length} changements${filtersActive ? ` (${history.length} au total)` : ''}`
            : `0 changement sur ${history.length}`}
        </p>
      </div>

      {paginatedHistory.length > 0 ? (
        <ul>
          {paginatedHistory.map((entry, index) => (
            <li
              className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 ${index > 0 ? 'border-t border-slate-100' : ''}`}
              key={entry.id}
            >
              <p className='text-sm font-medium text-slate-900'>
                {formatMoney(entry.oldAmountInCentimes)}{' '}
                <span className='text-slate-400'>→</span>{' '}
                <span className='font-semibold text-emerald-700'>
                  {formatMoney(entry.newAmountInCentimes)}
                </span>
              </p>
              <p className='text-[13px] text-slate-500'>
                {formatDate(entry.changedAt)} ·{' '}
                {entry.changedBy ?? 'Compte indisponible'}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div className='px-6 py-10 text-center'>
          <p className='font-semibold text-slate-800'>
            Aucun changement trouvé
          </p>
          <p className='mt-2 text-sm text-slate-500'>
            Modifiez la recherche ou le filtre de variation.
          </p>
          <button
            className='mt-4 rounded-lg px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={resetFilters}
            type='button'
          >
            Voir tout l’historique
          </button>
        </div>
      )}

      <nav
        aria-label='Pagination de l’historique des prix'
        className='flex items-center justify-between gap-4 border-t border-slate-100 px-6 py-3'
      >
        <button
          className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40'
          disabled={activePage === 1 || filteredHistory.length === 0}
          onClick={() => setCurrentPage(activePage - 1)}
          type='button'
        >
          Précédent
        </button>
        <p aria-live='polite' className='text-sm font-medium text-slate-600'>
          Page {activePage} sur {totalPages}
        </p>
        <button
          className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40'
          disabled={activePage === totalPages || filteredHistory.length === 0}
          onClick={() => setCurrentPage(activePage + 1)}
          type='button'
        >
          Suivant
        </button>
      </nav>
    </section>
  );
};

export default PriceHistory;
