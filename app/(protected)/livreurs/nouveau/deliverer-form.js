'use client';

import { useActionState } from 'react';

import { createDeliverer } from './actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  revision: 0,
  values: {
    code: '',
    name: '',
    phone: '',
  },
};

const DelivererForm = () => {
  const [state, formAction, pending] = useActionState(
    createDeliverer,
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

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor='code'
        >
          Code
        </label>
        <input
          aria-describedby={state.errors.code ? 'code-help code-error' : 'code-help'}
          aria-invalid={Boolean(state.errors.code)}
          autoComplete='off'
          autoFocus
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
          defaultValue={state.values.code}
          id='code'
          maxLength={50}
          name='code'
          placeholder='Ex. LIV-001'
          required
        />
        <p className='mt-2 text-sm text-slate-500' id='code-help'>
          Le code sera enregistré en majuscules, sans espace intérieur.
        </p>
        {state.errors.code && (
          <p className='mt-2 text-sm text-red-700' id='code-error'>
            {state.errors.code}
          </p>
        )}
      </div>

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor='name'
        >
          Nom
        </label>
        <input
          aria-describedby={state.errors.name ? 'name-help name-error' : 'name-help'}
          aria-invalid={Boolean(state.errors.name)}
          autoComplete='name'
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
          defaultValue={state.values.name}
          id='name'
          maxLength={150}
          name='name'
          placeholder='Ex. Amine Benali'
          required
        />
        <p className='mt-2 text-sm text-slate-500' id='name-help'>
          Nom utilisé pour identifier le livreur dans l’activité.
        </p>
        {state.errors.name && (
          <p className='mt-2 text-sm text-red-700' id='name-error'>
            {state.errors.name}
          </p>
        )}
      </div>

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor='phone'
        >
          Téléphone
        </label>
        <input
          aria-describedby={state.errors.phone ? 'phone-help phone-error' : 'phone-help'}
          aria-invalid={Boolean(state.errors.phone)}
          autoComplete='tel'
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
          defaultValue={state.values.phone}
          id='phone'
          maxLength={30}
          name='phone'
          placeholder='Ex. 0550 00 00 00'
          type='tel'
        />
        <p className='mt-2 text-sm text-slate-500' id='phone-help'>
          Facultatif. Le numéro est conservé comme texte.
        </p>
        {state.errors.phone && (
          <p className='mt-2 text-sm text-red-700' id='phone-error'>
            {state.errors.phone}
          </p>
        )}
      </div>

      <div className='border-t border-slate-200 pt-6'>
        <button
          className='rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
          disabled={pending}
          type='submit'
        >
          {pending ? 'Création…' : 'Créer le livreur'}
        </button>
      </div>
    </form>
  );
};

export default DelivererForm;
