export const PRODUCTS_PER_PAGE = 10;

export const BASE_UNITS = [
  { code: 'PIECE', label: 'Pièce' },
  { code: 'BOUTEILLE', label: 'Bouteille' },
  { code: 'BOITE', label: 'Boîte' },
  { code: 'SACHET', label: 'Sachet' },
];

export const BASE_UNIT_LABELS = new Map(
  BASE_UNITS.map((baseUnit) => [baseUnit.code, baseUnit.label]),
);

const NUMERIC_SORT_KEYS = new Set([
  'stockQuantityInBaseUnits',
  'reservedQuantityInBaseUnits',
  'availableQuantityInBaseUnits',
]);
const PRODUCT_SEARCH_FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

const compareText = (firstValue, secondValue) => String(firstValue).localeCompare(
  String(secondValue),
  'fr',
  { numeric: true, sensitivity: 'base' },
);

// Prices are compared per base unit so a pack price and a unit price stay comparable.
const getPricePerBaseUnit = (product) => (
  product.salePriceCentimes / (product.displayUnit?.quantity ?? 1)
);

const compareProducts = (firstProduct, secondProduct, sortKey, sortDir) => {
  const direction = sortDir === 'desc' ? -1 : 1;

  if (sortKey === 'salePriceCentimes') {
    const firstPriceMissing = !Number.isSafeInteger(
      firstProduct.salePriceCentimes,
    );
    const secondPriceMissing = !Number.isSafeInteger(
      secondProduct.salePriceCentimes,
    );

    if (firstPriceMissing || secondPriceMissing) {
      if (firstPriceMissing && secondPriceMissing) {
        return compareText(firstProduct.designation, secondProduct.designation);
      }

      return firstPriceMissing ? 1 : -1;
    }

    const priceComparison = (
      getPricePerBaseUnit(firstProduct) - getPricePerBaseUnit(secondProduct)
    ) * direction;

    return priceComparison || compareText(
      firstProduct.designation,
      secondProduct.designation,
    );
  }

  if (NUMERIC_SORT_KEYS.has(sortKey)) {
    const quantityComparison = (
      firstProduct[sortKey] - secondProduct[sortKey]
    ) * direction;

    return quantityComparison || compareText(
      firstProduct.designation,
      secondProduct.designation,
    );
  }

  const firstValue = sortKey === 'baseUnit'
    ? BASE_UNIT_LABELS.get(firstProduct.baseUnit) ?? firstProduct.baseUnit
    : firstProduct[sortKey];
  const secondValue = sortKey === 'baseUnit'
    ? BASE_UNIT_LABELS.get(secondProduct.baseUnit) ?? secondProduct.baseUnit
    : secondProduct[sortKey];
  const textComparison = compareText(firstValue, secondValue) * direction;

  return textComparison || compareText(
    firstProduct.code,
    secondProduct.code,
  );
};

export const getProductStockCounts = (products) => ({
  all: products.length,
  negative: products.filter(
    (product) => product.availableQuantityInBaseUnits < 0,
  ).length,
  positive: products.filter(
    (product) => product.availableQuantityInBaseUnits > 0,
  ).length,
  zero: products.filter(
    (product) => product.availableQuantityInBaseUnits === 0,
  ).length,
});

export const shouldFocusProductSearch = (event) => {
  const target = event.target;
  const targetIsField = Boolean(
    target?.isContentEditable || PRODUCT_SEARCH_FIELD_TAGS.has(target?.tagName),
  );

  return event.key === '/'
    && !event.defaultPrevented
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !targetIsField;
};

export const filterAndSortProducts = ({
  onlyMissingPrice,
  products,
  query,
  sortDir,
  sortKey,
  stockStatus,
  unit,
}) => {
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
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

  return matchingProducts.sort((firstProduct, secondProduct) => (
    compareProducts(firstProduct, secondProduct, sortKey, sortDir)
  ));
};

export const paginateProducts = (products, requestedPage) => {
  const totalPages = Math.max(
    1,
    Math.ceil(products.length / PRODUCTS_PER_PAGE),
  );
  const activePage = Math.min(Math.max(requestedPage, 1), totalPages);
  const firstProductIndex = (activePage - 1) * PRODUCTS_PER_PAGE;

  return {
    activePage,
    firstProductIndex,
    pageProducts: products.slice(
      firstProductIndex,
      firstProductIndex + PRODUCTS_PER_PAGE,
    ),
    totalPages,
  };
};
