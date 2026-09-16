import { calculateReceptionLine, summarizeReceptionAmounts } from './receptions.js';

// Browser summaries only. Definitive validation and snapshots belong to the service.
export const validateReceptionDocument = (document, suppliers) => {
  const errors = {};
  if (!suppliers.some(({ id, active }) => id === document.supplierId && active)) {
    errors.supplierId = 'Sélectionnez un fournisseur actif.';
  }
  const date = new Date(`${document.receptionDate}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(document.receptionDate)
    || Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== document.receptionDate) {
    errors.receptionDate = 'Saisissez une date de réception valide.';
  }
  if (!document.supplierReference.trim()) {
    errors.supplierReference = 'La référence fournisseur est obligatoire.';
  } else if (Array.from(document.supplierReference.trim()).length > 100) {
    errors.supplierReference = 'La référence ne doit pas dépasser 100 caractères.';
  }
  return errors;
};

export const summarizeReceptionDraft = (lines, products) => {
  const quantities = new Map();
  let quantitiesComplete = true;
  const calculations = lines.map((line) => {
    const product = products.find(({ id }) => id === line.productId);
    const calculation = calculateReceptionLine(line, product);
    const quantity = calculation.quantityInBaseUnits;
    if (!product || !Number.isSafeInteger(quantity) || quantity <= 0) {
      quantitiesComplete = false;
    } else {
      const previous = quantities.get(product.baseUnit);
      const sum = previous === null ? null : (previous ?? 0) + quantity;
      if (!Number.isSafeInteger(sum)) quantitiesComplete = false;
      quantities.set(product.baseUnit, Number.isSafeInteger(sum) ? sum : null);
    }
    return calculation;
  });
  const amounts = summarizeReceptionAmounts(calculations);
  const amountComplete = amounts.complete
    && Number.isSafeInteger(amounts.knownSubtotalInCentimes);
  return {
    amountInCentimes: amountComplete ? amounts.knownSubtotalInCentimes : null,
    complete: amountComplete && quantitiesComplete,
    quantities: [...quantities].map(([unit, quantity]) => ({ unit, quantity })),
  };
};
