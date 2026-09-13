import { BASE_UNITS } from '../../../../lib/products.js';
import { requirePermission } from '../../../../lib/sessions.js';
import ProductForm from './product-form.js';

export const metadata = {
  title: 'Nouveau produit | Syphax',
};

const NewProductPage = async () => {
  await requirePermission('products.create');

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <div className='max-w-2xl'>
        <p className='text-sm font-semibold uppercase tracking-widest text-blue-700'>
          Produits
        </p>
        <h1 className='mt-3 text-3xl font-bold tracking-tight text-slate-900'>
          Créer un produit
        </h1>
        <p className='mt-2 text-sm leading-6 text-slate-600'>
          Renseignez les informations qui identifient le produit.
        </p>

        <section className='mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'>
          <ProductForm baseUnits={BASE_UNITS} />
        </section>
      </div>
    </main>
  );
};

export default NewProductPage;
