import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BASE_UNITS } from '../../../../lib/products.js';
import { getReceptionById } from '../../../../lib/reception-records.js';
import {
  formatReceptionDate,
  formatReceptionDifference,
  formatReceptionMoney,
  formatReceptionRecordedAt,
  summarizeReceptionAmounts,
  validateReceptionHistoryHref,
} from '../../../../lib/receptions.js';
import { requirePermission } from '../../../../lib/sessions.js';
import ReceptionDetailLines from './reception-detail-lines.js';

export const metadata = {
  title: 'Fiche de réception | Syphax',
};

const ReceptionPage = async ({ params, searchParams }) => {
  const session = await requirePermission('receptions.read');
  const [{ id }, query = {}] = await Promise.all([
    params,
    searchParams,
  ]);
  const reception = await getReceptionById(id, { userId: session.userId });

  if (!reception) {
    notFound();
  }

  const returnHref = validateReceptionHistoryHref(query.retour);
  const amountSummary = summarizeReceptionAmounts(
    reception.lines,
    reception.totalAmountInCentimes,
  );

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <Link
        className='inline-flex items-center gap-2 rounded-lg text-sm font-medium text-blue-700 transition hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700'
        href={returnHref}
      >
        <span aria-hidden='true'>←</span>
        Retour à l’historique
      </Link>

      <header className='mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm'>
        <div className='border-b border-slate-200 p-5 sm:p-6'>
          <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
            Fiche de réception
          </p>
          <h1 className='mt-2 break-all font-mono text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl'>
            {reception.id}
          </h1>
          <p className='mt-2 text-sm leading-6 text-slate-600'>
            Faits enregistrés lors de la réception, présentés en lecture seule.
          </p>
        </div>
        <dl className='grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-3'>
          {[
            ['Référence de la réception', reception.id],
            ['Fournisseur', reception.supplierName],
            ['Date de réception', formatReceptionDate(reception.receptionDate)],
            ['Référence du document fournisseur', reception.supplierReference],
            ['Auteur de l’enregistrement', reception.createdBy ?? 'Compte indisponible'],
            ['Date d’enregistrement', formatReceptionRecordedAt(reception.createdAt)],
          ].map(([label, value]) => (
            <div className='min-w-0 bg-white px-5 py-4 sm:px-6' key={label}>
              <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                {label}
              </dt>
              <dd className='mt-1 break-words text-sm font-semibold text-slate-900'>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <ReceptionDetailLines baseUnits={BASE_UNITS} lines={reception.lines} />

      <section
        aria-labelledby='reception-amounts-title'
        className='mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'
      >
        <div className='border-b border-slate-200 p-5 sm:p-6'>
          <h2 className='text-lg font-semibold text-slate-900' id='reception-amounts-title'>
            Synthèse des montants TTC
          </h2>
          <p className='mt-1 text-sm leading-6 text-slate-600'>
            Seuls les montants effectivement enregistrés sont présentés.
          </p>
        </div>
        <dl className='divide-y divide-slate-100 px-5 sm:px-6'>
          <div className='flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6'>
            <dt className='text-sm font-medium text-slate-600'>
              {amountSummary.complete ? 'Total des lignes TTC' : 'Sous-total TTC connu'}
            </dt>
            <dd className='text-lg font-bold text-slate-900'>
              {formatReceptionMoney(amountSummary.knownSubtotalInCentimes)}
            </dd>
          </div>
          {!amountSummary.complete && (
            <div className='py-4'>
              <dt className='text-sm font-medium text-amber-800'>Données incomplètes</dt>
              <dd className='mt-1 text-sm leading-6 text-amber-700'>
                {amountSummary.incompleteLineCount} ligne{amountSummary.incompleteLineCount > 1 ? 's' : ''} sans montant TTC. Le sous-total connu n’est pas un total complet.
              </dd>
            </div>
          )}
          {amountSummary.documentTotalInCentimes !== null && (
            <div className='flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6'>
              <dt className='text-sm font-medium text-slate-600'>Total TTC du document</dt>
              <dd className='text-lg font-bold text-slate-900'>
                {formatReceptionMoney(amountSummary.documentTotalInCentimes)}
              </dd>
            </div>
          )}
          {amountSummary.gapInCentimes !== null && (
            <div className='flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6'>
              <dt className='text-sm font-medium text-slate-600'>
                Écart document − lignes
              </dt>
              <dd className='text-lg font-bold text-slate-900'>
                {formatReceptionDifference(amountSummary.gapInCentimes)}
              </dd>
            </div>
          )}
          {amountSummary.documentTotalInCentimes === null && (
            <div className='flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6'>
              <dt className='text-sm font-medium text-slate-600'>Total TTC du document</dt>
              <dd className='font-semibold text-slate-900'>Non renseigné</dd>
            </div>
          )}
        </dl>
      </section>
    </main>
  );
};

export default ReceptionPage;
