export const isKnownReceptionAmount = (amount) => Number.isSafeInteger(amount) && amount >= 0;

const isKnownQuantity = (quantity) => Number.isSafeInteger(quantity) && quantity >= 0;

export const getReceptionUnitLabel = (baseUnit, unitLabels, quantity = 1) => {
  const label = unitLabels.get(baseUnit);
  if (label) return `${label.toLocaleLowerCase('fr')}${quantity > 1 ? 's' : ''}`;
  return baseUnit?.trim() ? `unité inconnue (${baseUnit})` : 'unité non renseignée';
};

export const formatReceptionQuantity = (quantity, baseUnit, unitLabels) => isKnownQuantity(quantity)
  ? `${new Intl.NumberFormat('fr-DZ').format(quantity)} ${getReceptionUnitLabel(baseUnit, unitLabels, quantity)}`
  : 'Quantité non renseignée';

export const getReceptionEntryDetail = (line, unitLabels) => {
  const quantity = (value) => formatReceptionQuantity(value, line.baseUnit, unitLabels);
  if (line.quantityMode === 'DIRECT') {
    return isKnownQuantity(line.directQuantity)
      ? `${quantity(line.directQuantity)} saisies directement.`
      : 'Quantité non renseignée';
  }
  if (line.quantityMode === 'PACKAGING') {
    const { packaging } = line;
    if (!packaging || !isKnownQuantity(packaging.count) || !isKnownQuantity(packaging.quantity)) {
      return 'Détail du conditionnement non renseigné';
    }
    const converted = packaging.count * packaging.quantity;
    return `${packaging.count} × ${packaging.label} (${quantity(packaging.quantity)}) = ${Number.isSafeInteger(converted) ? quantity(converted) : 'Conversion non calculable'}.`;
  }
  return 'Mode de saisie non renseigné';
};

export const hasReceptionQuantityMismatch = (line) => {
  if (!isKnownQuantity(line.quantityInBaseUnits)) return false;
  if (line.quantityMode === 'DIRECT') {
    return isKnownQuantity(line.directQuantity) && line.directQuantity !== line.quantityInBaseUnits;
  }
  const { packaging } = line;
  return line.quantityMode === 'PACKAGING'
    && isKnownQuantity(packaging?.count)
    && isKnownQuantity(packaging?.quantity)
    && packaging.count * packaging.quantity !== line.quantityInBaseUnits;
};

export const summarizeReceptionQuantities = (lines) => {
  const totals = new Map();
  let incompleteLineCount = 0;
  for (const line of lines) {
    if (!isKnownQuantity(line.quantityInBaseUnits) || !line.baseUnit?.trim()) {
      incompleteLineCount += 1;
      continue;
    }
    const previous = totals.has(line.baseUnit) ? totals.get(line.baseUnit) : 0;
    const total = previous === null ? null : previous + line.quantityInBaseUnits;
    totals.set(line.baseUnit, Number.isSafeInteger(total) ? total : null);
  }
  return { totals: [...totals].map(([baseUnit, quantity]) => ({ baseUnit, quantity })), incompleteLineCount };
};
