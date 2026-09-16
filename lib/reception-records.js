import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import {
  calculateReceptionUnitCostInCentimes,
  validateReceptionLine,
} from './receptions.js';
import {
  ensureStockMovementIndexes,
  RECEPTION_INPUT_KIND,
} from './stock-movements.js';

const MAX_RECEPTION_LINES = 100;
const SUBMISSION_KEY_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

class ReceptionTransactionValidationError extends Error {
  constructor(errors) {
    super('La réception est invalide.');
    this.name = 'ReceptionTransactionValidationError';
    this.errors = errors;
  }
}

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
  amount: normalizeText(line?.amount),
  baseUnit: normalizeText(line?.baseUnit),
  directQuantity: normalizeText(line?.directQuantity),
  packagingCount: normalizeText(line?.packagingCount),
  packagingId: normalizeText(line?.packagingId),
  productId: normalizeText(line?.productId),
  quantityMode: normalizeText(line?.quantityMode),
});

const createSubmissionDigest = ({
  createdBy,
  lines,
  receptionDate,
  supplierId,
  supplierReference,
}) => createHash('sha256').update(JSON.stringify({
  createdBy,
  supplierId,
  receptionDate,
  supplierReference,
  lines: lines.map((line) => ({
    amount: line.amount,
    baseUnit: line.baseUnit,
    productId: line.productId,
    quantityMode: line.quantityMode,
    ...(line.quantityMode === 'PACKAGING'
      ? {
          packagingCount: line.packagingCount,
          packagingId: line.packagingId,
        }
      : { directQuantity: line.directQuantity }),
  })),
})).digest('hex');

const ensureReceptionStockIndexes = async (database) => {
  await Promise.all([
    database.collection('receptions').createIndex(
      { submissionKey: 1 },
      {
        name: 'unique_reception_submission_key',
        partialFilterExpression: { submissionKey: { $type: 'string' } },
        unique: true,
      },
    ),
    database.collection('receptions').createIndex(
      { 'lines.productId': 1 },
      { name: 'reception_product_reference' },
    ),
    database.collection('receptions').createIndex(
      {
        'lines.productId': 1,
        receptionDate: -1,
        createdAt: -1,
        _id: -1,
      },
      { name: 'reception_product_cost_recency' },
    ),
    ensureStockMovementIndexes(database),
  ]);
};

const readExistingSubmission = async ({
  database,
  submissionDigest,
  submissionKey,
}) => {
  const existingReception = await database.collection('receptions').findOne(
    { submissionKey },
    { projection: { submissionDigest: 1, supplierReference: 1 } },
  );

  if (!existingReception) {
    return null;
  }

  if (existingReception.submissionDigest !== submissionDigest) {
    return {
      errors: {
        form: 'Cette demande a déjà été utilisée avec un contenu différent.',
      },
    };
  }

  return {
    reception: {
      id: existingReception._id.toString(),
      supplierReference: existingReception.supplierReference,
    },
    replayed: true,
  };
};

export const createReception = async ({
  createdBy,
  lines,
  receptionDate,
  submissionKey,
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

  if (
    typeof submissionKey !== 'string'
    || !SUBMISSION_KEY_PATTERN.test(submissionKey)
  ) {
    errors.form = 'La clé de soumission est invalide. Rechargez le formulaire.';
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

  const client = await getMongoClient();
  const database = client.db();
  const supplierObjectId = new ObjectId(supplierId);
  const authorObjectId = new ObjectId(createdBy);
  const productObjectIds = [...new Set(
    normalizedLines.map((line) => line.productId),
  )].map((productId) => new ObjectId(productId));
  const normalizedSubmissionKey = submissionKey.toLocaleLowerCase('en');
  const submissionDigest = createSubmissionDigest({
    createdBy,
    lines: normalizedLines,
    receptionDate: parsedReceptionDate.toISOString(),
    supplierId: supplierObjectId.toString(),
    supplierReference: normalizedReference,
  });
  const receptionId = new ObjectId();
  const lineIds = normalizedLines.map(() => new ObjectId());
  const movementIds = normalizedLines.map(() => new ObjectId());
  const createdAt = new Date();

  await ensureReceptionStockIndexes(database);

  const existingSubmission = await readExistingSubmission({
    database,
    submissionDigest,
    submissionKey: normalizedSubmissionKey,
  });

  if (existingSubmission) {
    return existingSubmission;
  }

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      const supplier = await database.collection('suppliers').findOneAndUpdate(
        { _id: supplierObjectId, active: { $ne: false } },
        { $inc: { receptionReferenceVersion: 1 } },
        {
          projection: { name: 1 },
          returnDocument: 'after',
          session,
        },
      );

      if (!supplier) {
        throw new ReceptionTransactionValidationError({
          supplierId: 'Ce fournisseur n’est plus actif.',
        });
      }

      const productLock = await database.collection('products').updateMany(
        { _id: { $in: productObjectIds } },
        { $inc: { stockReferenceVersion: 1 } },
        { session },
      );

      if (productLock.matchedCount !== productObjectIds.length) {
        throw new ReceptionTransactionValidationError({
          lines: 'Une ligne référence un produit qui n’existe plus.',
        });
      }

      const productDocuments = await database.collection('products').find(
        { _id: { $in: productObjectIds } },
        {
          projection: {
            baseUnit: 1,
            code: 1,
            designation: 1,
            packagings: 1,
          },
          session,
        },
      ).toArray();
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
          throw new ReceptionTransactionValidationError({
            lines: `La ligne ${index + 1} contient un mode de quantité invalide.`,
          });
        }

        if (!product || product.baseUnit !== line.baseUnit) {
          throw new ReceptionTransactionValidationError({
            lines: `L’unité de base du produit de la ligne ${index + 1} a changé. Rechargez le formulaire.`,
          });
        }

        const validation = validateReceptionLine(line, product);

        if (validation.errors) {
          throw new ReceptionTransactionValidationError({
            lines: validation.errors.packaging
              ? `La ligne ${index + 1} : ${validation.errors.packaging}`
              : `La ligne ${index + 1} est invalide. Vérifiez son produit, sa quantité et son montant TTC.`,
          });
        }

        const packaging = line.quantityMode === 'PACKAGING'
          ? product.packagings.find(({ id }) => id === line.packagingId)
          : null;

        storedLines.push({
          _id: lineIds[index],
          amountInCentimes: validation.data.amountInCentimes,
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

      const reception = {
        _id: receptionId,
        submissionKey: normalizedSubmissionKey,
        submissionDigest,
        supplierId: supplierObjectId,
        supplierName: supplier.name,
        receptionDate: parsedReceptionDate,
        supplierReference: normalizedReference,
        lines: storedLines,
        createdAt,
        createdBy: authorObjectId,
      };
      const movements = storedLines.map((line, index) => ({
        _id: movementIds[index],
        kind: RECEPTION_INPUT_KIND,
        productId: line.productId,
        baseUnit: line.baseUnit,
        quantityDeltaInBaseUnits: line.quantityInBaseUnits,
        occurredOn: parsedReceptionDate,
        recordedAt: createdAt,
        recordedBy: authorObjectId,
        sourceReceptionId: receptionId,
        sourceReceptionLineId: line._id,
      }));

      await database.collection('receptions').insertOne(reception, { session });
      await database.collection('stockMovements').insertMany(movements, {
        session,
      });

      return {
        reception: {
          id: receptionId.toString(),
          supplierReference: normalizedReference,
        },
        replayed: false,
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof ReceptionTransactionValidationError) {
      return { errors: error.errors };
    }

    if (
      error?.code === 11000
      && (
        error?.keyPattern?.submissionKey
        || error?.message?.includes('unique_reception_submission_key')
      )
    ) {
      const concurrentSubmission = await readExistingSubmission({
        database,
        submissionDigest,
        submissionKey: normalizedSubmissionKey,
      });

      if (concurrentSubmission) {
        return concurrentSubmission;
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const formatStoredDate = (value) => value instanceof Date
  && !Number.isNaN(value.getTime())
  ? value.toISOString().slice(0, 10)
  : '';

const readStoredAmount = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;

export const getLatestProductPurchaseCost = async ({
  baseUnit,
  productId,
  userId,
}) => {
  await requireUserPermission(userId, 'receptions.read');

  if (
    typeof productId !== 'string'
    || !ObjectId.isValid(productId)
    || typeof baseUnit !== 'string'
    || !baseUnit
  ) {
    return null;
  }

  const database = await getDatabase();
  const productObjectId = new ObjectId(productId);
  const receptions = database.collection('receptions').find(
    { 'lines.productId': productObjectId },
    {
      projection: {
        createdAt: 1,
        lines: 1,
        receptionDate: 1,
        supplierName: 1,
        supplierReference: 1,
      },
    },
  ).sort({ receptionDate: -1, createdAt: -1, _id: -1 });

  for await (const reception of receptions) {
    if (
      !(reception.receptionDate instanceof Date)
      || Number.isNaN(reception.receptionDate.getTime())
    ) {
      continue;
    }

    const lines = Array.isArray(reception.lines) ? reception.lines : [];

    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      const line = lines[lineIndex];

      if (
        !(line?.productId instanceof ObjectId)
        || !line.productId.equals(productObjectId)
        || line.baseUnit !== baseUnit
      ) {
        continue;
      }

      const unitCostInCentimes = calculateReceptionUnitCostInCentimes(line);

      if (unitCostInCentimes === null) {
        continue;
      }

      return {
        amountInCentimes: line.amountInCentimes,
        baseUnit: line.baseUnit,
        quantityInBaseUnits: line.quantityInBaseUnits,
        unitCostInCentimes,
        source: {
          lineId: line._id?.toString?.() ?? null,
          lineNumber: lineIndex + 1,
          receptionDate: formatStoredDate(reception.receptionDate),
          receptionId: reception._id.toString(),
          supplierName: reception.supplierName ?? 'Fournisseur inconnu',
          supplierReference: reception.supplierReference ?? 'Sans référence',
        },
      };
    }
  }

  return null;
};

export const getReceptionById = async (id, { userId } = {}) => {
  await requireUserPermission(userId, 'receptions.read');

  if (typeof id !== 'string' || !ObjectId.isValid(id)) {
    return null;
  }

  const database = await getDatabase();
  const reception = await database.collection('receptions').findOne({
    _id: new ObjectId(id),
  });

  if (!reception) {
    return null;
  }

  const author = reception.createdBy
    ? await database.collection('users').findOne(
        { _id: reception.createdBy },
        { projection: { username: 1 } },
      )
    : null;
  const lines = Array.isArray(reception.lines) ? reception.lines : [];

  return {
    id: reception._id.toString(),
    supplierId: reception.supplierId?.toString?.() ?? '',
    supplierName: reception.supplierName ?? 'Fournisseur inconnu',
    receptionDate: formatStoredDate(reception.receptionDate),
    supplierReference: reception.supplierReference ?? 'Sans référence',
    createdAt: reception.createdAt?.toISOString?.() ?? null,
    createdBy: author?.username ?? null,
    totalAmountInCentimes: readStoredAmount(reception.totalAmountInCentimes),
    lines: lines.map((line) => ({
      id: line._id?.toString?.() ?? '',
      productId: line.productId?.toString?.() ?? '',
      productCode: line.productCode ?? 'Produit inconnu',
      productDesignation: line.productDesignation ?? '',
      baseUnit: line.baseUnit ?? null,
      quantityMode: line.quantityMode ?? null,
      quantityInBaseUnits: Number.isSafeInteger(line.quantityInBaseUnits)
        ? line.quantityInBaseUnits
        : null,
      directQuantity: Number.isSafeInteger(line.directQuantity)
        ? line.directQuantity
        : line.quantityMode === 'DIRECT'
          && Number.isSafeInteger(line.quantityInBaseUnits)
          ? line.quantityInBaseUnits
          : null,
      amountInCentimes: readStoredAmount(line.amountInCentimes),
      packaging: line.packaging
        ? {
            packagingId: line.packaging.packagingId?.toString?.() ?? '',
            label: line.packaging.label ?? 'Conditionnement inconnu',
            quantity: Number.isSafeInteger(line.packaging.quantity)
              ? line.packaging.quantity
              : null,
            count: Number.isSafeInteger(line.packaging.count)
              ? line.packaging.count
              : null,
          }
        : null,
    })),
  };
};

export const listReceptions = async ({ userId } = {}) => {
  await requireUserPermission(userId, 'receptions.read');

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
