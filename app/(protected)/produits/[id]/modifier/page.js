import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BASE_UNITS, getProductById } from '../../../../../lib/products.js';
import { requireSession } from '../../../../../lib/sessions.js';
import PackagingForm from '../packaging-form.js';
import EditProductForm from './edit-form.js';

export const metadata = {
  title: 'Modifier un produit | Syphax',
};

const EditProductPage = async ({ params }) => {
  await requireSession();

  const { id } = await params;
  const product = await getProductById(id);

  if (!product) {
    notFound();
  }

  const baseUnit = BASE_UNITS.find((unit) => unit.code === product.baseUnit);
  const baseUnitLabel = baseUnit?.label ?? product.baseUnit;

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <div className='max-w-2xl'>
        <Link
          className='text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          href={`/produits/${product.id}`}
        >
          ← Retour à la fiche produit
        </Link>

        <p className='mt-6 text-sm font-semibold uppercase tracking-widest text-blue-700'>
          Produit {product.code}
        </p>
        <h1 className='mt-3 text-3xl font-bold tracking-tight text-slate-900'>
          Modifier le produit
        </h1>
        <p className='mt-2 text-sm leading-6 text-slate-600'>
          Mettez à jour les informations utilisées dans le catalogue et le stock.
        </p>

        <section className='mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'>
          <EditProductForm baseUnits={BASE_UNITS} product={product} />
        </section>

        <section className='mt-6'>
          <PackagingForm
            baseUnitLabel={baseUnitLabel}
            productId={product.id}
          />
        </section>
      </div>
    </main>
  );
};

export default EditProductPage;
