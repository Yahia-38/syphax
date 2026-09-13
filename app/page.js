import { requireSession } from '../lib/sessions.js';

const Home = async () => {
  await requireSession();

  return (
    <main className='mx-auto max-w-3xl px-6 py-16 sm:py-24'>
      <h1 className='text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl'>
        Syphax
      </h1>
      <p className='mt-4 text-lg leading-8 text-slate-600'>
        Gestion des achats, du stock et de la distribution
      </p>
    </main>
  );
};

export default Home;
