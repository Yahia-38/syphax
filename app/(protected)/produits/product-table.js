'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

const BASE_UNITS = [
  { code: 'PIECE', label: 'Pièce' },
  { code: 'BOUTEILLE', label: 'Bouteille' },
  { code: 'BOITE', label: 'Boîte' },
  { code: 'SACHET', label: 'Sachet' },
];

const BASE_UNIT_LABELS = new Map(
  BASE_UNITS.map((baseUnit) => [baseUnit.code, baseUnit.label]),
);
const PRODUCTS_PER_PAGE = 10;

const formatMoney = (amountInCentimes) =>
  `${new Intl.NumberFormat('fr-DZ', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amountInCentimes / 100)} DA`;

const formatStockQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(quantity);

const getStockTextClass = (quantity) => quantity < 0
  ? 'text-red-700'
  : quantity > 0
    ? 'text-emerald-700'
    : 'text-slate-600';

const SortableHeader = ({
  align = 'left',
  className = '',
  label,
  onSort,
  sortDir,
  sorted,
}) => (
  <th
    aria-sort={sorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    className={`bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    scope='col'
  >
    <button
      className={`flex w-full items-center gap-2 rounded-sm ${align === 'right' ? 'justify-end' : 'justify-start'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700`}
      onClick={onSort}
      type='button'
    >
      <span>{label}</span>
      <span
        aria-hidden='true'
        className={sorted ? 'text-blue-700' : 'text-slate-300'}
      >
        {sorted && sortDir === 'desc' ? '▼' : '▲'}
      </span>
    </button>
  </th>
);

const ProductTable = ({
  canCreateProduct,
  canReadPricing,
  initialQuery,
  products,
}) => {
  const searchRef = useRef(null);
  const [query, setQuery] = useState(initialQuery);
  const [stockStatus, setStockStatus] = useState('ALL');
  const [unit, setUnit] = useState('ALL');
  const [onlyMissingPrice, setOnlyMissingPrice] = useState(false);
  const [sortKey, setSortKey] = useState('code');
  const [sortDir, setSortDir] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);

  const usedUnits = useMemo(() => {
    const usedUnitCodes = new Set(products.map((product) => product.baseUnit));
    return BASE_UNITS.filter((baseUnit) => usedUnitCodes.has(baseUnit.code));
  }, [products]);
  const missingPriceCount = useMemo(
    () => canReadPricing
      ? products.filter(
          (product) => !Number.isSafeInteger(product.salePriceCentimes),
        ).length
      : 0,
    [canReadPricing, products],
  );
  const stockCounts = useMemo(() => ({
    negative: products.filter(
      (product) => product.availableQuantityInBaseUnits < 0,
    ).length,
    positive: products.filter(
      (product) => product.availableQuantityInBaseUnits > 0,
    ).length,
    zero: products.filter(
      (product) => product.availableQuantityInBaseUnits === 0,
    ).length,
  }), [products]);
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filtersActive = Boolean(
    normalizedQuery
    || stockStatus !== 'ALL'
    || unit !== 'ALL'
    || onlyMissingPrice,
  );
  const filteredProducts = useMemo(() => {
    const matchingProducts = products.filter((product) => {
      const matchesQuery = !normalizedQuery
        || product.code.toLocaleLowerCase('fr').includes(normalizedQuery)
        || product.designation.toLocaleLowerCase('fr').includes(normalizedQuery);
      const matchesUnit = unit === 'ALL' || product.baseUnit === unit;
      const matchesPrice = !onlyMissingPrice
        || !Number.isSafeInteger(product.salePriceCentimes);
      const matchesStock = stockStatus === 'ALL'
        || (stockStatus === 'POSITIVE'
          && product.availableQuantityInBaseUnits > 0)
        || (stockStatus === 'ZERO'
          && product.availableQuantityInBaseUnits === 0)
        || (stockStatus === 'NEGATIVE'
          && product.availableQuantityInBaseUnits < 0);

      return matchesQuery && matchesUnit && matchesPrice && matchesStock;
    });
    const direction = sortDir === 'asc' ? 1 : -1;

    return matchingProducts.sort((firstProduct, secondProduct) => {
      if (sortKey === 'availableQuantityInBaseUnits') {
        return (
          firstProduct.availableQuantityInBaseUnits
          - secondProduct.availableQuantityInBaseUnits
        ) * direction;
      }

      if (sortKey === 'salePriceCentimes') {
        const firstPriceMissing = !Number.isSafeInteger(
          firstProduct.salePriceCentimes,
        );
        const secondPriceMissing = !Number.isSafeInteger(
          secondProduct.salePriceCentimes,
        );

        if (firstPriceMissing || secondPriceMissing) {
          if (firstPriceMissing && secondPriceMissing) {
            return 0;
          }

          return firstPriceMissing ? 1 : -1;
        }

        return (
          firstProduct.salePriceCentimes - secondProduct.salePriceCentimes
        ) * direction;
      }

      const firstValue = sortKey === 'baseUnit'
        ? BASE_UNIT_LABELS.get(firstProduct.baseUnit) ?? firstProduct.baseUnit
        : firstProduct[sortKey];
      const secondValue = sortKey === 'baseUnit'
        ? BASE_UNIT_LABELS.get(secondProduct.baseUnit) ?? secondProduct.baseUnit
        : secondProduct[sortKey];

      return firstValue.localeCompare(secondValue, 'fr') * direction;
    });
  }, [
    normalizedQuery,
    onlyMissingPrice,
    products,
    sortDir,
    sortKey,
    stockStatus,
    unit,
  ]);
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

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const targetIsInput = target instanceof HTMLElement && (
        target.isContentEditable
        || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      );

      if (
        event.key === '/'
        && !event.defaultPrevented
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !targetIsInput
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const resetFilters = () => {
    setQuery('');
    setStockStatus('ALL');
    setUnit('ALL');
    setOnlyMissingPrice(false);
    setCurrentPage(1);
  };

  const updateSort = (nextSortKey) => {
    setCurrentPage(1);

    if (sortKey === nextSortKey) {
      setSortDir((currentDirection) => (
        currentDirection === 'asc' ? 'desc' : 'asc'
      ));
      return;
    }

    setSortKey(nextSortKey);
    setSortDir('asc');
  };

  return (
    <section
      aria-labelledby='product-list-title'
      className='mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <h2 className='sr-only' id='product-list-title'>
        Liste des produits
      </h2>

      <div className='border-b border-slate-200 p-4'>
        <div className='flex flex-col gap-4' role='search'>
          <div className='relative max-w-xl'>
            <label className='sr-only' htmlFor='product-search'>
              Rechercher un produit
            </label>
            <input
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-10 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              id='product-search'
              maxLength={100}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder='Rechercher par code ou désignation'
              ref={searchRef}
              type='search'
              value={query}
            />
            <kbd className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-400'>
              /
            </kbd>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            {usedUnits.length > 1 && (
              <div
                aria-label='Filtrer par unité de base'
                className='flex flex-wrap gap-2'
                role='group'
              >
                <button
                  aria-pressed={unit === 'ALL'}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${unit === 'ALL' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                  onClick={() => {
                    setUnit('ALL');
                    setCurrentPage(1);
                  }}
                  type='button'
                >
                  Toutes unités
                </button>
                {usedUnits.map((baseUnit) => (
                  <button
                    aria-pressed={unit === baseUnit.code}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${unit === baseUnit.code ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                    key={baseUnit.code}
                    onClick={() => {
                      setUnit(baseUnit.code);
                      setCurrentPage(1);
                    }}
                    type='button'
                  >
                    {baseUnit.label}
                  </button>
                ))}
              </div>
            )}

            {canReadPricing && missingPriceCount > 0 && (
              <button
                aria-pressed={onlyMissingPrice}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${onlyMissingPrice ? 'border-amber-700 bg-amber-700 text-white' : 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100'}`}
                onClick={() => {
                  setOnlyMissingPrice((currentValue) => !currentValue);
                  setCurrentPage(1);
                }}
                type='button'
              >
                Sans prix ({missingPriceCount})
              </button>
            )}

            <div
              aria-label='Filtrer selon le stock'
              className='flex flex-wrap gap-2'
              role='group'
            >
              <button
                aria-pressed={stockStatus === 'POSITIVE'}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${stockStatus === 'POSITIVE' ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100'}`}
                onClick={() => {
                  setStockStatus((currentStatus) => (
                    currentStatus === 'POSITIVE' ? 'ALL' : 'POSITIVE'
                  ));
                  setCurrentPage(1);
                }}
                type='button'
              >
                En stock ({stockCounts.positive})
              </button>
              <button
                aria-pressed={stockStatus === 'ZERO'}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${stockStatus === 'ZERO' ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100'}`}
                onClick={() => {
                  setStockStatus((currentStatus) => (
                    currentStatus === 'ZERO' ? 'ALL' : 'ZERO'
                  ));
                  setCurrentPage(1);
                }}
                type='button'
              >
                Stock nul ({stockCounts.zero})
              </button>
              {stockCounts.negative > 0 && (
                <button
                  aria-pressed={stockStatus === 'NEGATIVE'}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${stockStatus === 'NEGATIVE' ? 'border-red-700 bg-red-700 text-white' : 'border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100'}`}
                  onClick={() => {
                    setStockStatus((currentStatus) => (
                      currentStatus === 'NEGATIVE' ? 'ALL' : 'NEGATIVE'
                    ));
                    setCurrentPage(1);
                  }}
                  type='button'
                >
                  Stock négatif ({stockCounts.negative})
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className='flex min-h-12 items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6'>
        <p className='text-sm text-slate-500'>
          {filteredProducts.length > 0
            ? `${firstProductIndex + 1}–${firstProductIndex + paginatedProducts.length} sur ${filteredProducts.length} produits${filtersActive ? ` (${products.length} au total)` : ''}`
            : `0 produit${filtersActive ? ` sur ${products.length}` : ''}`}
        </p>
        {filtersActive && (
          <button
            className='rounded-lg px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={resetFilters}
            type='button'
          >
            Réinitialiser les filtres
          </button>
        )}
      </div>

      {filteredProducts.length > 0 ? (
        <>
          <table className='w-full table-fixed divide-y divide-slate-200'>
            <caption className='sr-only'>Liste des produits</caption>
            <thead>
              <tr>
                <SortableHeader
                  className='w-[30%] sm:w-[22%] lg:w-[18%]'
                  label='Code'
                  onSort={() => updateSort('code')}
                  sortDir={sortDir}
                  sorted={sortKey === 'code'}
                />
                <SortableHeader
                  className='w-auto'
                  label='Désignation'
                  onSort={() => updateSort('designation')}
                  sortDir={sortDir}
                  sorted={sortKey === 'designation'}
                />
                <SortableHeader
                  className='hidden w-[15%] lg:table-cell'
                  label='Unité de base'
                  onSort={() => updateSort('baseUnit')}
                  sortDir={sortDir}
                  sorted={sortKey === 'baseUnit'}
                />
                <SortableHeader
                  align='right'
                  className='hidden w-[18%] sm:table-cell'
                  label='Stocks'
                  onSort={() => updateSort('availableQuantityInBaseUnits')}
                  sortDir={sortDir}
                  sorted={sortKey === 'availableQuantityInBaseUnits'}
                />
                {canReadPricing && (
                  <SortableHeader
                    align='right'
                    className='hidden w-[18%] md:table-cell'
                    label='Prix de vente TTC'
                    onSort={() => updateSort('salePriceCentimes')}
                    sortDir={sortDir}
                    sorted={sortKey === 'salePriceCentimes'}
                  />
                )}
                <th
                  className='w-14 bg-slate-50 px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-[90px] sm:px-4 lg:w-[120px] lg:px-6'
                  scope='col'
                >
                  <span className='hidden sm:inline'>Actions</span>
                  <span className='sr-only sm:hidden'>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-slate-100 bg-white'>
              {paginatedProducts.map((product) => (
                <tr className='hover:bg-slate-50' key={product.id}>
                  <td className='p-0'>
                    <Link
                      className='block break-all px-4 py-3 font-mono text-[13px] font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:px-6'
                      href={`/produits/${product.id}`}
                    >
                      {product.code}
                    </Link>
                  </td>
                  <td className='p-0'>
                    <Link
                      className='block break-words px-4 py-3 text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:px-6'
                      href={`/produits/${product.id}`}
                    >
                      <span>{product.designation}</span>
                      <span className='mt-1 flex flex-wrap items-center gap-1.5 lg:hidden'>
                        <span className='rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600'>
                          {BASE_UNIT_LABELS.get(product.baseUnit)
                            ?? product.baseUnit}
                        </span>
                        {canReadPricing && (
                          <span className='md:hidden'>
                            {Number.isSafeInteger(
                              product.salePriceCentimes,
                            ) ? (
                              <span className='text-xs font-semibold tabular-nums text-slate-700'>
                                {formatMoney(product.salePriceCentimes)}
                              </span>
                            ) : (
                              <span className='rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700'>
                                Sans prix
                              </span>
                            )}
                          </span>
                        )}
                        <span
                          className={`text-xs font-semibold tabular-nums sm:hidden ${getStockTextClass(product.availableQuantityInBaseUnits)}`}
                        >
                          Disponible : {formatStockQuantity(
                            product.availableQuantityInBaseUnits,
                          )}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className='hidden px-4 py-3 sm:px-6 lg:table-cell'>
                    <span className='rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600'>
                      {BASE_UNIT_LABELS.get(product.baseUnit) ?? product.baseUnit}
                    </span>
                  </td>
                  <td className='hidden px-4 py-3 text-right sm:table-cell sm:px-6'>
                    <dl className='space-y-0.5 text-xs tabular-nums'>
                      <div className='flex justify-end gap-2'>
                        <dt className='text-slate-500'>Entrepôt</dt>
                        <dd className='font-semibold text-slate-800'>
                          {formatStockQuantity(product.stockQuantityInBaseUnits)}
                        </dd>
                      </div>
                      <div className='flex justify-end gap-2'>
                        <dt className='text-slate-500'>Réservé</dt>
                        <dd className='font-semibold text-amber-700'>
                          {formatStockQuantity(product.reservedQuantityInBaseUnits)}
                        </dd>
                      </div>
                      <div className='flex justify-end gap-2'>
                        <dt className='font-medium text-slate-600'>Disponible</dt>
                        <dd className={`font-bold ${getStockTextClass(product.availableQuantityInBaseUnits)}`}>
                          {formatStockQuantity(product.availableQuantityInBaseUnits)}
                        </dd>
                      </div>
                    </dl>
                  </td>
                  {canReadPricing && (
                    <td className='hidden px-4 py-3 text-right md:table-cell sm:px-6'>
                      {Number.isSafeInteger(product.salePriceCentimes) ? (
                        <span className='font-semibold tabular-nums text-slate-900'>
                          {formatMoney(product.salePriceCentimes)}
                        </span>
                      ) : (
                        <span className='rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs text-amber-700'>
                          Non renseigné
                        </span>
                      )}
                    </td>
                  )}
                  <td className='px-2 py-3 sm:px-4 lg:px-6'>
                    <div className='flex justify-center'>
                      <Link
                        aria-label='Voir la fiche produit'
                        className='inline-flex h-8 w-8 items-center justify-center rounded-lg text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                        href={`/produits/${product.id}`}
                        title='Voir la fiche produit'
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
                          <path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z' />
                          <circle cx='12' cy='12' r='3' />
                        </svg>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <nav
            aria-label='Pagination des produits'
            className='flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3 sm:px-6'
          >
            <button
              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40'
              disabled={activePage === 1}
              onClick={() => setCurrentPage(activePage - 1)}
              type='button'
            >
              Précédent
            </button>
            <p aria-live='polite' className='text-sm font-medium text-slate-600'>
              Page {activePage} sur {totalPages}
            </p>
            <button
              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40'
              disabled={activePage === totalPages}
              onClick={() => setCurrentPage(activePage + 1)}
              type='button'
            >
              Suivant
            </button>
          </nav>
        </>
      ) : (
        <div className='px-6 py-14 text-center'>
          <h3 className='font-semibold text-slate-900'>
            {filtersActive ? 'Aucun produit trouvé' : 'Aucun produit enregistré'}
          </h3>
          <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
            {normalizedQuery
              ? `Aucun code ou désignation ne correspond à « ${query.trim()} ».`
              : filtersActive
                ? 'Aucun produit ne correspond aux filtres actifs.'
                : 'Créez le premier produit pour commencer à constituer le catalogue.'}
          </p>
          {filtersActive ? (
            <button
              className='mt-5 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              onClick={resetFilters}
              type='button'
            >
              Voir tous les produits
            </button>
          ) : canCreateProduct ? (
            <Link
              className='mt-5 inline-flex rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              href='/produits/nouveau'
            >
              Créer un produit
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
};

export default ProductTable;
