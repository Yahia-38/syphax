import Link from 'next/link';

import { buildDelivererListHref } from '../../../lib/deliverers.js';

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

const DelivererList = ({
  deliverers,
  page,
  pageSize,
  query,
  status,
  totalItems,
  totalPages,
}) => {
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + deliverers.length - 1;
  const searching = Boolean(query);
  const filtering = status !== 'active';
  const returnHref = buildDelivererListHref({ page, query, status });
  const getDelivererHref = (delivererId) => {
    const parameters = new URLSearchParams({ retour: returnHref });

    return `/livreurs/${delivererId}?${parameters.toString()}`;
  };

  return (
    <section
      aria-labelledby='deliverer-list-title'
      className='mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <h2 className='sr-only' id='deliverer-list-title'>
        Liste des livreurs
      </h2>

      <form
        action='/livreurs'
        className='flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row'
        method='get'
        role='search'
      >
        <div className='flex-1'>
          <label className='sr-only' htmlFor='deliverer-search'>
            Rechercher un livreur
          </label>
          <input
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
            defaultValue={query}
            id='deliverer-search'
            maxLength={100}
            name='q'
            placeholder='Rechercher par code ou nom'
            type='search'
          />
        </div>
        <div>
          <label className='sr-only' htmlFor='deliverer-status-filter'>
            Filtrer par statut
          </label>
          <select
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 sm:w-44'
            defaultValue={status}
            id='deliverer-status-filter'
            name='statut'
          >
            <option value='active'>Actifs</option>
            <option value='disabled'>Désactivés</option>
            <option value='all'>Tous</option>
          </select>
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
            href='/livreurs'
          >
            Réinitialiser
          </Link>
        )}
      </form>

      <div className='flex min-h-12 items-center border-b border-slate-200 px-4 py-3 sm:px-6'>
        <p className='text-sm text-slate-500'>
          {totalItems > 0
            ? `${firstItem}–${lastItem} sur ${totalItems} livreurs`
            : '0 livreur'}
        </p>
      </div>

      {deliverers.length > 0 ? (
        <>
          <table className='w-full table-fixed divide-y divide-slate-200'>
            <caption className='sr-only'>Liste des livreurs</caption>
            <thead>
              <tr>
                <th
                  className='w-[24%] bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-[20%] sm:px-6'
                  scope='col'
                >
                  Code
                </th>
                <th
                  className='w-[32%] bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6'
                  scope='col'
                >
                  Nom
                </th>
                <th
                  className='w-[28%] bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-[32%] sm:px-6'
                  scope='col'
                >
                  Téléphone
                </th>
                <th
                  className='w-[16%] bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6'
                  scope='col'
                >
                  Statut
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-slate-100 bg-white'>
              {deliverers.map((deliverer) => (
                <tr className='hover:bg-slate-50' key={deliverer.id}>
                  <td className='break-all px-4 py-3 font-mono text-[13px] font-semibold text-slate-900 sm:px-6'>
                    <Link
                      className='text-blue-800 hover:text-blue-950 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                      href={getDelivererHref(deliverer.id)}
                    >
                      {deliverer.code}
                    </Link>
                  </td>
                  <td className='break-words px-4 py-3 text-sm text-slate-700 sm:px-6'>
                    {deliverer.name}
                  </td>
                  <td className='break-words px-4 py-3 text-sm text-slate-600 sm:px-6'>
                    {deliverer.phone || 'Non renseigné'}
                  </td>
                  <td className='px-4 py-3 sm:px-6'>
                    <span
                      className={deliverer.active
                        ? 'inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800'
                        : 'inline-flex rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700'}
                    >
                      {deliverer.active ? 'Actif' : 'Désactivé'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <nav
            aria-label='Pagination des livreurs'
            className='flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3 sm:px-6'
          >
            <PaginationLink
              disabled={page === 1}
              href={buildDelivererListHref({
                page: page - 1,
                query,
                status,
              })}
            >
              Précédent
            </PaginationLink>
            <p className='text-sm font-medium text-slate-600'>
              Page {page} sur {totalPages}
            </p>
            <PaginationLink
              disabled={page === totalPages}
              href={buildDelivererListHref({
                page: page + 1,
                query,
                status,
              })}
            >
              Suivant
            </PaginationLink>
          </nav>
        </>
      ) : (
        <div className='px-6 py-14 text-center'>
          <h3 className='font-semibold text-slate-900'>
            {searching || filtering
              ? 'Aucun résultat'
              : 'Aucun livreur actif'}
          </h3>
          <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
            {searching
              ? `Aucun code ou nom ne correspond à « ${query} » avec ce statut.`
              : filtering
                ? 'Aucun livreur ne correspond à ce statut.'
                : 'Les livreurs actifs apparaîtront ici.'}
          </p>
          {(searching || filtering) && (
            <Link
              className='mt-5 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              href='/livreurs'
            >
              Voir les livreurs actifs
            </Link>
          )}
        </div>
      )}
    </section>
  );
};

export default DelivererList;
