import { requirePermission } from '../../../../lib/sessions.js';
import DelivererForm from './deliverer-form.js';

export const metadata = {
  title: 'Nouveau livreur | Syphax',
};

const NewDelivererPage = async () => {
  await requirePermission('deliverers.create');

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <div className='max-w-2xl'>
        <p className='text-sm font-semibold uppercase tracking-widest text-blue-700'>
          Distribution
        </p>
        <h1 className='mt-3 text-3xl font-bold tracking-tight text-slate-900'>
          Créer un livreur
        </h1>
        <p className='mt-2 text-sm leading-6 text-slate-600'>
          Enregistrez une personne suivie dans l’activité, sans lui créer de
          compte de connexion.
        </p>

        <section className='mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'>
          <DelivererForm />
        </section>
      </div>
    </main>
  );
};

export default NewDelivererPage;
