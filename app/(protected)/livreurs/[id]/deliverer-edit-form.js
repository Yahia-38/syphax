'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { updateDeliverer } from './actions.js';

const DelivererEditForm = ({ deliverer, returnHref, viewHref }) => {
  const initialState = {
    errors: {},
    revision: 0,
    values: {
      code: deliverer.code,
      name: deliverer.name,
      phone: deliverer.phone,
    },
  };
  const updateDelivererWithContext = updateDeliverer.bind(
    null,
    deliverer.id,
    returnHref,
  );
  const [state, formAction, pending] = useActionState(
    updateDelivererWithContext,
    initialState,
  );

  return (
    <form action={formAction} className='px-5 sm:px-6' key={state.revision}>
      {state.errors.form && (
        <p
          className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
          role='alert'
        >
          {state.errors.form}
        </p>
      )}

      <div className='flex items-start justify-between gap-6 border-b border-slate-100 py-4'>
        <label className='pt-2 text-sm font-medium text-slate-500' htmlFor='code'>
          Code
        </label>
        <div className='w-full max-w-sm'>
          <input
            aria-describedby={state.errors.code ? 'code-error' : undefined}
            aria-invalid={Boolean(state.errors.code)}
            autoComplete='off'
            autoFocus
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

      <div className='flex items-start justify-between gap-6 border-b border-slate-100 py-4'>
        <label className='pt-2 text-sm font-medium text-slate-500' htmlFor='name'>
          Nom
        </label>
        <div className='w-full max-w-sm'>
          <input
            aria-describedby={state.errors.name ? 'name-error' : undefined}
            aria-invalid={Boolean(state.errors.name)}
            autoComplete='name'
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
            defaultValue={state.values.name}
            id='name'
            maxLength={150}
            name='name'
            required
          />
          {state.errors.name && (
            <p className='mt-1.5 text-right text-sm text-red-700' id='name-error'>
              {state.errors.name}
            </p>
          )}
        </div>
      </div>

      <div className='flex items-start justify-between gap-6 border-b border-slate-100 py-4'>
        <label className='pt-2 text-sm font-medium text-slate-500' htmlFor='phone'>
          Téléphone
        </label>
        <div className='w-full max-w-sm'>
          <input
            aria-describedby={state.errors.phone ? 'phone-error' : undefined}
            aria-invalid={Boolean(state.errors.phone)}
            autoComplete='tel'
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
            defaultValue={state.values.phone}
            id='phone'
            maxLength={30}
            name='phone'
            type='tel'
          />
          {state.errors.phone && (
            <p className='mt-1.5 text-right text-sm text-red-700' id='phone-error'>
              {state.errors.phone}
            </p>
          )}
        </div>
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
          href={viewHref}
        >
          Annuler
        </Link>
      </div>
    </form>
  );
};

export default DelivererEditForm;
