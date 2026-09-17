'use client';

import { useTourActionState, useTourDraft } from './tour-operation-context.js';

import { useMemo, useState } from 'react';
import { formatQuantityInDisplayUnit, getProductDisplayUnit } from '../../../../lib/product-display-unit.js';
import { getSalePackagings } from '../../../../lib/product-packaging.js';

import { addTourProduct } from './actions.js';

const INPUT_CLASS = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';
const PRODUCTS_PER_PAGE = 8;
const INITIAL_STATE = {
  errors: {},
  message: null,
  replayed: false,
  revision: 0,
  values: {},
};

const formatQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(quantity);

const parsePositiveInteger = (value) => {
  const normalizedValue = value.trim();

  if (!/^\d+$/u.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : null;
};

const TourProductForm = ({
  existingProductIds,
  initialAdditionKey,
  products,
  tourId,
  embedded = false,
}) => {
  const addProductToTour = addTourProduct.bind(null, tourId);
  const [additionKey, setAdditionKey] = useState(initialAdditionKey);
  const [productQuery, setProductQuery] = useState('');
  const [productId, setProductId] = useState('');
  const [quantityMode, setQuantityMode] = useState('PACKAGING');
  const [directQuantity, setDirectQuantity] = useState('');
  const [packagingId, setPackagingId] = useState('');
  const [packagingCount, setPackagingCount] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const runProductAdd = async (previousState, formData) => {
    const nextState = await addProductToTour(previousState, formData);

    if (nextState.message) {
      setAdditionKey(globalThis.crypto.randomUUID());
      setProductQuery('');
      setProductId('');
      setQuantityMode('PACKAGING');
      setDirectQuantity('');
      setPackagingId('');
      setPackagingCount('');
      setCurrentPage(1);
    }

    return nextState;
  };
  const [state, formAction, pending] = useTourActionState(
    runProductAdd,
    INITIAL_STATE,
  );
  useTourDraft({ productId, quantityMode, directQuantity, packagingId, packagingCount });
  const existingProducts = useMemo(
    () => new Set(existingProductIds),
    [existingProductIds],
  );
  const normalizedQuery = productQuery.trim().toLocaleLowerCase('fr');
  const filteredProducts = useMemo(
    () => products.filter((product) => !normalizedQuery
      || product.code.toLocaleLowerCase('fr').includes(normalizedQuery)
      || product.designation.toLocaleLowerCase('fr').includes(normalizedQuery)),
    [normalizedQuery, products],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstProductIndex = (activePage - 1) * PRODUCTS_PER_PAGE;
  const paginatedProducts = filteredProducts.slice(
    firstProductIndex,
    firstProductIndex + PRODUCTS_PER_PAGE,
  );
  const product = products.find((candidate) => candidate.id === productId)
    ?? null;
  const salePackagings = getSalePackagings(product?.packagings);
  const packaging = salePackagings.find(
    (candidate) => candidate.id === packagingId,
  ) ?? null;
  const directQuantityValue = parsePositiveInteger(directQuantity);
  const packagingCountValue = parsePositiveInteger(packagingCount);
  const totalQuantity = quantityMode === 'DIRECT'
    ? directQuantityValue
    : packaging && packagingCountValue !== null
      ? packaging.quantity * packagingCountValue
      : null;
  const safeTotalQuantity = Number.isSafeInteger(totalQuantity)
    ? totalQuantity
    : null;
  const productAlreadyPresent = product
    ? existingProducts.has(product.id)
    : false;
  const lowerBaseUnit = product?.baseUnit.toLocaleLowerCase('fr')
    ?? 'unité de base';
  const stockUnitOptions = {
    baseUnitLabel: lowerBaseUnit,
    displayUnit: getProductDisplayUnit(product ?? undefined),
  };

  const changeProduct = (nextProductId) => {
    const nextProduct = products.find((candidate) => candidate.id === nextProductId);
    const defaultPackaging = getSalePackagings(nextProduct?.packagings)[0];
    setProductId(nextProductId);
    setQuantityMode(!nextProduct || defaultPackaging ? 'PACKAGING' : 'DIRECT');
    setDirectQuantity('');
    setPackagingId(defaultPackaging?.id ?? '');
    setPackagingCount('');
  };

  return (
    <section
      aria-labelledby={embedded ? undefined : 'add-tour-product-title'} aria-label={embedded ? 'Réserver un produit' : undefined}
      className={embedded ? 'tour-embedded' : 'mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'}
    >
      {!embedded && <div className='border-b border-slate-200 p-5 sm:p-6'>
        <h2
          className='text-lg font-semibold text-slate-900'
          id='add-tour-product-title'
        >
          Ajouter un produit
        </h2>
        <p className='mt-1 text-sm leading-6 text-slate-600'>
          La quantité est réservée immédiatement sans créer de mouvement de stock.
        </p>
      </div>}

      <form action={formAction} className='space-y-6 p-5 sm:p-6'>
        <input name='additionKey' type='hidden' value={additionKey} />
        <input name='quantityMode' type='hidden' value={quantityMode} />

        {state.errors.form && (
          <p
            className='rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
            role='alert' tabIndex={-1}
          >
            {state.errors.form}
          </p>
        )}
        {state.message && (
          <p
            className='rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
            role='status'
          >
            {state.message}
          </p>
        )}

        <div>
          <label
            className='block text-sm font-medium text-slate-700'
            htmlFor='tour-product-search'
          >
            Rechercher dans le catalogue
          </label>
          <input
            className={INPUT_CLASS}
            id='tour-product-search'
            maxLength={100}
            onChange={(event) => {
              setProductQuery(event.target.value);
              changeProduct('');
              setCurrentPage(1);
            }}
            placeholder='Code ou désignation'
            type='search'
            value={productQuery}
          />
        </div>

        <div>
          <div className='flex items-end justify-between gap-4'>
            <label
              className='block text-sm font-medium text-slate-700'
              htmlFor='tour-product'
            >
              Produit existant
            </label>
            <span className='text-xs text-slate-500'>
              {filteredProducts.length === 0
                ? '0 produit'
                : `${firstProductIndex + 1}–${firstProductIndex + paginatedProducts.length} sur ${filteredProducts.length}`}
            </span>
          </div>
          <select
            aria-describedby={state.errors.productId
              ? 'tour-product-error'
              : undefined}
            aria-invalid={Boolean(state.errors.productId)}
            className={INPUT_CLASS}
            id='tour-product'
            name='productId'
            onChange={(event) => changeProduct(event.target.value)}
            required
            value={productId}
          >
            <option value=''>Sélectionnez un produit</option>
            {paginatedProducts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code} — {candidate.designation}
                {existingProducts.has(candidate.id) ? ' — déjà ajouté' : ''}
              </option>
            ))}
          </select>
          {state.errors.productId && (
            <p className='mt-2 text-sm text-red-700' id='tour-product-error'>
              {state.errors.productId}
            </p>
          )}
          <div className='mt-3 flex items-center justify-between gap-4'>
            <button
              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40'
              disabled={activePage === 1}
              onClick={() => {
                changeProduct('');
                setCurrentPage(activePage - 1);
              }}
              type='button'
            >
              Précédent
            </button>
            <span className='text-sm text-slate-600'>
              Page {activePage} sur {totalPages}
            </span>
            <button
              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40'
              disabled={activePage === totalPages}
              onClick={() => {
                changeProduct('');
                setCurrentPage(activePage + 1);
              }}
              type='button'
            >
              Suivant
            </button>
          </div>
        </div>

        {product && (
          <div className='grid gap-4 sm:grid-cols-3'>
            <div className='rounded-xl border border-slate-200 bg-slate-50 p-4'>
              <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                En entrepôt
              </p>
              <p className='mt-2 text-xl font-bold text-slate-900'>
                {formatQuantityInDisplayUnit(product.stockQuantityInBaseUnits, stockUnitOptions)}
              </p>
            </div>
            <div className='rounded-xl border border-amber-200 bg-amber-50 p-4'>
              <p className='text-xs font-semibold uppercase tracking-wide text-amber-700'>
                Réservé
              </p>
              <p className='mt-2 text-xl font-bold text-amber-900'>
                {formatQuantityInDisplayUnit(product.reservedQuantityInBaseUnits, stockUnitOptions)}
              </p>
            </div>
            <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-4'>
              <p className='text-xs font-semibold uppercase tracking-wide text-emerald-700'>
                Disponible
              </p>
              <p className='mt-2 text-xl font-bold text-emerald-900'>
                {formatQuantityInDisplayUnit(product.availableQuantityInBaseUnits, stockUnitOptions)}
              </p>
            </div>
          </div>
        )}

        {productAlreadyPresent && (
          <p className='rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800'>
            Ce produit est déjà présent dans cette tournée. Sa quantité ne peut pas encore être modifiée.
          </p>
        )}

        <fieldset disabled={!product || productAlreadyPresent || pending}>
          <legend className='text-sm font-medium text-slate-700'>
            Mode de saisie
          </legend>
          <div className='mt-2 flex flex-col gap-2 sm:flex-row sm:gap-6'>
            <label className='inline-flex items-center gap-2 text-sm text-slate-700'>
              <input
                checked={quantityMode === 'DIRECT'}
                onChange={() => {
                  setQuantityMode('DIRECT');
                  setPackagingId('');
                  setPackagingCount('');
                }}
                type='radio'
              />
              Quantité en unité de base
            </label>
            <label className='inline-flex items-center gap-2 text-sm text-slate-700'>
              <input
                checked={quantityMode === 'PACKAGING'}
                disabled={!salePackagings.length}
                onChange={() => {
                  setQuantityMode('PACKAGING');
                  setDirectQuantity('');
                  setPackagingId(salePackagings[0]?.id ?? '');
                }}
                type='radio'
              />
              Via un conditionnement
            </label>
          </div>
        </fieldset>

        {quantityMode === 'DIRECT' ? (
          <div>
            <label
              className='block text-sm font-medium text-slate-700'
              htmlFor='tour-direct-quantity'
            >
              Quantité en {lowerBaseUnit}
            </label>
            <input
              aria-describedby={state.errors.directQuantity
                ? 'tour-direct-quantity-error'
                : undefined}
              aria-invalid={Boolean(state.errors.directQuantity)}
              className={INPUT_CLASS}
              disabled={!product || productAlreadyPresent}
              id='tour-direct-quantity'
              inputMode='numeric'
              min='1'
              name='directQuantity'
              onChange={(event) => setDirectQuantity(event.target.value)}
              placeholder='Ex. 30'
              required
              step='1'
              type='number'
              value={directQuantity}
            />
            {state.errors.directQuantity && (
              <p
                className='mt-2 text-sm text-red-700'
                id='tour-direct-quantity-error'
              >
                {state.errors.directQuantity}
              </p>
            )}
          </div>
        ) : (
          <div className='grid gap-5 sm:grid-cols-2'>
            <div>
              <label
                className='block text-sm font-medium text-slate-700'
                htmlFor='tour-packaging'
              >
                Conditionnement
              </label>
              <select
                aria-describedby={state.errors.packagingId
                  ? 'tour-packaging-error'
                  : undefined}
                aria-invalid={Boolean(state.errors.packagingId)}
                className={INPUT_CLASS}
                id='tour-packaging'
                name='packagingId'
                onChange={(event) => setPackagingId(event.target.value)}
                required
                value={packagingId}
              >
                <option value=''>Sélectionnez un conditionnement</option>
                {salePackagings.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label} — {candidate.quantity} {lowerBaseUnit}
                  </option>
                ))}
              </select>
              {state.errors.packagingId && (
                <p className='mt-2 text-sm text-red-700' id='tour-packaging-error'>
                  {state.errors.packagingId}
                </p>
              )}
            </div>
            <div>
              <label
                className='block text-sm font-medium text-slate-700'
                htmlFor='tour-packaging-count'
              >
                Nombre de conditionnements
              </label>
              <input
                aria-describedby={state.errors.packagingCount
                  ? 'tour-packaging-count-error'
                  : undefined}
                aria-invalid={Boolean(state.errors.packagingCount)}
                className={INPUT_CLASS}
                id='tour-packaging-count'
                inputMode='numeric'
                min='1'
                name='packagingCount'
                onChange={(event) => setPackagingCount(event.target.value)}
                required
                step='1'
                type='number'
                value={packagingCount}
              />
              {state.errors.packagingCount && (
                <p
                  className='mt-2 text-sm text-red-700'
                  id='tour-packaging-count-error'
                >
                  {state.errors.packagingCount}
                </p>
              )}
            </div>
          </div>
        )}

        <div className='rounded-xl border border-blue-200 bg-blue-50 p-4'>
          <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
            Conversion appliquée
          </p>
          <p className='mt-2 text-sm text-blue-900'>
            {quantityMode === 'PACKAGING' && packaging
              ? `1 ${packaging.label} = ${formatQuantity(packaging.quantity)} ${lowerBaseUnit}`
              : product
                ? `Saisie directe : 1 = 1 ${lowerBaseUnit}`
                : 'Sélectionnez un produit.'}
          </p>
          <p className='mt-2 text-xl font-bold text-blue-950'>
            Total demandé : {safeTotalQuantity === null
              ? '—'
              : formatQuantity(safeTotalQuantity)} {lowerBaseUnit}
          </p>
          {state.errors.quantity && (
            <p className='mt-2 text-sm text-red-700' role='alert' tabIndex={-1}>
              {state.errors.quantity}
            </p>
          )}
        </div>

        <div className='flex justify-end'>
          <button
            className='rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
            disabled={
              pending
              || !product
              || productAlreadyPresent
              || safeTotalQuantity === null
            }
            type='submit'
          >
            {pending ? 'Réservation…' : 'Ajouter et réserver'}
          </button>
        </div>
      </form>
    </section>
  );
};

export default TourProductForm;
