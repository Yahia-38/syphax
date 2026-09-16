import Link from 'next/link';

import { logout } from './actions.js';
import NavigationLink from './navigation-link.js';

const Navbar = ({
  canReadCash,
  canReadDeliverers,
  canReadProducts,
  canReadReceptions,
  username,
}) => {
  return (
    <header className='border-b border-slate-200 bg-white'>
      <nav
        aria-label='Navigation principale'
        className='mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4'
      >
        <Link
          className='text-xl font-bold tracking-tight text-slate-900'
          href='/'
        >
          Syphax
        </Link>

        <div className='order-3 flex w-full flex-wrap items-center gap-1 sm:order-none sm:w-auto sm:flex-1'>
          <Link
            className='rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            href='/'
          >
            Tableau de bord
          </Link>
          {canReadProducts && (
            <Link
              className='rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              href='/produits'
            >
              Produits
            </Link>
          )}
          {canReadReceptions && (
            <Link
              className='rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              href='/receptions'
            >
              Réceptions
            </Link>
          )}
          {canReadDeliverers && (
            <NavigationLink
              className='rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              href='/livreurs'
            >
              Livreurs
            </NavigationLink>
          )}
          {canReadCash && (
            <Link
              className='rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              href='/caisse'
            >
              Caisse
            </Link>
          )}
        </div>

        <div className='ml-auto flex items-center gap-3 sm:gap-4'>
          <div className='min-w-0 text-right'>
            <p className='hidden text-xs text-slate-500 sm:block'>
              Connecté en tant que
            </p>
            <p className='max-w-40 truncate text-sm font-semibold text-slate-900 sm:max-w-64'>
              {username}
            </p>
          </div>

          <form action={logout}>
            <button
              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              type='submit'
            >
              Déconnexion
            </button>
          </form>
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
