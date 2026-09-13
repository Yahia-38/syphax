'use client';

import { useActionState } from 'react';

import ProductFields from '../product-fields.js';
import { createProduct } from './actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  revision: 0,
  values: { code: '', designation: '', baseUnit: '' },
};

const ProductForm = ({ baseUnits }) => {
  const [state, formAction, pending] = useActionState(
    createProduct,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className='space-y-6' key={state.revision}>
      {state.message && (
        <p
          className='rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
          role='status'
        >
          {state.message}
        </p>
      )}

      {state.errors.form && (
        <p
          className='rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
          role='alert'
        >
          {state.errors.form}
        </p>
      )}

      <ProductFields baseUnits={baseUnits} state={state} />

      <div className='border-t border-slate-200 pt-6'>
        <button
          className='rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
          disabled={pending}
          type='submit'
        >
          {pending ? 'Création…' : 'Créer le produit'}
        </button>
      </div>
    </form>
  );
};

export default ProductForm;
