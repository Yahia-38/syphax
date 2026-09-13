import { redirect } from 'next/navigation';

import { getSession } from '../../lib/sessions.js';
import LoginForm from './login-form.js';

export const metadata = {
  title: 'Connexion | Syphax',
};

const LoginPage = async () => {
  const session = await getSession();

  if (session) {
    redirect('/');
  }

  return (
    <main className='min-h-screen bg-slate-100 px-6 py-16 sm:py-24'>
      <section className='mx-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm'>
        <p className='text-sm font-semibold uppercase tracking-widest text-blue-700'>
          Syphax
        </p>
        <h1 className='mt-3 text-3xl font-bold tracking-tight text-slate-900'>
          Connexion
        </h1>
        <p className='mt-2 text-sm leading-6 text-slate-600'>
          Saisissez vos identifiants pour accéder à l’application.
        </p>

        <LoginForm />
      </section>
    </main>
  );
};

export default LoginPage;
