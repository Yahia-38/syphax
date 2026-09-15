import { ObjectId } from 'mongodb';

import { getDatabase } from './mongodb.js';
import { validateProductSalePrice } from './product-pricing.js';
import {
  getEmptyProductStockSummary,
  getProductStockSummaries,
  listProductStockMovements,
} from './stock-movements.js';

export { validateProductSalePrice } from './product-pricing.js';

export const BASE_UNITS = [
  { code: 'PIECE', label: 'Pièce' },
  { code: 'BOUTEILLE', label: 'Bouteille' },
  { code: 'BOITE', label: 'Boîte' },
  { code: 'SACHET', label: 'Sachet' },
];

const BASE_UNIT_CODES = new Set(BASE_UNITS.map((unit) => unit.code));

const escapeRegularExpression = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const validateProduct = ({ code, designation, baseUnit }) => {
  const errors = {};
  const normalizedCode = typeof code === 'string'
    ? code.trim().toLocaleUpperCase('fr')
    : '';
  const normalizedDesignation = typeof designation === 'string'
    ? designation.trim()
    : '';

  if (!normalizedCode) {
    errors.code = 'Le code est obligatoire.';
  } else if (Array.from(normalizedCode).length > 50) {
    errors.code = 'Le code ne doit pas dépasser 50 caractères.';
  } else if (/\s/u.test(normalizedCode)) {
    errors.code = 'Le code ne doit contenir aucun espace intérieur.';
  }

  if (!normalizedDesignation) {
    errors.designation = 'La désignation est obligatoire.';
  } else if (Array.from(normalizedDesignation).length > 150) {
    errors.designation = 'La désignation ne doit pas dépasser 150 caractères.';
  }

  if (!BASE_UNIT_CODES.has(baseUnit)) {
    errors.baseUnit = 'Sélectionnez une unité de base valide.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    data: {
      code: normalizedCode,
      designation: normalizedDesignation,
      baseUnit,
    },
  };
};

export const validateProductPackaging = ({ label, quantity }) => {
  const errors = {};
  const normalizedLabel = typeof label === 'string' ? label.trim() : '';
  const quantityText = typeof quantity === 'string' ? quantity.trim() : '';
  const normalizedQuantity = /^\d+$/u.test(quantityText)
    ? Number(quantityText)
    : Number.NaN;

  if (!normalizedLabel) {
    errors.label = 'Le libellé est obligatoire.';
  } else if (Array.from(normalizedLabel).length > 100) {
    errors.label = 'Le libellé ne doit pas dépasser 100 caractères.';
  }

  if (!Number.isSafeInteger(normalizedQuantity) || normalizedQuantity < 2) {
    errors.quantity = 'Saisissez une quantité entière supérieure ou égale à 2.';
  } else if (normalizedQuantity > 1_000_000) {
    errors.quantity = 'La quantité ne doit pas dépasser 1 000 000.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    data: {
      label: normalizedLabel,
      quantity: normalizedQuantity,
    },
  };
};

export const createProduct = async ({
  code,
  designation,
  baseUnit,
  createdBy,
  packaging,
}) => {
  const validation = validateProduct({ code, designation, baseUnit });
  const packagingRequested = packaging && (
    (typeof packaging.label === 'string' && packaging.label.trim())
    || (typeof packaging.quantity === 'string' && packaging.quantity.trim())
  );
  const packagingValidation = packagingRequested
    ? validateProductPackaging(packaging)
    : null;

  if (validation.errors || packagingValidation?.errors) {
    return {
      errors: {
        ...validation.errors,
        ...packagingValidation?.errors,
      },
    };
  }

  const database = await getDatabase();
  const products = database.collection('products');

  await products.createIndex(
    { code: 1 },
    { name: 'unique_product_code', unique: true },
  );

  const product = {
    ...validation.data,
    createdAt: new Date(),
    createdBy: new ObjectId(createdBy),
  };

  if (packagingValidation?.data) {
    product.packagings = [
      {
        _id: new ObjectId(),
        ...packagingValidation.data,
        createdAt: new Date(),
        createdBy: new ObjectId(createdBy),
      },
    ];
  }

  try {
    const result = await products.insertOne(product);

    return {
      product: {
        id: result.insertedId.toString(),
        ...validation.data,
      },
    };
  } catch (error) {
    if (error?.code === 11000) {
      return {
        errors: {
          code: 'Un produit avec ce code existe déjà.',
        },
      };
    }

    throw error;
  }
};

export const deleteProduct = async (id) => {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) {
    return { notFound: true };
  }

  const database = await getDatabase();
  const productObjectId = new ObjectId(id);
  const products = database.collection('products');
  const product = await products.findOne(
    { _id: productObjectId },
    { projection: { stockReferenceVersion: 1 } },
  );

  if (!product) {
    return { notFound: true };
  }

  const [
    receptionUsingProduct,
    stockMovement,
    reservationUsingProduct,
  ] = await Promise.all([
    database.collection('receptions').findOne(
      { 'lines.productId': productObjectId },
      { projection: { _id: 1 } },
    ),
    database.collection('stockMovements').findOne(
      { productId: productObjectId },
      { projection: { _id: 1 } },
    ),
    database.collection('tourReservations').findOne(
      { productId: productObjectId },
      { projection: { _id: 1 } },
    ),
  ]);

  if (reservationUsingProduct) {
    return { inUse: true, reservationInUse: true };
  }

  if (
    Number.isSafeInteger(product.stockReferenceVersion)
    || receptionUsingProduct
    || stockMovement
  ) {
    return { inUse: true };
  }

  const result = await products.deleteOne({
    _id: productObjectId,
    stockReferenceVersion: { $exists: false },
  });

  if (result.deletedCount === 0) {
    const currentProduct = await products.findOne(
      { _id: productObjectId },
      { projection: { stockReferenceVersion: 1 } },
    );

    return currentProduct ? { inUse: true } : { notFound: true };
  }

  return { deleted: true };
};

export const updateProduct = async ({
  productId,
  code,
  designation,
  baseUnit,
  updatedBy,
}) => {
  if (typeof productId !== 'string' || !ObjectId.isValid(productId)) {
    return { notFound: true };
  }

  const validation = validateProduct({ code, designation, baseUnit });

  if (validation.errors) {
    return validation;
  }

  const database = await getDatabase();
  const products = database.collection('products');
  const productObjectId = new ObjectId(productId);

  await products.createIndex(
    { code: 1 },
    { name: 'unique_product_code', unique: true },
  );

  const currentProduct = await products.findOne(
    { _id: productObjectId },
    { projection: { baseUnit: 1, stockReferenceVersion: 1 } },
  );

  if (!currentProduct) {
    return { notFound: true };
  }

  const baseUnitChanged = currentProduct.baseUnit !== validation.data.baseUnit;

  if (baseUnitChanged) {
    const [
      receptionUsingProduct,
      stockMovement,
      reservationUsingProduct,
    ] = await Promise.all([
      database.collection('receptions').findOne(
        { 'lines.productId': productObjectId },
        { projection: { _id: 1 } },
      ),
      database.collection('stockMovements').findOne(
        { productId: productObjectId },
        { projection: { _id: 1 } },
      ),
      database.collection('tourReservations').findOne(
        { productId: productObjectId },
        { projection: { _id: 1 } },
      ),
    ]);

    if (reservationUsingProduct) {
      return {
        errors: {
          baseUnit: 'L’unité de base ne peut plus être modifiée car ce produit est référencé par une tournée.',
        },
      };
    }

    if (
      Number.isSafeInteger(currentProduct.stockReferenceVersion)
      || receptionUsingProduct
      || stockMovement
    ) {
      return {
        errors: {
          baseUnit: 'L’unité de base ne peut plus être modifiée car ce produit possède un historique de réception.',
        },
      };
    }
  }

  try {
    const result = await products.updateOne(
      {
        _id: productObjectId,
        ...(baseUnitChanged
          ? {
              baseUnit: currentProduct.baseUnit,
              stockReferenceVersion: { $exists: false },
            }
          : {}),
      },
      {
        $set: {
          ...validation.data,
          updatedAt: new Date(),
          updatedBy: new ObjectId(updatedBy),
        },
      },
    );

    if (result.matchedCount === 0) {
      const productStillExists = await products.findOne(
        { _id: productObjectId },
        { projection: { _id: 1 } },
      );

      return productStillExists && baseUnitChanged
        ? {
            errors: {
              baseUnit: 'L’unité de base ne peut plus être modifiée car le produit a été utilisé entre-temps.',
            },
          }
        : { notFound: true };
    }

    return {
      product: {
        id: productId,
        ...validation.data,
      },
    };
  } catch (error) {
    if (error?.code === 11000) {
      return {
        errors: {
          code: 'Un produit avec ce code existe déjà.',
        },
      };
    }

    throw error;
  }
};

export const addProductPackaging = async ({
  productId,
  label,
  quantity,
  createdBy,
}) => {
  if (typeof productId !== 'string' || !ObjectId.isValid(productId)) {
    return { notFound: true };
  }

  const validation = validateProductPackaging({ label, quantity });

  if (validation.errors) {
    return validation;
  }

  const database = await getDatabase();
  const packaging = {
    _id: new ObjectId(),
    ...validation.data,
    createdAt: new Date(),
    createdBy: new ObjectId(createdBy),
  };
  const result = await database.collection('products').updateOne(
    { _id: new ObjectId(productId) },
    { $push: { packagings: packaging } },
  );

  if (result.matchedCount === 0) {
    return { notFound: true };
  }

  return {
    packaging: {
      id: packaging._id.toString(),
      ...validation.data,
    },
  };
};

export const removeProductPackaging = async ({ productId, packagingId }) => {
  if (
    typeof productId !== 'string'
    || !ObjectId.isValid(productId)
    || typeof packagingId !== 'string'
    || !ObjectId.isValid(packagingId)
  ) {
    return { notFound: true };
  }

  const database = await getDatabase();
  const result = await database.collection('products').updateOne(
    {
      _id: new ObjectId(productId),
      'packagings._id': new ObjectId(packagingId),
    },
    { $pull: { packagings: { _id: new ObjectId(packagingId) } } },
  );

  return result.modifiedCount === 1
    ? { removed: true }
    : { notFound: true };
};

export const updateProductSalePrice = async ({
  productId,
  price,
  updatedBy,
}) => {
  if (typeof productId !== 'string' || !ObjectId.isValid(productId)) {
    return { notFound: true };
  }

  const validation = validateProductSalePrice(price);

  if (validation.errors) {
    return validation;
  }

  const database = await getDatabase();
  const changedAt = new Date();
  const changedBy = new ObjectId(updatedBy);
  const historyId = new ObjectId();
  const { amountInCentimes } = validation.data;
  const result = await database.collection('products').updateOne(
    { _id: new ObjectId(productId) },
    [
      {
        $set: {
          salePriceHistory: {
            $concatArrays: [
              {
                $cond: [
                  { $isArray: '$salePriceHistory' },
                  '$salePriceHistory',
                  [],
                ],
              },
              [
                {
                  _id: historyId,
                  oldAmountInCentimes: {
                    $ifNull: ['$salePrice.amountInCentimes', null],
                  },
                  newAmountInCentimes: amountInCentimes,
                  changedAt,
                  changedBy,
                },
              ],
            ],
          },
          salePrice: {
            amountInCentimes,
            currency: 'DZD',
            taxIncluded: true,
            updatedAt: changedAt,
            updatedBy: changedBy,
            versionId: historyId,
          },
        },
      },
    ],
  );

  if (result.matchedCount === 0) {
    return { notFound: true };
  }

  return {
    salePrice: {
      amountInCentimes,
      currency: 'DZD',
      taxIncluded: true,
    },
  };
};

export const listProducts = async ({
  includePackagings = false,
  includePricing = false,
  onlyUsable = false,
  query = '',
} = {}) => {
  const normalizedQuery = typeof query === 'string'
    ? query.trim().slice(0, 100)
    : '';
  const database = await getDatabase();
  const products = database.collection('products');
  const filter = {
    ...(onlyUsable ? { active: { $ne: false } } : {}),
    ...(normalizedQuery
      ? {
        $or: [
          {
            code: {
              $options: 'i',
              $regex: escapeRegularExpression(normalizedQuery),
            },
          },
          {
            designation: {
              $options: 'i',
              $regex: escapeRegularExpression(normalizedQuery),
            },
          },
        ],
      }
      : {}),
  };
  const projection = {
    baseUnit: 1,
    code: 1,
    designation: 1,
    ...(includePackagings ? { packagings: 1 } : {}),
    ...(includePricing ? { salePrice: 1 } : {}),
  };
  const documents = await products
    .find(filter, {
      projection,
    })
    .sort({ code: 1, _id: 1 })
    .toArray();
  const stockSummaries = await getProductStockSummaries(
    documents.map((product) => product._id),
    { database },
  );

  return documents.map((product) => {
    const productId = product._id.toString();
    const stock = stockSummaries.get(productId)
      ?? getEmptyProductStockSummary();

    return {
      id: productId,
      baseUnit: product.baseUnit,
      code: product.code,
      designation: product.designation,
      stockQuantityInBaseUnits: stock.quantityInBaseUnits,
      reservedQuantityInBaseUnits: stock.reservedQuantityInBaseUnits,
      availableQuantityInBaseUnits: stock.availableQuantityInBaseUnits,
      ...(includePackagings
        ? {
            packagings: Array.isArray(product.packagings)
              ? product.packagings.map((packaging) => ({
                  id: packaging._id.toString(),
                  label: packaging.label,
                  quantity: packaging.quantity,
                }))
              : [],
          }
        : {}),
      ...(includePricing
        ? {
            salePriceCentimes: Number.isSafeInteger(
              product.salePrice?.amountInCentimes,
            )
              ? product.salePrice.amountInCentimes
              : null,
          }
        : {}),
    };
  });
};

export const getProductById = async (
  id,
  {
    includePricing = false,
    includePackagings = true,
    includeStockMovements = false,
    includeTourSources = false,
    includeReceptionSources = false,
  } = {},
) => {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) {
    return null;
  }

  const database = await getDatabase();
  const product = await database.collection('products').findOne(
    { _id: new ObjectId(id) },
    {
      projection: {
        baseUnit: 1,
        code: 1,
        createdAt: 1,
        createdBy: 1,
        designation: 1,
        ...(includePackagings ? { packagings: 1 } : {}),
        ...(includePricing ? { salePrice: 1, salePriceHistory: 1 } : {}),
        updatedAt: 1,
        updatedBy: 1,
      },
    },
  );

  if (!product) {
    return null;
  }

  const salePriceHistory = includePricing
    && Array.isArray(product.salePriceHistory)
    ? product.salePriceHistory
    : [];
  const userIds = [
    product.createdBy,
    product.updatedBy,
    ...(includePricing ? [product.salePrice?.updatedBy] : []),
    ...salePriceHistory.map((entry) => entry.changedBy),
  ].filter(Boolean);
  const [users, stockSummaries, stockMovements] = await Promise.all([
    userIds.length > 0
      ? database.collection('users').find(
          { _id: { $in: userIds } },
          { projection: { username: 1 } },
        ).toArray()
      : [],
    getProductStockSummaries([product._id], { database }),
    includeStockMovements
      ? listProductStockMovements(product._id, {
          database,
          includeTourSources,
          includeReceptionSources,
        })
      : [],
  ]);
  const usernames = new Map(
    users.map((user) => [user._id.toString(), user.username]),
  );
  const stock = stockSummaries.get(product._id.toString())
    ?? getEmptyProductStockSummary();

  return {
    id: product._id.toString(),
    baseUnit: product.baseUnit,
    code: product.code,
    createdAt: product.createdAt?.toISOString?.() ?? null,
    createdBy: usernames.get(product.createdBy?.toString()) ?? null,
    designation: product.designation,
    packagings: Array.isArray(product.packagings)
      ? product.packagings.map((packaging) => ({
          id: packaging._id.toString(),
          label: packaging.label,
          quantity: packaging.quantity,
        }))
      : [],
    salePrice: Number.isSafeInteger(product.salePrice?.amountInCentimes)
      ? {
          amountInCentimes: product.salePrice.amountInCentimes,
          currency: product.salePrice.currency,
          taxIncluded: product.salePrice.taxIncluded,
          updatedAt: product.salePrice.updatedAt?.toISOString?.() ?? null,
          updatedBy:
            usernames.get(product.salePrice.updatedBy?.toString()) ?? null,
        }
      : null,
    salePriceHistory: salePriceHistory
      .map((entry) => ({
        id: entry._id.toString(),
        oldAmountInCentimes: entry.oldAmountInCentimes ?? null,
        newAmountInCentimes: entry.newAmountInCentimes,
        changedAt: entry.changedAt?.toISOString?.() ?? null,
        changedBy: usernames.get(entry.changedBy?.toString()) ?? null,
      }))
      .reverse(),
    stock: {
      inputQuantityInBaseUnits: stock.inputQuantityInBaseUnits,
      lastMovementAt: stock.lastMovementAt?.toISOString?.() ?? null,
      movementCount: stock.movementCount,
      outputQuantityInBaseUnits: stock.outputQuantityInBaseUnits,
      quantityInBaseUnits: stock.quantityInBaseUnits,
      reservedQuantityInBaseUnits: stock.reservedQuantityInBaseUnits,
      availableQuantityInBaseUnits: stock.availableQuantityInBaseUnits,
      ...(includeStockMovements ? { movements: stockMovements } : {}),
    },
    updatedAt: product.updatedAt?.toISOString?.() ?? null,
    updatedBy: usernames.get(product.updatedBy?.toString()) ?? null,
  };
};
