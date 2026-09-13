'use client';

import { useActionState } from 'react';

import { login } from './actions.js';

const LoginForm = () => {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <form action={formAction} className='mt-8 space-y-5'>
      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor='username'
        >
          Identifiant
        </label>
        <input
          autoComplete='username'
          autoFocus
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
          id='username'
          name='username'
          required
        />
      </div>

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor='password'
        >
          Mot de passe
        </label>
        <input
          autoComplete='current-password'
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
          id='password'
          minLength={8}
          name='password'
          required
          type='password'
        />
      </div>

      {state?.error && (
        <p className='text-sm text-red-700' role='alert'>
          {state.error}
        </p>
      )}

      <button
        className='w-full rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60'
        disabled={pending}
        type='submit'
      >
        {pending ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
};

export default LoginForm;
