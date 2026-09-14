import Link from 'next/link';

const buildListHref = ({ page, query }) => {
  const parameters = new URLSearchParams();

  if (query) {
    parameters.set('q', query);
  }

  if (page > 1) {
    parameters.set('page', String(page));
  }

  const search = parameters.toString();
  return search ? `/livreurs?${search}` : '/livreurs';
};

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
  totalItems,
  totalPages,
}) => {
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + deliverers.length - 1;
  const searching = Boolean(query);

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
        <button
          className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          type='submit'
        >
          Rechercher
        </button>
        {searching && (
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
                  className='w-[30%] bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-[24%] sm:px-6'
                  scope='col'
                >
                  Code
                </th>
                <th
                  className='w-[38%] bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6'
                  scope='col'
                >
                  Nom
                </th>
                <th
                  className='w-[32%] bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-[38%] sm:px-6'
                  scope='col'
                >
                  Téléphone
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-slate-100 bg-white'>
              {deliverers.map((deliverer) => (
                <tr className='hover:bg-slate-50' key={deliverer.id}>
                  <td className='break-all px-4 py-3 font-mono text-[13px] font-semibold text-slate-900 sm:px-6'>
                    {deliverer.code}
                  </td>
                  <td className='break-words px-4 py-3 text-sm text-slate-700 sm:px-6'>
                    {deliverer.name}
                  </td>
                  <td className='break-words px-4 py-3 text-sm text-slate-600 sm:px-6'>
                    {deliverer.phone || 'Non renseigné'}
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
              href={buildListHref({ page: page - 1, query })}
            >
              Précédent
            </PaginationLink>
            <p className='text-sm font-medium text-slate-600'>
              Page {page} sur {totalPages}
            </p>
            <PaginationLink
              disabled={page === totalPages}
              href={buildListHref({ page: page + 1, query })}
            >
              Suivant
            </PaginationLink>
          </nav>
        </>
      ) : (
        <div className='px-6 py-14 text-center'>
          <h3 className='font-semibold text-slate-900'>
            {searching ? 'Aucun résultat' : 'Aucun livreur enregistré'}
          </h3>
          <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
            {searching
              ? `Aucun code ou nom ne correspond à « ${query} ».`
              : 'Les livreurs créés apparaîtront ici.'}
          </p>
          {searching && (
            <Link
              className='mt-5 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              href='/livreurs'
            >
              Voir tous les livreurs
            </Link>
          )}
        </div>
      )}
    </section>
  );
};

export default DelivererList;
