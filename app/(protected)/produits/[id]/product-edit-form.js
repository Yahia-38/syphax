'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

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
  const [selectedBaseUnit, setSelectedBaseUnit] = useState(product.baseUnit);

  return (
    <form action={formAction} className='px-6' key={state.revision}>
      {state.errors.form && (
        <p
          className='my-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
          role='alert'
        >
          {state.errors.form}
        </p>
      )}

      <div className='flex items-start justify-between gap-6 border-b border-slate-100 py-3.5'>
        <label className='pt-2 text-sm font-medium text-slate-500' htmlFor='code'>
          Code
        </label>
        <div className='w-full max-w-sm'>
          <input
            aria-describedby={state.errors.code ? 'code-error' : undefined}
            aria-invalid={Boolean(state.errors.code)}
            autoComplete='off'
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right font-mono text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
            defaultValue={state.values.code}
            id='code'
            maxLength={50}
            name='code'
            required
          />
          {state.errors.code && (
            <p className='mt-1.5 text-right text-sm text-red-700' id='code-error'>
              {state.errors.code}
            </p>
          )}
        </div>
      </div>

      <div className='flex items-start justify-between gap-6 border-b border-slate-100 py-3.5'>
        <label
          className='pt-2 text-sm font-medium text-slate-500'
          htmlFor='designation'
        >
          Désignation
        </label>
        <div className='w-full max-w-sm'>
          <input
            aria-describedby={
              state.errors.designation ? 'designation-error' : undefined
            }
            aria-invalid={Boolean(state.errors.designation)}
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
            defaultValue={state.values.designation}
            id='designation'
            maxLength={150}
            name='designation'
            required
          />
          {state.errors.designation && (
            <p
              className='mt-1.5 text-right text-sm text-red-700'
              id='designation-error'
            >
              {state.errors.designation}
            </p>
          )}
        </div>
      </div>

      <div className='flex items-start justify-between gap-6 border-b border-slate-100 py-3.5'>
        <label
          className='pt-2 text-sm font-medium text-slate-500'
          htmlFor='baseUnit'
        >
          Unité de base
        </label>
        <div className='w-full max-w-sm'>
          <select
            aria-describedby={
              state.errors.baseUnit ? 'base-unit-error' : undefined
            }
            aria-invalid={Boolean(state.errors.baseUnit)}
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
            id='baseUnit'
            name='baseUnit'
            onChange={(event) => setSelectedBaseUnit(event.target.value)}
            required
            value={selectedBaseUnit}
          >
            {baseUnits.map((unit) => (
              <option key={unit.code} value={unit.code}>
                {unit.label}
              </option>
            ))}
          </select>
          {state.errors.baseUnit && (
            <p
              className='mt-1.5 text-right text-sm text-red-700'
              id='base-unit-error'
            >
              {state.errors.baseUnit}
            </p>
          )}
        </div>
      </div>

      <div className='flex items-baseline justify-between gap-6 border-b border-slate-100 py-3.5'>
        <span className='text-sm font-medium text-slate-500'>
          Code de l’unité
        </span>
        <output
          className='text-right font-mono text-sm font-semibold text-slate-900'
          htmlFor='baseUnit'
        >
          {selectedBaseUnit}
        </output>
      </div>

      <div className='flex flex-wrap justify-end gap-3 py-4'>
        <button
          className='rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
          disabled={pending}
          type='submit'
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <Link
          className='rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          href={`/produits/${product.id}?section=identification`}
        >
          Annuler
        </Link>
      </div>
    </form>
  );
};

export default ProductEditForm;
