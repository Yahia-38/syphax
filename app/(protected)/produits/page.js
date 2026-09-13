import Link from 'next/link';

import { listProducts } from '../../../lib/products.js';
import { requireSession } from '../../../lib/sessions.js';
import ProductTable from './product-table.js';

export const metadata = {
  title: 'Produits | Syphax',
};

const readQuery = (value) => {
  const query = Array.isArray(value) ? value[0] : value;
  return typeof query === 'string' ? query.trim().slice(0, 100) : '';
};

const ProductsPage = async ({ searchParams }) => {
  await requireSession();

  const resolvedSearchParams = await searchParams;
  const query = readQuery(resolvedSearchParams?.q);
  const productDeleted = resolvedSearchParams?.deleted === '1';
  const products = await listProducts();

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <div className='flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h1 className='text-3xl font-bold tracking-tight text-slate-900'>
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

      <ProductTable products={products} initialQuery={query} />
    </main>
  );
};

export default ProductsPage;
