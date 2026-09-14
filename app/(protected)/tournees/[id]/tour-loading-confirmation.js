'use client';

import { useActionState } from 'react';

import { loadTour } from './actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  replayed: false,
  revision: 0,
};

const formatQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(quantity);

const TourLoadingConfirmation = ({ digest, lines, tourId }) => {
  const loadCurrentTour = loadTour.bind(null, tourId);
  const [state, formAction, pending] = useActionState(
    loadCurrentTour,
    INITIAL_STATE,
  );
  const recap = lines.map((line) =>
    `• ${line.productCode} — ${line.productDesignation} : ${formatQuantity(line.quantityInBaseUnits)} ${line.baseUnit}`,
  ).join('\n');
  const confirmation = [
    'Confirmer le chargement complet de cette tournée ?',
    '',
    recap,
    '',
    'Les lignes ne pourront plus être ajoutées ou retirées après confirmation.',
  ].join('\n');

  return (
    <section className='mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm sm:p-6'>
      <div className='flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h2 className='font-semibold text-slate-900'>Chargement complet</h2>
          <p className='mt-1 max-w-2xl text-sm leading-6 text-slate-700'>
            La confirmation constatera la sortie physique de chaque ligne
            ci-dessous et sa remise au livreur. Les lignes ne seront ensuite
            plus ajoutables ni retirables.
          </p>
        </div>
        <form
          action={formAction}
          onSubmit={(event) => {
            if (!globalThis.confirm(confirmation)) {
              event.preventDefault();
            }
          }}
        >
          <input name='loadingDigest' type='hidden' value={digest} />
          <button
            className='inline-flex w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
            disabled={pending}
            type='submit'
          >
            {pending ? 'Confirmation…' : 'Confirmer le chargement'}
          </button>
        </form>
      </div>
      {state.errors.form && (
        <p className='mt-4 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800' role='alert'>
          {state.errors.form}
        </p>
      )}
      {state.message && (
        <p className='mt-4 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-800' role='status'>
          {state.message}
        </p>
      )}
    </section>
  );
};

export default TourLoadingConfirmation;
