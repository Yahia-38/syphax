'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import ProductFields from '../product-fields.js';
import { updateProduct } from './product-actions.js';

const ProductEditForm = ({ baseUnits, product }) => {
  const initialState = {
    errors: {},
    revision: 0,
    values: {
      code: product.code,
      designation: product.designation,
      baseUnit: product.baseUnit,
    },
  };
  const updateProductWithId = updateProduct.bind(null, product.id);
  const [state, formAction, pending] = useActionState(
    updateProductWithId,
    initialState,
  );

  return (
    <form action={formAction} className='space-y-6' key={state.revision}>
      {state.errors.form && (
        <p
          className='rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
          role='alert'
        >
          {state.errors.form}
        </p>
      )}

      <ProductFields baseUnits={baseUnits} state={state} />

      <div className='flex flex-wrap gap-3 border-t border-slate-200 pt-6'>
        <button
          className='rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
          disabled={pending}
          type='submit'
        >
          {pending ? 'Enregistrement…' : 'Enregistrer les modifications'}
        </button>
        <Link
          className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          href={`/produits/${product.id}?section=identification`}
        >
          Annuler
        </Link>
      </div>
    </form>
  );
};

export default ProductEditForm;
