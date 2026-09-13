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

const formatMoney = (amountInCentimes) =>
  `${new Intl.NumberFormat('fr-DZ', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amountInCentimes / 100)} DA`;

const SortableHeader = ({ align = 'left', label, onSort, sortDir, sorted }) => (
  <th
    aria-sort={sorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    className={`sticky top-0 z-10 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6 ${align === 'right' ? 'text-right' : 'text-left'}`}
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

const ProductTable = ({ canCreateProduct, initialQuery, products }) => {
  const searchRef = useRef(null);
  const [query, setQuery] = useState(initialQuery);
  const [unit, setUnit] = useState('ALL');
  const [onlyMissingPrice, setOnlyMissingPrice] = useState(false);
  const [sortKey, setSortKey] = useState('code');
  const [sortDir, setSortDir] = useState('asc');

  const usedUnits = useMemo(() => {
    const usedUnitCodes = new Set(products.map((product) => product.baseUnit));
    return BASE_UNITS.filter((baseUnit) => usedUnitCodes.has(baseUnit.code));
  }, [products]);
  const missingPriceCount = useMemo(
    () => products.filter(
      (product) => !Number.isSafeInteger(product.salePriceCentimes),
    ).length,
    [products],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filtersActive = Boolean(
    normalizedQuery || unit !== 'ALL' || onlyMissingPrice,
  );
  const filteredProducts = useMemo(() => {
    const matchingProducts = products.filter((product) => {
      const matchesQuery = !normalizedQuery
        || product.code.toLocaleLowerCase('fr').includes(normalizedQuery)
        || product.designation.toLocaleLowerCase('fr').includes(normalizedQuery);
      const matchesUnit = unit === 'ALL' || product.baseUnit === unit;
      const matchesPrice = !onlyMissingPrice
        || !Number.isSafeInteger(product.salePriceCentimes);

      return matchesQuery && matchesUnit && matchesPrice;
    });
    const direction = sortDir === 'asc' ? 1 : -1;

    return matchingProducts.sort((firstProduct, secondProduct) => {
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
  }, [normalizedQuery, onlyMissingPrice, products, sortDir, sortKey, unit]);

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
    setUnit('ALL');
    setOnlyMissingPrice(false);
  };

  const updateSort = (nextSortKey) => {
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
              onChange={(event) => setQuery(event.target.value)}
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
                  onClick={() => setUnit('ALL')}
                  type='button'
                >
                  Toutes unités
                </button>
                {usedUnits.map((baseUnit) => (
                  <button
                    aria-pressed={unit === baseUnit.code}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${unit === baseUnit.code ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                    key={baseUnit.code}
                    onClick={() => setUnit(baseUnit.code)}
                    type='button'
                  >
                    {baseUnit.label}
                  </button>
                ))}
              </div>
            )}

            {missingPriceCount > 0 && (
              <button
                aria-pressed={onlyMissingPrice}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${onlyMissingPrice ? 'border-amber-700 bg-amber-700 text-white' : 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100'}`}
                onClick={() => setOnlyMissingPrice((currentValue) => !currentValue)}
                type='button'
              >
                Sans prix ({missingPriceCount})
              </button>
            )}
          </div>
        </div>
      </div>

      <div className='flex min-h-12 items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6'>
        <p className='text-sm text-slate-500'>
          {filtersActive
            ? `${filteredProducts.length} produits sur ${products.length}`
            : `${products.length} produits`}
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
        <div className='max-h-[calc(100vh-280px)] overflow-x-auto overflow-y-auto'>
          <table className='min-w-full divide-y divide-slate-200'>
            <caption className='sr-only'>Liste des produits</caption>
            <thead>
              <tr>
                <SortableHeader
                  label='Code'
                  onSort={() => updateSort('code')}
                  sortDir={sortDir}
                  sorted={sortKey === 'code'}
                />
                <SortableHeader
                  label='Désignation'
                  onSort={() => updateSort('designation')}
                  sortDir={sortDir}
                  sorted={sortKey === 'designation'}
                />
                <SortableHeader
                  label='Unité de base'
                  onSort={() => updateSort('baseUnit')}
                  sortDir={sortDir}
                  sorted={sortKey === 'baseUnit'}
                />
                <SortableHeader
                  align='right'
                  label='Prix de vente TTC'
                  onSort={() => updateSort('salePriceCentimes')}
                  sortDir={sortDir}
                  sorted={sortKey === 'salePriceCentimes'}
                />
                <th
                  className='sticky top-0 z-10 w-[120px] bg-slate-50 px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6'
                  scope='col'
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-slate-100 bg-white'>
              {filteredProducts.map((product) => (
                <tr className='hover:bg-slate-50' key={product.id}>
                  <td className='whitespace-nowrap p-0'>
                    <Link
                      className='block px-4 py-3 font-mono text-[13px] font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:px-6'
                      href={`/produits/${product.id}`}
                    >
                      {product.code}
                    </Link>
                  </td>
                  <td className='p-0'>
                    <Link
                      className='block px-4 py-3 text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:px-6'
                      href={`/produits/${product.id}`}
                    >
                      {product.designation}
                    </Link>
                  </td>
                  <td className='whitespace-nowrap px-4 py-3 sm:px-6'>
                    <span className='rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600'>
                      {BASE_UNIT_LABELS.get(product.baseUnit) ?? product.baseUnit}
                    </span>
                  </td>
                  <td className='whitespace-nowrap px-4 py-3 text-right sm:px-6'>
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
                  <td className='w-[120px] px-4 py-3 sm:px-6'>
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
        </div>
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
