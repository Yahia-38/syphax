import Link from 'next/link';

import { BASE_UNITS, listProducts } from '../../../lib/products.js';
import { requireSession } from '../../../lib/sessions.js';
import DeleteProductButton from './delete-product-button.js';

export const metadata = {
  title: 'Produits | Syphax',
};

const BASE_UNIT_LABELS = new Map(
  BASE_UNITS.map((unit) => [unit.code, unit.label]),
);

const readQuery = (value) => {
  const query = Array.isArray(value) ? value[0] : value;
  return typeof query === 'string' ? query.trim().slice(0, 100) : '';
};

const ProductsPage = async ({ searchParams }) => {
  await requireSession();

  const resolvedSearchParams = await searchParams;
  const query = readQuery(resolvedSearchParams?.q);
  const productDeleted = resolvedSearchParams?.deleted === '1';
  const products = await listProducts({ query });
  const resultLabel = `${products.length} produit${products.length === 1 ? '' : 's'}`;

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <div className='flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <p className='text-sm font-semibold uppercase tracking-widest text-blue-700'>
            Catalogue
          </p>
          <h1 className='mt-3 text-3xl font-bold tracking-tight text-slate-900'>
            Produits
          </h1>
          <p className='mt-2 text-sm leading-6 text-slate-600'>
            Consultez les produits utilisés pour les achats et le suivi du stock.
          </p>
        </div>

        <Link
          className='inline-flex w-fit items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          href='/produits/nouveau'
        >
          Nouveau produit
        </Link>
      </div>

      {productDeleted && (
        <p
          className='mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
          role='status'
        >
          Le produit a été supprimé avec succès.
        </p>
      )}

      <section
        aria-labelledby='product-list-title'
        className='mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
      >
        <div className='border-b border-slate-200 p-4 sm:p-6'>
          <form
            action='/produits'
            className='flex flex-col gap-3 sm:flex-row'
            role='search'
          >
            <div className='flex-1'>
              <label className='sr-only' htmlFor='product-search'>
                Rechercher un produit
              </label>
              <input
                className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
                defaultValue={query}
                id='product-search'
                maxLength={100}
                name='q'
                placeholder='Rechercher par code ou désignation'
                type='search'
              />
            </div>
            <button
              className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              type='submit'
            >
              Rechercher
            </button>
            {query && (
              <Link
                className='rounded-lg px-4 py-2.5 text-center text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                href='/produits'
              >
                Effacer
              </Link>
            )}
          </form>
        </div>

        <div className='flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6'>
          <h2 className='font-semibold text-slate-900' id='product-list-title'>
            Liste des produits
          </h2>
          <p className='text-sm text-slate-500'>{resultLabel}</p>
        </div>

        {products.length > 0 ? (
          <div className='overflow-x-auto'>
            <table className='min-w-full divide-y divide-slate-200'>
              <caption className='sr-only'>
                Produits classés par code
              </caption>
              <thead className='bg-slate-50'>
                <tr>
                  <th
                    className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6'
                    scope='col'
                  >
                    Code
                  </th>
                  <th
                    className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6'
                    scope='col'
                  >
                    Désignation
                  </th>
                  <th
                    className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6'
                    scope='col'
                  >
                    Unité de base
                  </th>
                  <th
                    className='px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6'
                    scope='col'
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className='divide-y divide-slate-100 bg-white'>
                {products.map((product) => (
                  <tr className='hover:bg-slate-50' key={product.id}>
                    <td className='whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-900 sm:px-6'>
                      {product.code}
                    </td>
                    <td className='px-4 py-4 text-sm text-slate-700 sm:px-6'>
                      {product.designation}
                    </td>
                    <td className='whitespace-nowrap px-4 py-4 text-sm text-slate-600 sm:px-6'>
                      {BASE_UNIT_LABELS.get(product.baseUnit) ?? product.baseUnit}
                    </td>
                    <td className='px-4 py-4 sm:px-6'>
                      <div className='flex justify-end gap-2'>
                        <Link
                          className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                          href={`/produits/${product.id}`}
                        >
                          Voir
                        </Link>
                        <Link
                          className='rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                          href={`/produits/${product.id}/modifier`}
                        >
                          Modifier
                        </Link>
                        <DeleteProductButton compact product={product} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className='px-6 py-14 text-center'>
            <h3 className='font-semibold text-slate-900'>
              {query ? 'Aucun produit trouvé' : 'Aucun produit enregistré'}
            </h3>
            <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
              {query
                ? `Aucun code ou désignation ne correspond à « ${query} ».`
                : 'Créez le premier produit pour commencer à constituer le catalogue.'}
            </p>
            {query ? (
              <Link
                className='mt-5 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                href='/produits'
              >
                Voir tous les produits
              </Link>
            ) : (
              <Link
                className='mt-5 inline-flex rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                href='/produits/nouveau'
              >
                Créer un produit
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  );
};

export default ProductsPage;
