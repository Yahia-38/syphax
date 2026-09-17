import { getSalePackagings } from './product-packaging.js';

const formatCount = (count) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(count);

// French plural on the leading noun only: « pack de 6 » → « packs de 6 ».
const pluralizeLabel = (label, count) => {
  if (Math.abs(count) < 2) return label;
  const [noun, ...rest] = label.split(' ');
  const pluralNoun = /[sxz]$/u.test(noun) ? noun : /(?:au|eu)$/u.test(noun) ? `${noun}x` : `${noun}s`;
  return [pluralNoun, ...rest].join(' ');
};

const lower = (label) => String(label ?? '').toLocaleLowerCase('fr');

// The product's default sale packaging, or null when it sells by the base unit.
export const getProductDisplayUnit = ({ defaultSaleUnit, packagings } = {}) => {
  if (!defaultSaleUnit) return null;
  const packaging = getSalePackagings(packagings).find(({ id }) => id === defaultSaleUnit);

  return packaging && Number.isSafeInteger(packaging.quantity) && packaging.quantity > 0
    ? { id: packaging.id, label: packaging.label, quantity: packaging.quantity }
    : null;
};

// Singular unit label used after a price, e.g. « / pack de 6 » or « / bouteille ».
export const getDisplayUnitLabel = ({ baseUnitLabel, displayUnit }) => lower(displayUnit ? displayUnit.label : baseUnitLabel);

// Splits a base-unit quantity into whole default units plus the base-unit remainder.
export const getQuantityInDisplayUnit = (quantityInBaseUnits, { baseUnitLabel, displayUnit }) => {
  const negative = quantityInBaseUnits < 0;
  const absolute = Math.abs(quantityInBaseUnits);
  const baseLabel = lower(baseUnitLabel);

  if (!displayUnit) {
    return { negative, parts: [{ count: absolute, label: pluralizeLabel(baseLabel, absolute) }] };
  }

  const packs = Math.floor(absolute / displayUnit.quantity);
  const remainder = absolute % displayUnit.quantity;
  const packLabel = lower(displayUnit.label);

  return {
    negative,
    parts: [
      ...(packs > 0 || remainder === 0 ? [{ count: packs, label: pluralizeLabel(packLabel, packs) }] : []),
      ...(remainder > 0 ? [{ count: remainder, label: pluralizeLabel(baseLabel, remainder) }] : []),
    ],
  };
};

export const getDisplayQuantitySeparator = (negative) => (negative ? ' − ' : ' + ');

export const formatQuantityInDisplayUnit = (quantityInBaseUnits, options) => {
  const { negative, parts } = getQuantityInDisplayUnit(quantityInBaseUnits, options);
  const text = parts.map(({ count, label }) => `${formatCount(count)} ${label}`)
    .join(getDisplayQuantitySeparator(negative));

  return negative ? `−${text}` : text;
};

// The sale price matching the display unit: the pack price, or the unit price for the base unit.
export const getDisplayUnitSalePrice = ({ displayUnit, packagings, salePrice }) => {
  const source = displayUnit
    ? (Array.isArray(packagings) ? packagings : []).find(({ id }) => id === displayUnit.id)?.salePrice
    : salePrice;

  return Number.isSafeInteger(source?.amountInCentimes) ? source.amountInCentimes : null;
};
