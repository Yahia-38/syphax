import Link from 'next/link';

import {
  buildDelivererToursHref,
  formatTourDate,
  formatTourStatus,
} from '../../../../lib/tours.js';

const PaginationLink = ({ children, disabled, href }) => disabled ? (
  <span
    aria-disabled='true'
    className='cursor-not-allowed rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-400 opacity-60'
  >
    {children}
  </span>
) : (
  <Link
    className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
    href={href}
  >
    {children}
  </Link>
);

const DelivererTourList = ({
  delivererId,
  page,
  pageSize,
  plannedDate,
  query,
  returnHref,
  totalItems,
  totalPages,
  tours,
}) => {
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + tours.length - 1;
  const filtering = Boolean(plannedDate);
  const searching = Boolean(query);
  const currentHref = buildDelivererToursHref({
    delivererId,
    page,
    plannedDate,
    query,
    returnHref,
  });
  const getTourHref = (tourId) => {
    const parameters = new URLSearchParams({ retour: currentHref });

    return `/tournees/${tourId}?${parameters.toString()}`;
  };

  return (
    <section
      aria-labelledby='deliverer-tours-title'
      className='mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='border-b border-slate-200 p-5 sm:p-6'>
        <h2 className='text-lg font-semibold text-slate-900' id='deliverer-tours-title'>
          Tournées
        </h2>
        <p className='mt-1 text-sm leading-6 text-slate-600'>
          Retrouvez les tournées déjà créées pour ce livreur.
        </p>
      </div>

      <form
        action={`/livreurs/${delivererId}`}
        className='flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row'
        method='get'
        role='search'
      >
        <input name='retour' type='hidden' value={returnHref} />
        <div className='flex-1'>
          <label className='sr-only' htmlFor='tour-search'>
            Rechercher une tournée par référence
          </label>
          <input
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
            defaultValue={query}
            id='tour-search'
            maxLength={100}
            name='tourneeRecherche'
            placeholder='Rechercher par référence'
            type='search'
          />
        </div>
        <div>
          <label className='sr-only' htmlFor='tour-date-filter'>
            Filtrer par date prévue
          </label>
          <input
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 sm:w-44'
            defaultValue={plannedDate}
            id='tour-date-filter'
            name='tourneeDate'
            type='date'
          />
        </div>
        <button
          className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          type='submit'
        >
          Rechercher
        </button>
        {(searching || filtering) && (
          <Link
            className='inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            href={buildDelivererToursHref({ delivererId, returnHref })}
          >
            Réinitialiser
          </Link>
        )}
      </form>

      <div className='flex min-h-12 items-center border-b border-slate-200 px-4 py-3 sm:px-6'>
        <p className='text-sm text-slate-500'>
          {totalItems > 0
            ? `${firstItem}–${lastItem} sur ${totalItems} tournées`
            : '0 tournée'}
        </p>
      </div>

      {tours.length > 0 ? (
        <>
          <ul className='divide-y divide-slate-100'>
            {tours.map((tour) => (
              <li className='p-4 transition hover:bg-slate-50 sm:px-6' key={tour.id}>
                <Link
                  className='grid gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6'
                  href={getTourHref(tour.id)}
                >
                  <span className='break-all font-mono text-sm font-semibold text-blue-800'>
                    {tour.reference}
                  </span>
                  <span className='text-sm text-slate-600'>
                    {formatTourDate(tour.plannedDate)}
                  </span>
                  <span className='w-fit rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800'>
                    {formatTourStatus(tour.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <nav
            aria-label='Pagination des tournées du livreur'
            className='flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3 sm:px-6'
          >
            <PaginationLink
              disabled={page === 1}
              href={buildDelivererToursHref({
                delivererId,
                page: page - 1,
                plannedDate,
                query,
                returnHref,
              })}
            >
              Précédent
            </PaginationLink>
            <p className='text-sm font-medium text-slate-600'>
              Page {page} sur {totalPages}
            </p>
            <PaginationLink
              disabled={page === totalPages}
              href={buildDelivererToursHref({
                delivererId,
                page: page + 1,
                plannedDate,
                query,
                returnHref,
              })}
            >
              Suivant
            </PaginationLink>
          </nav>
        </>
      ) : (
        <div className='px-6 py-12 text-center'>
          <h3 className='font-semibold text-slate-900'>
            {searching || filtering ? 'Aucun résultat' : 'Aucune tournée créée'}
          </h3>
          <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
            {searching || filtering
              ? 'Aucune tournée ne correspond à ces critères.'
              : 'Les tournées de ce livreur apparaîtront ici.'}
          </p>
          {(searching || filtering) && (
            <Link
              className='mt-5 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              href={buildDelivererToursHref({ delivererId, returnHref })}
            >
              Voir toutes les tournées
            </Link>
          )}
        </div>
      )}
    </section>
  );
};

export default DelivererTourList;
