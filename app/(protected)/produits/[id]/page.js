import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getUserPermissions } from '../../../../lib/access.js';
import { BASE_UNITS, getProductById } from '../../../../lib/products.js';
import { getLatestProductPurchaseCost } from '../../../../lib/reception-records.js';
import { requirePermission } from '../../../../lib/sessions.js';
import DeleteProductButton from '../delete-product-button.js';
import PackagingForm from './packaging-form.js';
import PriceHistory from './price-history.js';
import PricingForm from './pricing-form.js';
import ProductEditForm from './product-edit-form.js';
import ProductTabs from './product-tabs.js';
import PurchaseCostCard from './purchase-cost-card.js';
import StockMovementHistory from './stock-movement-history.js';

export const metadata = {
  title: 'Fiche produit | Syphax',
};

const SECTIONS = new Set([
  'identification',
  'stock',
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

const formatPriceInput = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) {
    return '';
  }

  return (amountInCentimes / 100).toFixed(2).replace(/\.00$/u, '');
};

const formatStockQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(quantity);

const StockSection = ({ baseUnitLabel, product }) => {
  const { stock } = product;
  const stockTone = stock.availableQuantityInBaseUnits < 0
    ? 'border-red-200 bg-red-50 text-red-800'
    : stock.availableQuantityInBaseUnits > 0
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <div
      aria-labelledby='stock-tab'
      className='space-y-6'
      id='stock-panel'
      role='tabpanel'
    >
      <section aria-labelledby='current-stock-title'>
        <h2 className='sr-only' id='current-stock-title'>Stock actuel</h2>
        <dl className='grid gap-4 sm:grid-cols-3'>
          <div className='rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'>
            <dt className='text-sm font-bold uppercase tracking-[0.08em] text-slate-600'>
              En entrepôt
            </dt>
            <dd className='mt-3 text-4xl font-bold tabular-nums text-slate-900'>
              {formatStockQuantity(stock.quantityInBaseUnits)}
            </dd>
            <p className='mt-1 text-sm text-slate-500'>
              {baseUnitLabel.toLocaleLowerCase('fr')}
            </p>
          </div>
          <div className='rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm'>
            <dt className='text-sm font-bold uppercase tracking-[0.08em] text-amber-700'>
              Réservé
            </dt>
            <dd className='mt-3 text-4xl font-bold tabular-nums text-amber-900'>
              {formatStockQuantity(stock.reservedQuantityInBaseUnits)}
            </dd>
            <p className='mt-1 text-sm text-amber-700'>
              {baseUnitLabel.toLocaleLowerCase('fr')}
            </p>
          </div>
          <div className={`rounded-2xl border p-6 shadow-sm ${stockTone}`}>
            <dt className='text-sm font-bold uppercase tracking-[0.08em]'>
              Disponible
            </dt>
            <dd className='mt-3 text-4xl font-bold tabular-nums'>
              {formatStockQuantity(stock.availableQuantityInBaseUnits)}
            </dd>
            <p className='mt-1 text-sm font-medium'>
              {baseUnitLabel.toLocaleLowerCase('fr')}
            </p>
          </div>
        </dl>
        {stock.availableQuantityInBaseUnits < 0 && (
          <p className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'>
            Le disponible est négatif : les sorties physiques et réservations
            dépassent le stock en entrepôt.
          </p>
        )}
      </section>

      <section
        aria-labelledby='stock-summary-title'
        className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
      >
        <div className='border-b border-slate-100 px-6 py-5'>
          <h2
            className='text-lg font-semibold text-slate-900'
            id='stock-summary-title'
          >
            Détail des mouvements
          </h2>
          <p className='mt-1 text-sm text-slate-600'>
            Historique physique uniquement, dans l’unité de base du produit.
            Les réservations ne sont pas des sorties.
          </p>
        </div>
        <dl className='grid sm:grid-cols-2 lg:grid-cols-4'>
          <div className='border-b border-slate-100 px-6 py-5 sm:border-r lg:border-b-0'>
            <dt className='text-sm font-medium text-slate-500'>Entrées</dt>
            <dd className='mt-2 text-2xl font-bold tabular-nums text-emerald-700'>
              +{formatStockQuantity(stock.inputQuantityInBaseUnits)}
            </dd>
          </div>
          <div className='border-b border-slate-100 px-6 py-5 lg:border-b-0 lg:border-r'>
            <dt className='text-sm font-medium text-slate-500'>Sorties</dt>
            <dd className='mt-2 text-2xl font-bold tabular-nums text-red-700'>
              −{formatStockQuantity(stock.outputQuantityInBaseUnits)}
            </dd>
          </div>
          <div className='border-b border-slate-100 px-6 py-5 sm:border-b-0 sm:border-r'>
            <dt className='text-sm font-medium text-slate-500'>Mouvements</dt>
            <dd className='mt-2 text-2xl font-bold tabular-nums text-slate-900'>
              {formatStockQuantity(stock.movementCount)}
            </dd>
          </div>
          <div className='px-6 py-5'>
            <dt className='text-sm font-medium text-slate-500'>Dernier mouvement</dt>
            <dd className='mt-2 text-sm font-semibold text-slate-900'>
              {formatDate(stock.lastMovementAt)}
            </dd>
          </div>
        </dl>
      </section>

      <StockMovementHistory movements={stock.movements} />
    </div>
  );
};

const IdentificationSection = ({
  baseUnitLabel,
  canUpdateProduct,
  editing,
  product,
}) => (
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
      <div className='flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-5'>
        <h2
          className='text-lg font-semibold text-slate-900'
          id='identification-title'
        >
          {editing ? 'Modifier l’identification' : 'Identification'}
        </h2>
        {canUpdateProduct && !editing && (
          <Link
            aria-label='Modifier la fiche'
            className='inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            href={`/produits/${product.id}?section=identification&modifier=1`}
            title='Modifier la fiche'
          >
            <svg
              aria-hidden='true'
              fill='none'
              height='18'
              stroke='currentColor'
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth='2'
              viewBox='0 0 24 24'
              width='18'
            >
              <path d='M12 20h9' />
              <path d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' />
            </svg>
          </Link>
        )}
      </div>
      {editing ? (
        <ProductEditForm baseUnits={BASE_UNITS} product={product} />
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

const ProductPage = async ({ params, searchParams }) => {
  const session = await requirePermission('products.read');

  const [{ id }, query = {}, permissions] = await Promise.all([
    params,
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const canReadPackaging = permissions.includes('packaging.read');
  const canReadPricing = permissions.includes('pricing.read');
  const canReadPurchaseCosts = permissions.includes('receptions.read');
  const canReadTarification = canReadPricing || canReadPurchaseCosts;
  const requestedSection = typeof query.section === 'string'
    ? query.section
    : '';
  const product = await getProductById(id, {
    includePricing: canReadPricing,
    includeStockMovements: requestedSection === 'stock',
    includeTourSources: permissions.includes('tours.read'),
  });

  if (!product) {
    notFound();
  }

  const activeSection = SECTIONS.has(requestedSection)
    && (requestedSection !== 'conditionnements' || canReadPackaging)
    && (requestedSection !== 'tarification' || canReadTarification)
    ? requestedSection
    : 'identification';
  const canDeleteProduct = permissions.includes('products.delete');
  const canUpdateProduct = permissions.includes('products.update');
  const canUpdatePrice = canReadPricing
    && permissions.includes('pricing.update');
  const canCreatePackaging = permissions.includes('packaging.create');
  const canDeletePackaging = permissions.includes('packaging.delete');
  const editingProduct = activeSection === 'identification'
    && query.modifier === '1'
    && canUpdateProduct;
  const openPricePanel = activeSection === 'tarification'
    && query.prix === '1'
    && canUpdatePrice;
  const baseUnit = BASE_UNITS.find((unit) => unit.code === product.baseUnit);
  const baseUnitLabel = baseUnit?.label ?? product.baseUnit;
  const latestPriceChange = product.salePriceHistory[0] ?? null;
  const latestPurchaseCost = activeSection === 'tarification'
    && canReadPurchaseCosts
    ? await getLatestProductPurchaseCost({
        baseUnit: product.baseUnit,
        productId: product.id,
        userId: session.userId,
      })
    : null;

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
                  className={`rounded-md border px-2.5 py-1 text-[13px] font-semibold tabular-nums ${
                    product.stock.quantityInBaseUnits < 0
                      ? 'border-red-100 bg-red-50 text-red-700'
                      : product.stock.quantityInBaseUnits > 0
                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  Stock : {formatStockQuantity(
                    product.stock.quantityInBaseUnits,
                  )}
                </span>
                {canReadPricing && (
                  <span
                    className={`rounded-md border px-2.5 py-1 text-[13px] font-semibold ${
                      product.salePrice
                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        : 'border-amber-100 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {product.salePrice ? 'Prix défini' : 'Prix à définir'}
                  </span>
                )}
              </div>
            </div>

            <div className='mt-4 flex flex-wrap items-center gap-3'>
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
            canReadPackaging={canReadPackaging}
            canReadPricing={canReadPricing}
            canReadPurchaseCosts={canReadPurchaseCosts}
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
            canUpdateProduct={canUpdateProduct}
            editing={editingProduct}
            product={product}
          />
        )}

        {activeSection === 'stock' && (
          <StockSection
            baseUnitLabel={baseUnitLabel}
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
            {canReadPricing && (
              <PricingForm
                baseUnitLabel={baseUnitLabel}
                canUpdatePrice={canUpdatePrice}
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
            )}
            {canReadPurchaseCosts && (
              <PurchaseCostCard
                baseUnitLabel={baseUnitLabel}
                purchaseCost={latestPurchaseCost}
                salePriceInCentimes={product.salePrice?.amountInCentimes ?? null}
                showPriceComparison={canReadPricing}
              />
            )}
            {canReadPricing && (
              <PriceHistory history={product.salePriceHistory} />
            )}
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
              canCreatePackaging={canCreatePackaging}
              canDeletePackaging={canDeletePackaging}
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
