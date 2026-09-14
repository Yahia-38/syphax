'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

const MOVEMENTS_PER_PAGE = 8;

const formatDate = (value) => {
  if (!value) {
    return 'Date indisponible';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Africa/Algiers',
  }).format(new Date(value));
};

const formatQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(Math.abs(quantity));

const formatMovementKind = (kind) => kind === 'TOUR_LOADING_OUT'
  ? 'Chargement de tournée'
  : kind === 'RECEPTION_IN'
    ? 'Réception'
    : 'Mouvement physique';

const StockMovementHistory = ({ movements }) => {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filteredMovements = useMemo(() => movements.filter((movement) => {
    const matchesDirection = direction === 'ALL'
      || (direction === 'IN' && movement.quantityDeltaInBaseUnits > 0)
      || (direction === 'OUT' && movement.quantityDeltaInBaseUnits < 0);
    const searchableText = [
      formatMovementKind(movement.kind),
      movement.author,
      movement.sourceTour?.reference,
    ].filter(Boolean).join(' ').toLocaleLowerCase('fr');

    return matchesDirection
      && (!normalizedQuery || searchableText.includes(normalizedQuery));
  }), [direction, movements, normalizedQuery]);
  const totalPages = Math.max(
    1,
    Math.ceil(filteredMovements.length / MOVEMENTS_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstMovementIndex = (activePage - 1) * MOVEMENTS_PER_PAGE;
  const paginatedMovements = filteredMovements.slice(
    firstMovementIndex,
    firstMovementIndex + MOVEMENTS_PER_PAGE,
  );

  return (
    <section className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'>
      <div className='border-b border-slate-200 p-5 sm:p-6'>
        <h2 className='text-lg font-semibold text-slate-900'>Historique physique</h2>
        <p className='mt-1 text-sm text-slate-600'>
          Chaque entrée et sortie est conservée dans l’unité de base.
        </p>
      </div>

      <div className='space-y-4 border-b border-slate-200 p-5 sm:p-6' role='search'>
        <input
          aria-label='Rechercher un mouvement physique'
          className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
          maxLength={100}
          onChange={(event) => {
            setQuery(event.target.value);
            setCurrentPage(1);
          }}
          placeholder='Rechercher par type, auteur ou tournée'
          type='search'
          value={query}
        />
        <div aria-label='Filtrer les mouvements' className='flex flex-wrap gap-2' role='group'>
          {[
            ['ALL', 'Tous'],
            ['IN', 'Entrées'],
            ['OUT', 'Sorties'],
          ].map(([value, label]) => (
            <button
              aria-pressed={direction === value}
              className={`rounded-full border px-3 py-2 text-sm font-medium ${direction === value ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
              key={value}
              onClick={() => {
                setDirection(value);
                setCurrentPage(1);
              }}
              type='button'
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {paginatedMovements.length > 0 ? (
        <div className='divide-y divide-slate-100'>
          {paginatedMovements.map((movement) => {
            const isOutput = movement.quantityDeltaInBaseUnits < 0;

            return (
              <article className='flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6' key={movement.id}>
                <div>
                  <p className='font-semibold text-slate-900'>
                    {formatMovementKind(movement.kind)}
                  </p>
                  <p className='mt-1 text-sm text-slate-600'>
                    {formatDate(movement.occurredOn ?? movement.recordedAt)}
                    {' · '}
                    {movement.author ?? 'Compte indisponible'}
                  </p>
                  {movement.sourceTour && (
                    <Link
                      className='mt-2 inline-flex text-sm font-medium text-blue-700 hover:underline'
                      href={`/tournees/${movement.sourceTour.id}`}
                    >
                      Voir {movement.sourceTour.reference}
                    </Link>
                  )}
                </div>
                <p className={`text-xl font-bold tabular-nums ${isOutput ? 'text-red-700' : 'text-emerald-700'}`}>
                  {isOutput ? '−' : '+'}{formatQuantity(
                    movement.quantityDeltaInBaseUnits,
                  )} {movement.baseUnit ?? ''}
                </p>
              </article>
            );
          })}
        </div>
      ) : (
        <div className='p-10 text-center'>
          <p className='font-semibold text-slate-900'>Aucun mouvement trouvé</p>
          <p className='mt-1 text-sm text-slate-600'>
            Modifiez la recherche ou le filtre.
          </p>
        </div>
      )}

      <nav
        aria-label='Pagination de l’historique physique'
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

export default StockMovementHistory;
