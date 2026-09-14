'use client';

import { useMemo, useState } from 'react';

const LINES_PER_PAGE = 5;

const formatQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(quantity);

const TourProductList = ({ lines }) => {
  const [query, setQuery] = useState('');
  const [quantityMode, setQuantityMode] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filteredLines = useMemo(
    () => lines.filter((line) => {
      const matchesQuery = !normalizedQuery
        || line.productCode.toLocaleLowerCase('fr').includes(normalizedQuery)
        || line.productDesignation.toLocaleLowerCase('fr').includes(
          normalizedQuery,
        );
      const matchesMode = quantityMode === 'ALL'
        || line.quantityMode === quantityMode;

      return matchesQuery && matchesMode;
    }),
    [lines, normalizedQuery, quantityMode],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredLines.length / LINES_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstLineIndex = (activePage - 1) * LINES_PER_PAGE;
  const paginatedLines = filteredLines.slice(
    firstLineIndex,
    firstLineIndex + LINES_PER_PAGE,
  );
  const filtersActive = Boolean(normalizedQuery || quantityMode !== 'ALL');

  const resetFilters = () => {
    setQuery('');
    setQuantityMode('ALL');
    setCurrentPage(1);
  };

  return (
    <section
      aria-labelledby='tour-products-title'
      className='mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='border-b border-slate-200 p-5 sm:p-6'>
        <h2 className='text-lg font-semibold text-slate-900' id='tour-products-title'>
          Produits réservés
        </h2>
        <p className='mt-1 text-sm text-slate-600'>
          {lines.length} ligne{lines.length > 1 ? 's' : ''} dans la tournée.
        </p>
      </div>

      <div className='space-y-4 border-b border-slate-200 p-5 sm:p-6' role='search'>
        <div className='grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]'>
          <div>
            <label className='sr-only' htmlFor='tour-line-search'>
              Rechercher une ligne
            </label>
            <input
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              id='tour-line-search'
              maxLength={100}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder='Rechercher par code ou désignation'
              type='search'
              value={query}
            />
          </div>
          <div aria-label='Filtrer le mode de quantité' className='flex gap-2' role='group'>
            {[
              ['ALL', 'Tous'],
              ['DIRECT', 'Direct'],
              ['PACKAGING', 'Conditionné'],
            ].map(([value, label]) => (
              <button
                aria-pressed={quantityMode === value}
                className={`rounded-full border px-3 py-2 text-sm font-medium ${quantityMode === value ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                key={value}
                onClick={() => {
                  setQuantityMode(value);
                  setCurrentPage(1);
                }}
                type='button'
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {filtersActive && (
          <button
            className='text-sm font-medium text-blue-700 hover:underline'
            onClick={resetFilters}
            type='button'
          >
            Réinitialiser les filtres
          </button>
        )}
      </div>

      {paginatedLines.length > 0 ? (
        <div className='divide-y divide-slate-100'>
          {paginatedLines.map((line) => (
            <article className='p-5 sm:p-6' key={line.id}>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                <div className='min-w-0'>
                  <p className='break-all font-mono text-sm font-semibold text-blue-700'>
                    {line.productCode}
                  </p>
                  <h3 className='mt-1 break-words font-semibold text-slate-900'>
                    {line.productDesignation}
                  </h3>
                  <p className='mt-2 text-sm text-slate-600'>
                    {line.packaging
                      ? `${line.packaging.count} × ${line.packaging.label} de ${formatQuantity(line.packaging.quantity)} ${line.baseUnit}`
                      : 'Quantité saisie directement en unité de base'}
                  </p>
                </div>
                <div className='shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:text-right'>
                  <p className='text-xs font-semibold uppercase tracking-wide text-amber-700'>
                    Réservé
                  </p>
                  <p className='mt-1 text-xl font-bold tabular-nums text-amber-950'>
                    {formatQuantity(line.quantityInBaseUnits)} {line.baseUnit}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className='p-10 text-center'>
          <p className='font-semibold text-slate-900'>Aucune ligne trouvée</p>
          <p className='mt-1 text-sm text-slate-600'>
            Modifiez la recherche ou les filtres.
          </p>
        </div>
      )}

      <nav
        aria-label='Pagination des produits réservés'
        className='flex items-center justify-between gap-4 border-t border-slate-200 px-5 py-4 sm:px-6'
      >
        <button
          className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40'
          disabled={activePage === 1}
          onClick={() => setCurrentPage(activePage - 1)}
          type='button'
        >
          Précédent
        </button>
        <span className='text-sm text-slate-600'>
          Page {activePage} sur {totalPages}
        </span>
        <button
          className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40'
          disabled={activePage === totalPages}
          onClick={() => setCurrentPage(activePage + 1)}
          type='button'
        >
          Suivant
        </button>
      </nav>
    </section>
  );
};

export default TourProductList;
