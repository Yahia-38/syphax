import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getUserPermissions } from '../../../../lib/access.js';
import { BASE_UNITS, getProductById } from '../../../../lib/products.js';
import { requirePermission } from '../../../../lib/sessions.js';
import DeleteProductButton from '../delete-product-button.js';
import PackagingForm from './packaging-form.js';
import PricingForm, { PriceEditLink } from './pricing-form.js';
import ProductEditForm from './product-edit-form.js';
import ProductTabs from './product-tabs.js';

export const metadata = {
  title: 'Fiche produit | Syphax',
};

const SECTIONS = new Set([
  'identification',
  'tarification',
  'conditionnements',
]);

const formatDate = (value) => {
  if (!value) {
    return 'Non renseignée';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Africa/Algiers',
  }).format(new Date(value));
};

const formatMoney = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) {
    return 'Non renseigné';
  }

  return `${new Intl.NumberFormat('fr-DZ', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amountInCentimes / 100)} DA`;
};

const formatPriceInput = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) {
    return '';
  }

  return (amountInCentimes / 100).toFixed(2).replace(/\.00$/u, '');
};

const IdentificationSection = ({ baseUnitLabel, editing, product }) => (
  <div
    aria-labelledby='identification-tab'
    className='flex flex-wrap gap-6'
    id='identification-panel'
    role='tabpanel'
  >
    <section
      aria-labelledby='identification-title'
      className='flex-[2_1_460px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='border-b border-slate-100 px-6 py-5'>
        <h2
          className='text-lg font-semibold text-slate-900'
          id='identification-title'
        >
          {editing ? 'Modifier l’identification' : 'Identification'}
        </h2>
      </div>
      {editing ? (
        <div className='p-6'>
          <ProductEditForm baseUnits={BASE_UNITS} product={product} />
        </div>
      ) : (
        <dl className='px-6'>
          <div className='flex items-baseline justify-between gap-6 border-b border-slate-100 py-3.5'>
            <dt className='text-sm font-medium text-slate-500'>Code</dt>
            <dd className='text-right font-mono text-sm font-semibold text-slate-900'>
              {product.code}
            </dd>
          </div>
          <div className='flex items-baseline justify-between gap-6 border-b border-slate-100 py-3.5'>
            <dt className='text-sm font-medium text-slate-500'>Désignation</dt>
            <dd className='text-right text-sm font-semibold text-slate-900'>
              {product.designation}
            </dd>
          </div>
          <div className='flex items-baseline justify-between gap-6 border-b border-slate-100 py-3.5'>
            <dt className='text-sm font-medium text-slate-500'>Unité de base</dt>
            <dd className='text-right text-sm font-semibold text-slate-900'>
              {baseUnitLabel}
            </dd>
          </div>
          <div className='flex items-baseline justify-between gap-6 py-3.5'>
            <dt className='text-sm font-medium text-slate-500'>Code de l’unité</dt>
            <dd className='text-right font-mono text-sm font-semibold text-slate-900'>
              {product.baseUnit}
            </dd>
          </div>
        </dl>
      )}
    </section>

    <aside
      aria-labelledby='traceability-title'
      className='h-fit flex-[1_1_300px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='border-b border-slate-100 px-6 py-5'>
        <h2
          className='text-lg font-semibold text-slate-900'
          id='traceability-title'
        >
          Traçabilité
        </h2>
      </div>
      <dl className='flex flex-col gap-5 px-6 py-5'>
        <div>
          <dt className='text-sm font-medium text-slate-500'>Créé le</dt>
          <dd className='mt-1 text-sm text-slate-900'>
            {formatDate(product.createdAt)}
          </dd>
        </div>
        <div>
          <dt className='text-sm font-medium text-slate-500'>Créé par</dt>
          <dd className='mt-1 text-sm text-slate-900'>
            {product.createdBy ?? 'Compte indisponible'}
          </dd>
        </div>
        {product.updatedAt && (
          <>
            <div>
              <dt className='text-sm font-medium text-slate-500'>Modifié le</dt>
              <dd className='mt-1 text-sm text-slate-900'>
                {formatDate(product.updatedAt)}
              </dd>
            </div>
            <div>
              <dt className='text-sm font-medium text-slate-500'>Modifié par</dt>
              <dd className='mt-1 text-sm text-slate-900'>
                {product.updatedBy ?? 'Compte indisponible'}
              </dd>
            </div>
          </>
        )}
      </dl>
    </aside>
  </div>
);

const PriceHistory = ({ history }) => {
  if (history.length === 0) {
    return null;
  }

  const historyCountLabel = history.length === 1
    ? '1 changement enregistré.'
    : `${history.length} changements enregistrés.`;

  return (
    <section
      aria-labelledby='price-history-title'
      className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='border-b border-slate-100 px-6 py-5'>
        <h2
          className='text-lg font-semibold text-slate-900'
          id='price-history-title'
        >
          Historique du prix
        </h2>
        <p className='mt-1 text-sm leading-6 text-slate-600'>
          {historyCountLabel}
        </p>
      </div>
      <ul>
        {history.map((entry, index) => (
          <li
            className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 ${index > 0 ? 'border-t border-slate-100' : ''}`}
            key={entry.id}
          >
            <p className='text-sm font-medium text-slate-900'>
              {formatMoney(entry.oldAmountInCentimes)}{' '}
              <span className='text-slate-400'>→</span>{' '}
              <span className='font-semibold text-emerald-700'>
                {formatMoney(entry.newAmountInCentimes)}
              </span>
            </p>
            <p className='text-[13px] text-slate-500'>
              {formatDate(entry.changedAt)} ·{' '}
              {entry.changedBy ?? 'Compte indisponible'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
};

const ProductPage = async ({ params, searchParams }) => {
  const session = await requirePermission('products.read');

  const [{ id }, query = {}, permissions] = await Promise.all([
    params,
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const product = await getProductById(id);

  if (!product) {
    notFound();
  }

  const requestedSection = typeof query.section === 'string'
    ? query.section
    : '';
  const activeSection = SECTIONS.has(requestedSection)
    ? requestedSection
    : 'identification';
  const canDeleteProduct = permissions.includes('products.delete');
  const canUpdateProduct = permissions.includes('products.update');
  const editingProduct = activeSection === 'identification'
    && query.modifier === '1'
    && canUpdateProduct;
  const openPricePanel = activeSection === 'tarification' && query.prix === '1';
  const baseUnit = BASE_UNITS.find((unit) => unit.code === product.baseUnit);
  const baseUnitLabel = baseUnit?.label ?? product.baseUnit;
  const latestPriceChange = product.salePriceHistory[0] ?? null;

  return (
    <main>
      <header className='sticky top-0 z-20 border-b border-slate-200 bg-white'>
        <div className='mx-auto w-full max-w-7xl px-6 pt-6'>
          <Link
            className='text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            href='/produits'
          >
            ← Retour aux produits
          </Link>

          <div className='flex flex-wrap items-start justify-between gap-6'>
            <div className='min-w-0 flex-[1_1_420px]'>
              <h1 className='mt-4 text-pretty text-3xl font-bold tracking-tight text-slate-900'>
                {product.designation}
              </h1>
              <div className='mt-3 flex flex-wrap items-center gap-2'>
                <span className='rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[13px] font-semibold text-slate-700'>
                  {product.code}
                </span>
                <span className='rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-[13px] font-semibold text-blue-700'>
                  Unité de base : {baseUnitLabel}
                </span>
                <span
                  className={`rounded-md border px-2.5 py-1 text-[13px] font-semibold ${
                    product.salePrice
                      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                      : 'border-amber-100 bg-amber-50 text-amber-700'
                  }`}
                >
                  {product.salePrice ? 'Prix défini' : 'Prix à définir'}
                </span>
              </div>
            </div>

            <div className='mt-4 flex flex-wrap items-center gap-3'>
              <PriceEditLink productId={product.id} />
              {canUpdateProduct && (
                <Link
                  className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                  href={`/produits/${product.id}?section=identification&modifier=1`}
                >
                  Modifier la fiche
                </Link>
              )}
              {canDeleteProduct && (
                <DeleteProductButton
                  product={{
                    id: product.id,
                    code: product.code,
                    designation: product.designation,
                  }}
                />
              )}
            </div>
          </div>

          <ProductTabs
            activeSection={activeSection}
            productId={product.id}
          />
        </div>
      </header>

      <div className='mx-auto w-full max-w-7xl px-6 py-8 sm:py-10'>
        {query.updated === '1' && (
          <p
            className='mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
            role='status'
          >
            Le produit a été modifié avec succès.
          </p>
        )}

        {activeSection === 'identification' && (
          <IdentificationSection
            baseUnitLabel={baseUnitLabel}
            editing={editingProduct}
            product={product}
          />
        )}

        {activeSection === 'tarification' && (
          <div
            aria-labelledby='tarification-tab'
            className='space-y-6'
            id='tarification-panel'
            role='tabpanel'
          >
            <PricingForm
              baseUnitLabel={baseUnitLabel}
              currentPrice={formatPriceInput(
                product.salePrice?.amountInCentimes,
              )}
              currentPriceInCentimes={product.salePrice?.amountInCentimes ?? null}
              initiallyOpen={openPricePanel}
              key={openPricePanel ? 'price-open' : 'price-closed'}
              lastChange={latestPriceChange
                ? {
                    author:
                      latestPriceChange.changedBy ?? 'Compte indisponible',
                    date: formatDate(latestPriceChange.changedAt),
                  }
                : null}
              productId={product.id}
            />
            <PriceHistory history={product.salePriceHistory} />
          </div>
        )}

        {activeSection === 'conditionnements' && (
          <div
            aria-labelledby='conditionnements-tab'
            className='space-y-6'
            id='conditionnements-panel'
            role='tabpanel'
          >
            <section
              aria-label='Unité de stock'
              className='rounded-xl border border-blue-100 bg-blue-50 p-5'
            >
              <p className='text-xs font-bold uppercase tracking-[0.08em] text-blue-700'>
                Unité de stock
              </p>
              <p className='mt-2 text-lg font-bold text-slate-900'>
                1 {baseUnitLabel.toLocaleLowerCase('fr')}
              </p>
              <p className='mt-1 text-sm leading-6 text-slate-600'>
                Toute quantité en stock est exprimée dans cette unité de base.
                Les conditionnements ci-dessous servent à convertir les achats
                et les réceptions.
              </p>
            </section>

            <PackagingForm
              baseUnitLabel={baseUnitLabel}
              packagings={product.packagings}
              product={{
                id: product.id,
                code: product.code,
                designation: product.designation,
              }}
            />
          </div>
        )}
      </div>
    </main>
  );
};

export default ProductPage;
