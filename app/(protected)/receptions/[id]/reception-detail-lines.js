'use client';

import { useMemo, useState } from 'react';

import {
  formatReceptionMoney,
  formatReceptionUnitCost,
} from '../../../../lib/receptions.js';

const LINES_PER_PAGE = 10;

const formatQuantity = (quantity, baseUnit, unitLabels) => {
  if (!Number.isSafeInteger(quantity)) {
    return 'Quantité non renseignée';
  }

  const label = unitLabels.get(baseUnit) ?? baseUnit ?? 'unité';
  const normalizedLabel = label.toLocaleLowerCase('fr');

  return `${new Intl.NumberFormat('fr-DZ').format(quantity)} ${normalizedLabel}${quantity > 1 ? 's' : ''}`;
};

const formatEnteredQuantity = (line, unitLabels) => {
  if (line.quantityMode === 'PACKAGING') {
    const { packaging } = line;

    if (
      packaging
      && Number.isSafeInteger(packaging.count)
      && Number.isSafeInteger(packaging.quantity)
    ) {
      return `${packaging.count} × ${packaging.label} (${formatQuantity(packaging.quantity, line.baseUnit, unitLabels)}) = ${formatQuantity(line.quantityInBaseUnits, line.baseUnit, unitLabels)}`;
    }

    return 'Détail du conditionnement non renseigné';
  }

  if (line.quantityMode === 'DIRECT') {
    return `${formatQuantity(line.directQuantity, line.baseUnit, unitLabels)} saisies directement`;
  }

  return 'Mode de saisie non renseigné';
};

const ReceptionLine = ({ index, line, unitLabels }) => {
  const unitCost = formatReceptionUnitCost(line);
  const baseUnitLabel = (unitLabels.get(line.baseUnit)
    ?? line.baseUnit
    ?? 'unité').toLocaleLowerCase('fr');

  return (
    <article className='rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div className='min-w-0'>
          <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Ligne {index + 1}
          </p>
          <h3 className='mt-1 break-words text-lg font-semibold text-slate-900'>
            {line.productCode}
            {line.productDesignation ? ` — ${line.productDesignation}` : ''}
          </h3>
          <p className='mt-2 text-sm font-medium text-slate-700'>
            {line.quantityMode === 'PACKAGING'
              ? 'Saisie par conditionnement'
              : line.quantityMode === 'DIRECT'
                ? 'Saisie en unités directes'
                : 'Mode de saisie non renseigné'}
          </p>
          <p className='mt-1 break-words text-sm leading-6 text-slate-600'>
            {formatEnteredQuantity(line, unitLabels)}
          </p>
        </div>
        <div className='rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 sm:text-right'>
          <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
            Quantité totale reçue
          </p>
          <p className='mt-1 text-xl font-bold text-blue-950'>
            {formatQuantity(line.quantityInBaseUnits, line.baseUnit, unitLabels)}
          </p>
        </div>
      </div>

      <dl className='mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2'>
        <div className='rounded-lg bg-slate-50 px-4 py-3'>
          <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Montant TTC de la ligne
          </dt>
          <dd className='mt-1 text-base font-semibold text-slate-900'>
            {formatReceptionMoney(line.amountInCentimes)}
          </dd>
        </div>
        <div className='rounded-lg bg-slate-50 px-4 py-3'>
          <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Coût unitaire TTC
          </dt>
          <dd className='mt-1 text-base font-semibold text-slate-900'>
            {unitCost}
            {unitCost !== 'Non calculable' && (
              <span className='ml-1 text-sm font-normal text-slate-500'>
                / {baseUnitLabel}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
};

const ReceptionDetailLines = ({ baseUnits, lines }) => {
  const [query, setQuery] = useState('');
  const [quantityMode, setQuantityMode] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const unitLabels = useMemo(
    () => new Map(baseUnits.map(({ code, label }) => [code, label])),
    [baseUnits],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filteredLines = useMemo(() => lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => {
      const searchableText = [
        line.productCode,
        line.productDesignation,
        line.packaging?.label,
      ].filter(Boolean).join(' ').toLocaleLowerCase('fr');
      const matchesQuery = !normalizedQuery
        || searchableText.includes(normalizedQuery);
      const matchesMode = quantityMode === 'ALL'
        || line.quantityMode === quantityMode;

      return matchesQuery && matchesMode;
    }), [lines, normalizedQuery, quantityMode]);
  const totalPages = Math.max(1, Math.ceil(filteredLines.length / LINES_PER_PAGE));
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
    <section aria-labelledby='reception-lines-title' className='mt-8'>
      <div>
        <h2 className='text-xl font-semibold text-slate-900' id='reception-lines-title'>
          Lignes produits
        </h2>
        <p className='mt-1 text-sm leading-6 text-slate-600'>
          {lines.length} ligne{lines.length > 1 ? 's' : ''} enregistrée{lines.length > 1 ? 's' : ''} avec les libellés historiques.
        </p>
      </div>

      <div className='mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'>
        <div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,auto)]' role='search'>
          <div>
            <label className='sr-only' htmlFor='reception-line-search'>
              Rechercher une ligne
            </label>
            <input
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              id='reception-line-search'
              maxLength={100}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder='Code, désignation ou conditionnement'
              type='search'
              value={query}
            />
          </div>
          <div>
            <label className='sr-only' htmlFor='reception-line-mode'>
              Filtrer par mode de saisie
            </label>
            <select
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              id='reception-line-mode'
              onChange={(event) => {
                setQuantityMode(event.target.value);
                setCurrentPage(1);
              }}
              value={quantityMode}
            >
              <option value='ALL'>Tous les modes de saisie</option>
              <option value='DIRECT'>Unités directes</option>
              <option value='PACKAGING'>Conditionnements</option>
            </select>
          </div>
        </div>
        <div className='mt-3 flex min-h-9 items-center justify-between gap-4'>
          <p className='text-sm text-slate-500'>
            {filteredLines.length > 0
              ? `${firstLineIndex + 1}–${firstLineIndex + paginatedLines.length} sur ${filteredLines.length} lignes${filtersActive ? ` (${lines.length} au total)` : ''}`
              : `0 ligne${filtersActive ? ` sur ${lines.length}` : ''}`}
          </p>
          {filtersActive && (
            <button
              className='rounded-lg px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              onClick={resetFilters}
              type='button'
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>
      </div>

      {paginatedLines.length > 0 ? (
        <div className='mt-4 space-y-4'>
          {paginatedLines.map(({ index, line }) => (
            <ReceptionLine
              index={index}
              key={line.id || index}
              line={line}
              unitLabels={unitLabels}
            />
          ))}
        </div>
      ) : (
        <div className='mt-4 rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm'>
          <h3 className='font-semibold text-slate-900'>Aucune ligne trouvée</h3>
          <p className='mt-2 text-sm leading-6 text-slate-600'>
            Modifiez la recherche ou le filtre de mode de saisie.
          </p>
        </div>
      )}

      <nav
        aria-label='Pagination des lignes de réception'
        className='mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6'
      >
        <button
          className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40'
          disabled={activePage === 1}
          onClick={() => setCurrentPage(activePage - 1)}
          type='button'
        >
          Précédent
        </button>
        <p aria-live='polite' className='text-sm font-medium text-slate-600'>
          Page {activePage} sur {totalPages}
        </p>
        <button
          className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40'
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

export default ReceptionDetailLines;
