import Link from 'next/link';

const ProductNotFound = () => {
  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-16 sm:py-24'>
      <div className='max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm'>
        <p className='text-sm font-semibold uppercase tracking-widest text-blue-700'>
          Produit introuvable
        </p>
        <h1 className='mt-3 text-3xl font-bold tracking-tight text-slate-900'>
          Cette fiche produit n’existe pas
        </h1>
        <p className='mt-3 text-sm leading-6 text-slate-600'>
          Le produit a peut-être été supprimé ou le lien utilisé est incorrect.
        </p>
        <Link
          className='mt-6 inline-flex rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          href='/produits'
        >
          Retour au catalogue
        </Link>
      </div>
    </main>
  );
};

export default ProductNotFound;
