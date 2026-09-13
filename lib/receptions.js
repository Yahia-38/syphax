export const RECEPTION_FORM_PERMISSIONS = Object.freeze([
  'receptions.read',
  'receptions.create',
  'suppliers.read',
  'products.read',
  'packaging.read',
]);

export const getMissingReceptionFormPermissions = (permissions) => {
  const permissionSet = new Set(Array.isArray(permissions) ? permissions : []);

  return RECEPTION_FORM_PERMISSIONS.filter(
    (permission) => !permissionSet.has(permission),
  );
};

export const createEmptyReceptionLine = (id) => ({
  id,
  directQuantity: '',
  packagingCount: '',
  packagingId: '',
  productId: '',
  productQuery: '',
  quantityMode: 'DIRECT',
});

export const changeReceptionLineProduct = (line, productId) => ({
  ...createEmptyReceptionLine(line.id),
  productId,
});

const parsePositiveInteger = (value) => {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!/^\d+$/u.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : null;
};

export const calculateReceptionLine = (line, product) => {
  let quantityInBaseUnits = null;

  if (product && line.quantityMode === 'DIRECT') {
    quantityInBaseUnits = parsePositiveInteger(line.directQuantity);
  }

  if (product && line.quantityMode === 'PACKAGING') {
    const packaging = product.packagings.find(
      ({ id }) => id === line.packagingId,
    );
    const packagingCount = parsePositiveInteger(line.packagingCount);

    if (packaging && packagingCount !== null) {
      const calculatedQuantity = packaging.quantity * packagingCount;

      quantityInBaseUnits = Number.isSafeInteger(calculatedQuantity)
        ? calculatedQuantity
        : null;
    }
  }

  return { quantityInBaseUnits };
};

export const validateReceptionLine = (line, product) => {
  const errors = {};
  const calculation = calculateReceptionLine(line, product);

  if (!product) {
    errors.product = 'Sélectionnez un produit du catalogue.';
  } else if (line.quantityMode === 'PACKAGING') {
    const packagingExists = product.packagings.some(
      ({ id }) => id === line.packagingId,
    );

    if (!packagingExists) {
      errors.packaging = 'Sélectionnez un conditionnement du produit.';
    }

    if (!/^\d+$/u.test(line.packagingCount.trim())) {
      errors.packagingCount = 'Saisissez un nombre entier positif.';
    } else if (calculation.quantityInBaseUnits === null) {
      errors.packagingCount = 'Saisissez un nombre entier positif valide.';
    }
  } else if (calculation.quantityInBaseUnits === null) {
    errors.directQuantity = 'Saisissez une quantité entière positive.';
  }

  return Object.keys(errors).length > 0
    ? { errors }
    : { data: { quantityInBaseUnits: calculation.quantityInBaseUnits } };
};

export const validateReceptionDraft = ({ hasLineDraft, lineCount }) => {
  if (hasLineDraft) {
    return {
      error: 'Validez ou annulez la ligne en cours avant de valider la réception.',
    };
  }

  if (!Number.isSafeInteger(lineCount) || lineCount < 1) {
    return {
      error: 'Ajoutez et validez au moins une ligne de réception.',
    };
  }

  return { valid: true };
};
