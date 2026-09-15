'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import styles from './product-table.module.css';
import {
  BASE_UNIT_LABELS,
  BASE_UNITS,
  filterAndSortProducts,
  getProductStockCounts,
  paginateProducts,
  shouldFocusProductSearch,
} from './product-table-utils.js';

const STOCK_FILTERS = [
  {
    countKey: 'all',
    hint: 'Toutes les références',
    key: 'ALL',
    label: 'Tous les produits',
  },
  {
    countKey: 'positive',
    hint: 'Disponible supérieur à 0',
    key: 'POSITIVE',
    label: 'Disponibles',
  },
  {
    countKey: 'zero',
    hint: 'Disponible égal à 0',
    key: 'ZERO',
    label: 'Indisponibles',
  },
  {
    countKey: 'negative',
    hint: 'Disponible inférieur à 0',
    key: 'NEGATIVE',
    label: 'Stock négatif',
  },
];

const BASE_SORT_OPTIONS = [
  { key: 'designation', label: 'Désignation' },
  { key: 'code', label: 'Code' },
  { key: 'baseUnit', label: 'Unité' },
  { key: 'stockQuantityInBaseUnits', label: 'Entrepôt' },
  { key: 'reservedQuantityInBaseUnits', label: 'Réservé' },
  { key: 'availableQuantityInBaseUnits', label: 'Disponible' },
];

const formatMoney = (amountInCentimes) =>
  `${new Intl.NumberFormat('fr-DZ', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amountInCentimes / 100)} DA`;

const formatStockQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(quantity);

const getBaseUnitLabel = (baseUnit) => (
  BASE_UNIT_LABELS.get(baseUnit) ?? baseUnit
);

const getPriceUnitLabel = (baseUnit) => (
  getBaseUnitLabel(baseUnit).toLocaleLowerCase('fr')
);

const getAvailability = (quantity) => {
  if (quantity < 0) {
    return { label: 'À vérifier', state: 'negative' };
  }

  if (quantity === 0) {
    return { label: 'Indisponible', state: 'zero' };
  }

  return { label: 'Disponible', state: 'positive' };
};

const Availability = ({ product }) => {
  const availability = getAvailability(
    product.availableQuantityInBaseUnits,
  );

  return (
    <span className={styles.availability} data-state={availability.state}>
      <strong>
        {formatStockQuantity(product.availableQuantityInBaseUnits)}
      </strong>
      <span>{availability.label}</span>
    </span>
  );
};

const Price = ({ product }) => (
  Number.isSafeInteger(product.salePriceCentimes) ? (
    <span className={styles.price}>
      <strong>{formatMoney(product.salePriceCentimes)}</strong>
      <span>/ {getPriceUnitLabel(product.baseUnit)}</span>
    </span>
  ) : (
    <span className={styles.missingPrice}>À renseigner</span>
  )
);

const SortableHeader = ({
  className = '',
  label,
  onSort,
  sortDir,
  sorted,
}) => (
  <th
    aria-sort={sorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    className={className}
    scope='col'
  >
    <button onClick={onSort} type='button'>
      {label}
      <span aria-hidden='true'>
        {sorted && sortDir === 'desc' ? '↓' : '↑'}
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
  const [sortKey, setSortKey] = useState('designation');
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
  const stockCounts = useMemo(
    () => getProductStockCounts(products),
    [products],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filtersActive = Boolean(
    normalizedQuery
    || stockStatus !== 'ALL'
    || unit !== 'ALL'
    || onlyMissingPrice,
  );
  const filteredProducts = useMemo(() => filterAndSortProducts({
    onlyMissingPrice,
    products,
    query,
    sortDir,
    sortKey,
    stockStatus,
    unit,
  }), [
    onlyMissingPrice,
    products,
    query,
    sortDir,
    sortKey,
    stockStatus,
    unit,
  ]);
  const {
    activePage,
    firstProductIndex,
    pageProducts,
    totalPages,
  } = paginateProducts(filteredProducts, currentPage);
  const sortOptions = canReadPricing
    ? [
        ...BASE_SORT_OPTIONS,
        { key: 'salePriceCentimes', label: 'Prix' },
      ]
    : BASE_SORT_OPTIONS;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (shouldFocusProductSearch(event)) {
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
    <section aria-labelledby='product-list-title' className={styles.catalogue}>
      <h2 className={styles.srOnly} id='product-list-title'>
        Catalogue des produits
      </h2>

      <div
        aria-label='Filtrer les produits selon leur disponibilité'
        className={styles.counters}
        role='group'
      >
        {STOCK_FILTERS.filter((filter) => (
          filter.key !== 'NEGATIVE' || stockCounts.negative > 0
        )).map((filter) => (
          <button
            aria-pressed={stockStatus === filter.key}
            className={styles.counter}
            data-tone={filter.key}
            key={filter.key}
            onClick={() => {
              setStockStatus(filter.key);
              setCurrentPage(1);
            }}
            type='button'
          >
            <span className={styles.counterLabel}>
              <i aria-hidden='true' />
              {filter.label}
            </span>
            <strong>{stockCounts[filter.countKey]}</strong>
            <span className={styles.counterHint}>{filter.hint}</span>
          </button>
        ))}
      </div>
      <p className={styles.scopeNote}>
        Compteurs sur tout le catalogue · Cliquez pour filtrer la liste.
      </p>

      <div className={styles.panel}>
        <div
          aria-label='Rechercher et filtrer les produits'
          className={styles.toolbar}
          role='search'
        >
          <div className={styles.search}>
            <svg
              aria-hidden='true'
              fill='none'
              height='19'
              stroke='currentColor'
              strokeWidth='1.8'
              viewBox='0 0 24 24'
              width='19'
            >
              <circle cx='10.5' cy='10.5' r='6.5' />
              <path d='m16 16 4.5 4.5' />
            </svg>
            <label className={styles.srOnly} htmlFor='product-search'>
              Rechercher un produit par désignation ou code
            </label>
            <input
              id='product-search'
              maxLength={100}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder='Rechercher un nom ou un code…'
              ref={searchRef}
              type='search'
              value={query}
            />
            <kbd aria-hidden='true'>/</kbd>
          </div>

          {usedUnits.length > 1 && (
            <label className={styles.selectLabel}>
              <span className={styles.srOnly}>Unité de base</span>
              <select
                onChange={(event) => {
                  setUnit(event.target.value);
                  setCurrentPage(1);
                }}
                value={unit}
              >
                <option value='ALL'>Toutes les unités</option>
                {usedUnits.map((baseUnit) => (
                  <option key={baseUnit.code} value={baseUnit.code}>
                    {baseUnit.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {canReadPricing && missingPriceCount > 0 && (
            <label className={styles.priceFilter}>
              <input
                checked={onlyMissingPrice}
                onChange={(event) => {
                  setOnlyMissingPrice(event.target.checked);
                  setCurrentPage(1);
                }}
                type='checkbox'
              />
              Sans prix <span>{missingPriceCount}</span>
            </label>
          )}
        </div>

        <div className={styles.resultBar}>
          <p aria-live='polite' role='status'>
            <strong>
              {filteredProducts.length} produit
              {filteredProducts.length > 1 ? 's' : ''}
            </strong>
            {filtersActive && <span> sur {products.length}</span>}
          </p>
          <div className={styles.resultActions}>
            {filtersActive && (
              <button
                className={styles.textButton}
                onClick={resetFilters}
                type='button'
              >
                Réinitialiser
              </button>
            )}
            <label className={styles.sortControl}>
              <span>Trier par</span>
              <select
                onChange={(event) => {
                  const [nextSortKey, nextSortDir] = event.target.value.split(':');
                  setSortKey(nextSortKey);
                  setSortDir(nextSortDir);
                  setCurrentPage(1);
                }}
                value={`${sortKey}:${sortDir}`}
              >
                {sortOptions.flatMap((option) => (
                  ['asc', 'desc'].map((direction) => (
                    <option
                      key={`${option.key}:${direction}`}
                      value={`${option.key}:${direction}`}
                    >
                      {option.label} {direction === 'asc' ? '↑' : '↓'}
                    </option>
                  ))
                ))}
              </select>
            </label>
          </div>
        </div>

        {filteredProducts.length > 0 ? (
          <>
            <table className={styles.table}>
              <caption className={styles.srOnly}>
                Produits et stocks exprimés dans leur unité de base
              </caption>
              <thead>
                <tr>
                  <SortableHeader
                    className={styles.productColumn}
                    label='Produit'
                    onSort={() => updateSort('designation')}
                    sortDir={sortDir}
                    sorted={sortKey === 'designation'}
                  />
                  <SortableHeader
                    label='Entrepôt'
                    onSort={() => updateSort('stockQuantityInBaseUnits')}
                    sortDir={sortDir}
                    sorted={sortKey === 'stockQuantityInBaseUnits'}
                  />
                  <SortableHeader
                    label='Réservé'
                    onSort={() => updateSort('reservedQuantityInBaseUnits')}
                    sortDir={sortDir}
                    sorted={sortKey === 'reservedQuantityInBaseUnits'}
                  />
                  <SortableHeader
                    className={styles.availableColumn}
                    label='Disponible'
                    onSort={() => updateSort('availableQuantityInBaseUnits')}
                    sortDir={sortDir}
                    sorted={sortKey === 'availableQuantityInBaseUnits'}
                  />
                  {canReadPricing && (
                    <SortableHeader
                      className={styles.priceColumn}
                      label='Prix de vente TTC'
                      onSort={() => updateSort('salePriceCentimes')}
                      sortDir={sortDir}
                      sorted={sortKey === 'salePriceCentimes'}
                    />
                  )}
                  <th className={styles.actionColumn} scope='col'>
                    <span className={styles.srOnly}>Fiche produit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageProducts.map((product) => (
                  <tr key={product.id}>
                    <td className={styles.identityCell}>
                      <Link
                        className={styles.productLink}
                        href={`/produits/${product.id}`}
                      >
                        <span aria-hidden='true' className={styles.productIcon}>
                          <svg
                            fill='none'
                            height='23'
                            stroke='currentColor'
                            strokeLinejoin='round'
                            strokeWidth='1.5'
                            viewBox='0 0 24 24'
                            width='23'
                          >
                            <path d='m12 3 9 5v9l-9 5-9-5V8l9-5Z M3 8l9 5 9-5 M12 13v9 M7.5 5.5l9 5v4' />
                          </svg>
                        </span>
                        <span className={styles.productIdentity}>
                          <strong>{product.designation}</strong>
                          <span>
                            <code>{product.code}</code>
                            <i aria-hidden='true'>·</i>
                            {getBaseUnitLabel(product.baseUnit)}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td
                      className={styles.quantityCell}
                      data-label='Entrepôt'
                    >
                      <span>
                        {formatStockQuantity(product.stockQuantityInBaseUnits)}
                      </span>
                    </td>
                    <td
                      className={`${styles.quantityCell} ${styles.reservedCell}`}
                      data-label='Réservé'
                    >
                      <span data-muted={product.reservedQuantityInBaseUnits === 0}>
                        {formatStockQuantity(product.reservedQuantityInBaseUnits)}
                      </span>
                    </td>
                    <td
                      className={styles.availableCell}
                      data-label='Disponible'
                    >
                      <Availability product={product} />
                    </td>
                    {canReadPricing && (
                      <td className={styles.priceCell} data-label='Prix de vente TTC'>
                        <Price product={product} />
                      </td>
                    )}
                    <td className={styles.actionCell}>
                      <Link
                        aria-label={`Voir la fiche de ${product.designation}`}
                        className={styles.detailsLink}
                        href={`/produits/${product.id}`}
                      >
                        <span>Fiche</span>
                        <span aria-hidden='true'>↗</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={styles.footer}>
              <p>
                {firstProductIndex + 1}–{firstProductIndex + pageProducts.length}
                {' '}sur {filteredProducts.length} produits
              </p>
              {totalPages > 1 ? (
                <nav aria-label='Pagination des produits'>
                  <button
                    disabled={activePage === 1}
                    onClick={() => setCurrentPage(activePage - 1)}
                    type='button'
                  >
                    Précédent
                  </button>
                  <span aria-live='polite'>
                    Page {activePage} / {totalPages}
                  </span>
                  <button
                    disabled={activePage === totalPages}
                    onClick={() => setCurrentPage(activePage + 1)}
                    type='button'
                  >
                    Suivant
                  </button>
                </nav>
              ) : (
                <span>Tout est affiché</span>
              )}
            </div>
          </>
        ) : (
          <div className={styles.empty}>
            <div aria-hidden='true' className={styles.emptyIcon}>⌕</div>
            <h3>
              {filtersActive
                ? 'Aucun produit ne correspond'
                : 'Votre catalogue commence ici'}
            </h3>
            <p>
              {filtersActive
                ? 'Essayez un autre nom, un code ou ajustez les filtres.'
                : 'Retrouvez ici vos produits, leurs stocks et leurs unités.'}
            </p>
            {filtersActive ? (
              <button
                className={styles.secondaryButton}
                onClick={resetFilters}
                type='button'
              >
                Voir tous les produits
              </button>
            ) : canCreateProduct ? (
              <Link className={styles.primaryButton} href='/produits/nouveau'>
                Créer un produit
              </Link>
            ) : null}
          </div>
        )}
      </div>

      <details className={styles.help}>
        <summary>Comment lire les stocks ?</summary>
        <p>
          Disponible = stock en entrepôt − quantités réservées. Toutes les
          quantités sont exprimées dans l’unité de base du produit. Un
          disponible nul peut correspondre à un stock entièrement réservé.
          Un disponible négatif est à vérifier.
        </p>
      </details>
    </section>
  );
};

export default ProductTable;
