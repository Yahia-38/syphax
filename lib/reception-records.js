import { ObjectId } from 'mongodb';

import { getDatabase } from './mongodb.js';
import { validateReceptionLine } from './receptions.js';

const MAX_RECEPTION_LINES = 100;

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const parseReceptionDate = (value) => {
  const normalizedValue = normalizeText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalizedValue);

  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
};

const normalizeLine = (line) => ({
  directQuantity: normalizeText(line?.directQuantity),
  packagingCount: normalizeText(line?.packagingCount),
  packagingId: normalizeText(line?.packagingId),
  productId: normalizeText(line?.productId),
  quantityMode: normalizeText(line?.quantityMode),
});

export const createReception = async ({
  createdBy,
  lines,
  receptionDate,
  supplierId,
  supplierReference,
}) => {
  const errors = {};
  const normalizedReference = normalizeText(supplierReference);
  const parsedReceptionDate = parseReceptionDate(receptionDate);
  const normalizedLines = Array.isArray(lines) ? lines.map(normalizeLine) : [];

  if (typeof supplierId !== 'string' || !ObjectId.isValid(supplierId)) {
    errors.supplierId = 'Sélectionnez un fournisseur actif.';
  }

  if (!parsedReceptionDate) {
    errors.receptionDate = 'Saisissez une date de réception valide.';
  }

  if (!normalizedReference) {
    errors.supplierReference = 'La référence fournisseur est obligatoire.';
  } else if (Array.from(normalizedReference).length > 100) {
    errors.supplierReference = 'La référence ne doit pas dépasser 100 caractères.';
  }

  if (normalizedLines.length === 0) {
    errors.lines = 'Ajoutez et validez au moins une ligne de réception.';
  } else if (normalizedLines.length > MAX_RECEPTION_LINES) {
    errors.lines = `Une réception ne peut pas dépasser ${MAX_RECEPTION_LINES} lignes.`;
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const invalidProductId = normalizedLines.some(
    (line) => !ObjectId.isValid(line.productId),
  );

  if (invalidProductId) {
    return { errors: { lines: 'Une ligne contient un produit invalide.' } };
  }

  const database = await getDatabase();
  const supplierObjectId = new ObjectId(supplierId);
  const productObjectIds = [...new Set(
    normalizedLines.map((line) => line.productId),
  )].map((productId) => new ObjectId(productId));
  const [supplier, productDocuments] = await Promise.all([
    database.collection('suppliers').findOne(
      { _id: supplierObjectId, active: { $ne: false } },
      { projection: { name: 1 } },
    ),
    database.collection('products').find(
      { _id: { $in: productObjectIds } },
      {
        projection: {
          baseUnit: 1,
          code: 1,
          designation: 1,
          packagings: 1,
        },
      },
    ).toArray(),
  ]);

  if (!supplier) {
    return { errors: { supplierId: 'Ce fournisseur n’est plus actif.' } };
  }

  const products = new Map(productDocuments.map((product) => [
    product._id.toString(),
    {
      ...product,
      id: product._id.toString(),
      packagings: Array.isArray(product.packagings)
        ? product.packagings.map((packaging) => ({
            ...packaging,
            id: packaging._id.toString(),
          }))
        : [],
    },
  ]));
  const storedLines = [];

  for (const [index, line] of normalizedLines.entries()) {
    const product = products.get(line.productId) ?? null;

    if (!['DIRECT', 'PACKAGING'].includes(line.quantityMode)) {
      return {
        errors: {
          lines: `La ligne ${index + 1} contient un mode de quantité invalide.`,
        },
      };
    }

    const validation = validateReceptionLine(line, product);

    if (validation.errors) {
      return {
        errors: {
          lines: `La ligne ${index + 1} est invalide. Vérifiez son produit et sa quantité.`,
        },
      };
    }

    const packaging = line.quantityMode === 'PACKAGING'
      ? product.packagings.find(({ id }) => id === line.packagingId)
      : null;

    storedLines.push({
      _id: new ObjectId(),
      productId: product._id,
      productCode: product.code,
      productDesignation: product.designation,
      baseUnit: product.baseUnit,
      quantityMode: line.quantityMode,
      quantityInBaseUnits: validation.data.quantityInBaseUnits,
      ...(packaging
        ? {
            packaging: {
              packagingId: packaging._id,
              label: packaging.label,
              quantity: packaging.quantity,
              count: Number(line.packagingCount),
            },
          }
        : {}),
    });
  }

  const createdAt = new Date();
  const reception = {
    supplierId: supplierObjectId,
    supplierName: supplier.name,
    receptionDate: parsedReceptionDate,
    supplierReference: normalizedReference,
    lines: storedLines,
    createdAt,
    createdBy: new ObjectId(createdBy),
  };
  const result = await database.collection('receptions').insertOne(reception);

  return {
    reception: {
      id: result.insertedId.toString(),
      supplierReference: normalizedReference,
    },
  };
};

const formatStoredDate = (value) => value instanceof Date
  && !Number.isNaN(value.getTime())
  ? value.toISOString().slice(0, 10)
  : '';

export const listReceptions = async () => {
  const database = await getDatabase();
  const documents = await database.collection('receptions')
    .find({})
    .sort({ receptionDate: -1, createdAt: -1, _id: -1 })
    .toArray();
  const supplierIds = documents
    .filter((reception) => !reception.supplierName && reception.supplierId)
    .map((reception) => reception.supplierId);
  const productIds = documents.flatMap((reception) =>
    Array.isArray(reception.lines)
      ? reception.lines
        .filter((line) => !line.productCode && line.productId)
        .map((line) => line.productId)
      : []);
  const [suppliers, products] = await Promise.all([
    supplierIds.length > 0
      ? database.collection('suppliers').find(
          { _id: { $in: supplierIds } },
          { projection: { name: 1 } },
        ).toArray()
      : [],
    productIds.length > 0
      ? database.collection('products').find(
          { _id: { $in: productIds } },
          { projection: { code: 1, designation: 1 } },
        ).toArray()
      : [],
  ]);
  const supplierNames = new Map(
    suppliers.map((supplier) => [supplier._id.toString(), supplier.name]),
  );
  const productDetails = new Map(products.map((product) => [
    product._id.toString(),
    { code: product.code, designation: product.designation },
  ]));

  return documents.map((reception) => {
    const lines = Array.isArray(reception.lines) ? reception.lines : [];

    return {
      id: reception._id.toString(),
      supplierId: reception.supplierId?.toString?.() ?? '',
      supplierName: reception.supplierName
        ?? supplierNames.get(reception.supplierId?.toString())
        ?? 'Fournisseur inconnu',
      receptionDate: formatStoredDate(reception.receptionDate),
      supplierReference: reception.supplierReference ?? 'Sans référence',
      createdAt: reception.createdAt?.toISOString?.() ?? null,
      lines: lines.map((line) => {
        const currentProduct = productDetails.get(line.productId?.toString());

        return {
          productCode: line.productCode ?? currentProduct?.code ?? 'Produit inconnu',
          productDesignation: line.productDesignation
            ?? currentProduct?.designation
            ?? '',
          quantityInBaseUnits: Number.isSafeInteger(line.quantityInBaseUnits)
            ? line.quantityInBaseUnits
            : null,
          baseUnit: line.baseUnit ?? null,
        };
      }),
    };
  });
};
