import { randomUUID } from 'node:crypto';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getUserPermissions } from '../../../../lib/access.js';
import { listProducts } from '../../../../lib/products.js';
import { requirePermission } from '../../../../lib/sessions.js';
import {
  TOUR_STATUS_PREPARATION,
  formatTourCreatedAt,
  formatTourDate,
  formatTourStatus,
  getTourById,
  validateTourReturnHref,
} from '../../../../lib/tours.js';
import TourProductForm from './tour-product-form.js';
import TourProductList from './tour-product-list.js';

export const metadata = {
  title: 'Fiche de tournée | Syphax',
};

const TourPage = async ({ params, searchParams }) => {
  const session = await requirePermission('tours.read');
  const [{ id }, query = {}, permissions] = await Promise.all([
    params,
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const tour = await getTourById(id, { userId: session.userId });

  if (!tour) {
    notFound();
  }

  const canReadDeliverer = permissions.includes('deliverers.read');
  const canAddTourProducts = [
    'tours.products.add',
    'products.read',
    'packaging.read',
  ].every((permission) => permissions.includes(permission));
  const products = canAddTourProducts
    ? await listProducts({ includePackagings: true, onlyUsable: true })
    : [];
  const returnHref = validateTourReturnHref(query.retour, tour.delivererId);

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      {canReadDeliverer && (
        <Link
          className='inline-flex items-center gap-2 rounded-lg text-sm font-medium text-blue-700 transition hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700'
          href={returnHref}
        >
          <span aria-hidden='true'>←</span>
          Retour à la fiche livreur
        </Link>
      )}

      <header className={`${canReadDeliverer ? 'mt-6' : ''} rounded-2xl border border-slate-200 bg-white shadow-sm`}>
        <div className='flex flex-col gap-5 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6'>
          <div className='min-w-0'>
            <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
              Fiche de tournée
            </p>
            <h1 className='mt-2 break-all font-mono text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl'>
              {tour.reference}
            </h1>
          </div>
          <span className='w-fit rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800'>
            {formatTourStatus(tour.status)}
          </span>
        </div>

        <dl className='grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-3'>
          {[
            ['Référence', tour.reference],
            ['Livreur', `${tour.delivererCode} — ${tour.delivererName}`],
            ['Date prévue', formatTourDate(tour.plannedDate)],
            ['Statut', formatTourStatus(tour.status)],
            ['Créée par', tour.createdBy ?? 'Compte indisponible'],
            ['Créée le', formatTourCreatedAt(tour.createdAt)],
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

      {canAddTourProducts && tour.status === TOUR_STATUS_PREPARATION && (
        <TourProductForm
          existingProductIds={tour.lines.map((line) => line.productId)}
          initialAdditionKey={randomUUID()}
          products={products}
          tourId={tour.id}
        />
      )}

      {tour.lines.length > 0 ? (
        <TourProductList lines={tour.lines} />
      ) : (
        <section
          aria-labelledby='tour-products-title'
          className='mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm'
        >
          <h2 className='font-semibold text-slate-900' id='tour-products-title'>
            Aucun produit ajouté à cette tournée
          </h2>
          <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
            La tournée ne contient encore aucune réservation de stock.
          </p>
        </section>
      )}
    </main>
  );
};

export default TourPage;
