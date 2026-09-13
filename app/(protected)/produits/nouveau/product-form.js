'use client';

import { useActionState } from 'react';

import ProductFields from '../product-fields.js';
import { createProduct } from './actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  revision: 0,
  values: {
    code: '',
    designation: '',
    baseUnit: '',
    label: '',
    quantity: '',
  },
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

      <fieldset className='rounded-xl border border-slate-200 bg-slate-50 p-5'>
        <legend className='px-1 font-semibold text-slate-900'>
          Conditionnement initial
        </legend>
        <p className='text-sm leading-6 text-slate-600'>
          Facultatif. Vous pourrez en ajouter d’autres depuis la fiche produit.
        </p>

        <div className='mt-4 grid gap-4 sm:grid-cols-2'>
          <div>
            <label
              className='block text-sm font-medium text-slate-700'
              htmlFor='packaging-label'
            >
              Libellé
            </label>
            <input
              aria-describedby={
                state.errors.label ? 'packaging-label-error' : undefined
              }
              aria-invalid={Boolean(state.errors.label)}
              autoComplete='off'
              className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
              defaultValue={state.values.label}
              id='packaging-label'
              maxLength={100}
              name='label'
              placeholder='Ex. Pack de 6'
            />
            {state.errors.label && (
              <p className='mt-2 text-sm text-red-700' id='packaging-label-error'>
                {state.errors.label}
              </p>
            )}
          </div>

          <div>
            <label
              className='block text-sm font-medium text-slate-700'
              htmlFor='packaging-quantity'
            >
              Quantité en unités de base
            </label>
            <input
              aria-describedby={
                state.errors.quantity ? 'packaging-quantity-error' : undefined
              }
              aria-invalid={Boolean(state.errors.quantity)}
              className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
              defaultValue={state.values.quantity}
              id='packaging-quantity'
              inputMode='numeric'
              max={1000000}
              min={2}
              name='quantity'
              placeholder='Ex. 6'
              step={1}
              type='number'
            />
            {state.errors.quantity && (
              <p
                className='mt-2 text-sm text-red-700'
                id='packaging-quantity-error'
              >
                {state.errors.quantity}
              </p>
            )}
          </div>
        </div>
      </fieldset>

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
