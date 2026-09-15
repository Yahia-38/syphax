import Link from 'next/link';

import { getUserPermissions } from '../../../lib/access.js';
import { listProducts } from '../../../lib/products.js';
import { requirePermission } from '../../../lib/sessions.js';
import ProductTable from './product-table.js';

export const metadata = {
  title: 'Produits | Syphax',
};

const readQuery = (value) => {
  const query = Array.isArray(value) ? value[0] : value;
  return typeof query === 'string' ? query.trim().slice(0, 100) : '';
};

const ProductsPage = async ({ searchParams }) => {
  const session = await requirePermission('products.read');

  const [resolvedSearchParams, permissions] = await Promise.all([
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const query = readQuery(resolvedSearchParams?.q);
  const productDeleted = resolvedSearchParams?.deleted === '1';
  const canCreateProduct = permissions.includes('products.create');
  const canReadPricing = permissions.includes('pricing.read');
  const products = await listProducts({ includePricing: canReadPricing });

  return (
    <main className='mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-9 lg:pb-12'>
      <div className='flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <p className='mb-2 text-[10px] font-bold tracking-[0.14em] text-slate-500'>
            CATALOGUE &amp; STOCK
          </p>
          <h1 className='text-3xl font-bold tracking-tight text-slate-900'>
            Produits
          </h1>
          <p className='mt-2 text-sm leading-6 text-slate-600'>
            Vos références, leur disponibilité et leurs unités en un coup d’œil.
          </p>
        </div>

        {canCreateProduct && (
          <Link
            className='inline-flex w-fit items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            href='/produits/nouveau'
          >
            <span aria-hidden='true' className='mr-1 text-lg leading-none'>＋</span>
            Nouveau produit
          </Link>
        )}
      </div>

      {productDeleted && (
        <p
          className='mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
          role='status'
        >
          Le produit a été supprimé avec succès.
        </p>
      )}

      <ProductTable
        canCreateProduct={canCreateProduct}
        canReadPricing={canReadPricing}
        products={products}
        initialQuery={query}
      />
    </main>
  );
};

export default ProductsPage;
