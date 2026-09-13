import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BASE_UNITS, getProductById } from '../../../../lib/products.js';
import { requireSession } from '../../../../lib/sessions.js';
import DeleteProductButton from '../delete-product-button.js';
import PackagingForm from './packaging-form.js';
import PricingForm from './pricing-form.js';

export const metadata = {
  title: 'Fiche produit | Syphax',
};

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

const ProductPage = async ({ params }) => {
  await requireSession();

  const { id } = await params;
  const product = await getProductById(id);

  if (!product) {
    notFound();
  }

  const baseUnit = BASE_UNITS.find((unit) => unit.code === product.baseUnit);
  const baseUnitLabel = baseUnit?.label ?? product.baseUnit;
  const baseUnitPluralLabel = `${baseUnitLabel.toLocaleLowerCase('fr')}s`;

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <Link
        className='text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
        href='/produits'
      >
        ← Retour aux produits
      </Link>

      <div className='mt-6 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <p className='text-sm font-semibold uppercase tracking-widest text-blue-700'>
            Produit
          </p>
          <h1 className='mt-3 text-3xl font-bold tracking-tight text-slate-900'>
            {product.designation}
          </h1>
          <p className='mt-2 font-mono text-sm font-semibold text-slate-500'>
            {product.code}
          </p>
        </div>

        <div>
          <DeleteProductButton
            product={{
              id: product.id,
              code: product.code,
              designation: product.designation,
            }}
          />
        </div>
      </div>

      <div className='mt-8 grid gap-6 lg:grid-cols-3'>
        <div className='space-y-6 lg:col-span-2'>
          <section
            aria-labelledby='identification-title'
            className='rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'
          >
            <h2
              className='text-lg font-semibold text-slate-900'
              id='identification-title'
            >
              Identification
            </h2>
            <dl className='mt-5 grid gap-5 sm:grid-cols-2'>
              <div>
                <dt className='text-sm font-medium text-slate-500'>Code</dt>
                <dd className='mt-1 font-mono text-sm font-semibold text-slate-900'>
                  {product.code}
                </dd>
              </div>
              <div>
                <dt className='text-sm font-medium text-slate-500'>
                  Désignation
                </dt>
                <dd className='mt-1 text-sm font-semibold text-slate-900'>
                  {product.designation}
                </dd>
              </div>
              <div>
                <dt className='text-sm font-medium text-slate-500'>
                  Unité de base
                </dt>
                <dd className='mt-1 text-sm font-semibold text-slate-900'>
                  {baseUnitLabel}
                </dd>
              </div>
              <div>
                <dt className='text-sm font-medium text-slate-500'>
                  Code de l’unité
                </dt>
                <dd className='mt-1 font-mono text-sm font-semibold text-slate-900'>
                  {product.baseUnit}
                </dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby='pricing-title'
            className='rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'
          >
            <h2
              className='text-lg font-semibold text-slate-900'
              id='pricing-title'
            >
              Tarification
            </h2>
            <p className='mt-1 text-sm leading-6 text-slate-600'>
              Le prix de vente est TTC et s’applique à l’unité de base.
            </p>

            <dl className='mt-5 grid gap-4 sm:grid-cols-2'>
              <div className='rounded-xl border border-blue-100 bg-blue-50 p-4'>
                <dt className='text-sm font-medium text-blue-700'>
                  Prix de vente par {baseUnitLabel.toLocaleLowerCase('fr')}
                </dt>
                <dd className='mt-2 text-2xl font-bold text-slate-900'>
                  {formatMoney(product.salePrice?.amountInCentimes)}
                </dd>
                <p className='mt-1 text-xs text-slate-600'>TTC</p>
              </div>
              <div className='rounded-xl border border-slate-200 bg-slate-50 p-4'>
                <dt className='text-sm font-medium text-slate-600'>
                  Dernier coût d’achat accepté
                </dt>
                <dd className='mt-2 text-lg font-semibold text-slate-900'>
                  Non disponible
                </dd>
                <p className='mt-1 text-xs leading-5 text-slate-500'>
                  Disponible après l’intégration et le traitement des factures.
                </p>
              </div>
            </dl>

            <PricingForm
              baseUnitLabel={baseUnitLabel}
              currentPrice={formatPriceInput(
                product.salePrice?.amountInCentimes,
              )}
              productId={product.id}
            />

            {product.salePriceHistory.length > 0 && (
              <div className='mt-6'>
                <h3 className='font-semibold text-slate-900'>
                  Historique du prix de vente
                </h3>
                <ul className='mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 px-4'>
                  {product.salePriceHistory.map((entry) => (
                    <li className='py-4' key={entry.id}>
                      <p className='text-sm font-medium text-slate-900'>
                        {formatMoney(entry.oldAmountInCentimes)} →{' '}
                        {formatMoney(entry.newAmountInCentimes)}
                      </p>
                      <p className='mt-1 text-xs text-slate-500'>
                        {formatDate(entry.changedAt)} ·{' '}
                        {entry.changedBy ?? 'Compte indisponible'}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section
            aria-labelledby='packaging-title'
            className='rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'
          >
            <h2
              className='text-lg font-semibold text-slate-900'
              id='packaging-title'
            >
              Conditionnements
            </h2>
            <p className='mt-1 text-sm leading-6 text-slate-600'>
              Unités utilisées pour acheter, recevoir et compter ce produit.
            </p>

            <div className='mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4'>
              <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
                Unité de stock
              </p>
              <p className='mt-2 text-base font-semibold text-slate-900'>
                1 {baseUnitLabel.toLocaleLowerCase('fr')}
              </p>
              <p className='mt-1 text-sm text-slate-600'>
                Toute quantité en stock est exprimée dans cette unité de base.
              </p>
            </div>

            <div className='mt-4 rounded-xl border border-slate-200 p-5'>
              <h3 className='font-semibold text-slate-900'>
                Conditionnements supplémentaires
              </h3>
              {product.packagings.length > 0 ? (
                <ul className='mt-4 divide-y divide-slate-100'>
                  {product.packagings.map((packaging) => (
                    <li
                      className='flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0'
                      key={packaging.id}
                    >
                      <span className='text-sm font-medium text-slate-900'>
                        {packaging.label}
                      </span>
                      <span className='text-sm text-slate-600'>
                        {packaging.quantity} {baseUnitPluralLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='mt-2 text-sm leading-6 text-slate-600'>
                  Aucun pack, carton ou autre conditionnement avec quantité de
                  conversion n’est encore défini pour ce produit.
                </p>
              )}
            </div>

            <div className='mt-4'>
              <PackagingForm
                baseUnitLabel={baseUnitLabel}
                productId={product.id}
              />
            </div>
          </section>
        </div>

        <aside
          aria-labelledby='traceability-title'
          className='h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'
        >
          <h2
            className='text-lg font-semibold text-slate-900'
            id='traceability-title'
          >
            Traçabilité
          </h2>
          <dl className='mt-5 space-y-5'>
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
                  <dt className='text-sm font-medium text-slate-500'>
                    Modifié le
                  </dt>
                  <dd className='mt-1 text-sm text-slate-900'>
                    {formatDate(product.updatedAt)}
                  </dd>
                </div>
                <div>
                  <dt className='text-sm font-medium text-slate-500'>
                    Modifié par
                  </dt>
                  <dd className='mt-1 text-sm text-slate-900'>
                    {product.updatedBy ?? 'Compte indisponible'}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </aside>
      </div>
    </main>
  );
};

export default ProductPage;
