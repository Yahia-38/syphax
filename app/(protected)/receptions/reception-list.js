'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  buildReceptionHistoryHref,
  formatReceptionDate,
} from '../../../lib/receptions.js';

const RECEPTIONS_PER_PAGE = 10;

const BASE_UNIT_LABELS = new Map([
  ['PIECE', 'pièces'],
  ['BOUTEILLE', 'bouteilles'],
  ['BOITE', 'boîtes'],
  ['SACHET', 'sachets'],
]);

const formatLineSummary = (line) => {
  const product = line.productDesignation
    ? `${line.productCode} — ${line.productDesignation}`
    : line.productCode;

  if (!Number.isSafeInteger(line.quantityInBaseUnits)) {
    return product;
  }

  const unit = BASE_UNIT_LABELS.get(line.baseUnit) ?? line.baseUnit ?? 'unités';

  return `${product} (${line.quantityInBaseUnits} ${unit})`;
};

const ReceptionList = ({
  initialPage = 1,
  initialQuery = '',
  initialSupplierId = 'ALL',
  receptions,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filtersActive = Boolean(normalizedQuery || supplierId !== 'ALL');
  const supplierOptions = useMemo(() => {
    const suppliers = new Map();

    for (const reception of receptions) {
      suppliers.set(reception.supplierId, reception.supplierName);
    }

    return [...suppliers.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((first, second) => first.name.localeCompare(second.name, 'fr'));
  }, [receptions]);
  const filteredReceptions = useMemo(() => receptions.filter((reception) => {
    const searchableText = [
      reception.supplierReference,
      reception.supplierName,
      ...reception.lines.flatMap((line) => [
        line.productCode,
        line.productDesignation,
      ]),
    ].join(' ').toLocaleLowerCase('fr');
    const matchesQuery = !normalizedQuery
      || searchableText.includes(normalizedQuery);
    const matchesSupplier = supplierId === 'ALL'
      || reception.supplierId === supplierId;

    return matchesQuery && matchesSupplier;
  }), [normalizedQuery, receptions, supplierId]);
  const totalPages = Math.max(
    1,
    Math.ceil(filteredReceptions.length / RECEPTIONS_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstReceptionIndex = (activePage - 1) * RECEPTIONS_PER_PAGE;
  const paginatedReceptions = filteredReceptions.slice(
    firstReceptionIndex,
    firstReceptionIndex + RECEPTIONS_PER_PAGE,
  );
  const historyHref = buildReceptionHistoryHref({
    page: activePage,
    query,
    supplierId,
  });

  const getReceptionHref = (receptionId) => {
    const parameters = new URLSearchParams({ retour: historyHref });

    return `/receptions/${receptionId}?${parameters.toString()}`;
  };

  const resetFilters = () => {
    setQuery('');
    setSupplierId('ALL');
    setCurrentPage(1);
  };

  return (
    <section
      aria-labelledby='reception-list-title'
      className='mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='border-b border-slate-200 p-5 sm:p-6'>
        <h2 className='text-lg font-semibold text-slate-900' id='reception-list-title'>
          Historique des réceptions
        </h2>
        <p className='mt-1 text-sm leading-6 text-slate-600'>
          Retrouvez les réceptions enregistrées et leurs quantités.
        </p>
      </div>

      <div className='border-b border-slate-200 p-4'>
        <div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,auto)]' role='search'>
          <div>
            <label className='sr-only' htmlFor='reception-search'>
              Rechercher une réception
            </label>
            <input
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              id='reception-search'
              maxLength={100}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder='Référence, fournisseur ou produit'
              type='search'
              value={query}
            />
          </div>
          <div>
            <label className='sr-only' htmlFor='reception-supplier-filter'>
              Filtrer par fournisseur
            </label>
            <select
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              id='reception-supplier-filter'
              onChange={(event) => {
                setSupplierId(event.target.value);
                setCurrentPage(1);
              }}
              value={supplierId}
            >
              <option value='ALL'>Tous les fournisseurs</option>
              {supplierOptions.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className='flex min-h-12 items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6'>
        <p className='text-sm text-slate-500'>
          {filteredReceptions.length > 0
            ? `${firstReceptionIndex + 1}–${firstReceptionIndex + paginatedReceptions.length} sur ${filteredReceptions.length} réceptions${filtersActive ? ` (${receptions.length} au total)` : ''}`
            : `0 réception${filtersActive ? ` sur ${receptions.length}` : ''}`}
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

      {filteredReceptions.length > 0 ? (
        <>
          <div className='divide-y divide-slate-100'>
            {paginatedReceptions.map((reception) => (
              <article className='p-5 sm:p-6' key={reception.id}>
                <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
                  <div className='min-w-0'>
                    <Link
                      className='break-words font-semibold text-blue-800 hover:text-blue-950 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                      href={getReceptionHref(reception.id)}
                    >
                      {reception.supplierReference}
                    </Link>
                    <p className='mt-1 text-sm text-slate-600'>
                      {reception.supplierName}
                    </p>
                  </div>
                  <p className='shrink-0 text-sm font-medium text-slate-700'>
                    {formatReceptionDate(reception.receptionDate)}
                  </p>
                </div>
                <p className='mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500'>
                  {reception.lines.length} ligne{reception.lines.length > 1 ? 's' : ''}
                </p>
                <p className='mt-2 break-words text-sm leading-6 text-slate-700'>
                  {reception.lines.length > 0
                    ? reception.lines.map(formatLineSummary).join(' · ')
                    : 'Aucune ligne enregistrée'}
                </p>
                <Link
                  className='mt-4 inline-flex text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                  href={getReceptionHref(reception.id)}
                >
                  Voir la fiche
                  <span aria-hidden='true' className='ml-1'>→</span>
                </Link>
              </article>
            ))}
          </div>

          <nav
            aria-label='Pagination des réceptions'
            className='flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3 sm:px-6'
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
        </>
      ) : (
        <div className='px-6 py-14 text-center'>
          <h3 className='font-semibold text-slate-900'>
            {filtersActive ? 'Aucune réception trouvée' : 'Aucune réception enregistrée'}
          </h3>
          <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
            {filtersActive
              ? 'Aucune réception ne correspond aux critères de recherche.'
              : 'Les réceptions validées apparaîtront ici.'}
          </p>
          {filtersActive && (
            <button
              className='mt-5 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              onClick={resetFilters}
              type='button'
            >
              Voir toutes les réceptions
            </button>
          )}
        </div>
      )}
    </section>
  );
};

export default ReceptionList;
