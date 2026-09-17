import { ObjectId } from 'mongodb';

import { requireUserPermission, userHasPermission } from './access.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import { readProductStockValuation } from './product-stock-valuations.js';
import { getDisplayUnitSalePrice, getProductDisplayUnit } from './product-display-unit.js';
import { getSalePackagings, PACKAGING_USAGES, SALE_PACKAGING_USAGES } from './product-packaging.js';
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

export const validateProductPackaging = ({ label, quantity, usage }) => {
  const errors = {};
  const normalizedLabel = typeof label === 'string' ? label.trim() : '';
  const quantityText = typeof quantity === 'string' ? quantity.trim() : '';
  const normalizedUsage = typeof usage === 'string' ? usage.trim() : '';
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

  if (!PACKAGING_USAGES.some(({ code }) => code === normalizedUsage)) {
    errors.usage = 'Sélectionnez un usage valide.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    data: {
      label: normalizedLabel,
      quantity: normalizedQuantity,
      usage: normalizedUsage,
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
    || (typeof packaging.usage === 'string' && packaging.usage.trim())
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
        packaging: packagingValidation?.data ?? null,
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
  usage,
  createdBy,
}) => {
  if (typeof productId !== 'string' || !ObjectId.isValid(productId)) {
    return { notFound: true };
  }

  const validation = validateProductPackaging({ label, quantity, usage });

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
  const packagingObjectId = new ObjectId(packagingId);
  // A single pipeline update keeps the default sale unit consistent with the
  // remaining packagings: removing the default falls back to the base unit.
  const result = await database.collection('products').updateOne(
    {
      _id: new ObjectId(productId),
      'packagings._id': packagingObjectId,
    },
    [
      {
        $set: {
          packagings: {
            $filter: {
              input: '$packagings',
              as: 'packaging',
              cond: { $ne: ['$$packaging._id', packagingObjectId] },
            },
          },
          defaultSaleUnit: {
            $cond: [
              { $eq: ['$defaultSaleUnit', packagingObjectId] },
              null,
              '$defaultSaleUnit',
            ],
          },
        },
      },
    ],
  );

  return result.modifiedCount === 1
    ? { removed: true }
    : { notFound: true };
};

export const setProductDefaultSaleUnit = async ({
  productId,
  packagingId,
  updatedBy,
}) => {
  if (typeof productId !== 'string' || !ObjectId.isValid(productId)) {
    return { notFound: true };
  }

  const usesBaseUnit = packagingId === null
    || packagingId === undefined
    || packagingId === '';

  if (
    !usesBaseUnit
    && (typeof packagingId !== 'string' || !ObjectId.isValid(packagingId))
  ) {
    return {
      errors: {
        defaultSaleUnit: 'Sélectionnez l’unité de base ou un conditionnement de vente.',
      },
    };
  }

  const database = await getDatabase();
  const products = database.collection('products');
  const productObjectId = new ObjectId(productId);
  const packagingObjectId = usesBaseUnit ? null : new ObjectId(packagingId);
  // The sale usage is checked in the same atomic update as the assignment.
  const result = await products.updateOne(
    {
      _id: productObjectId,
      ...(usesBaseUnit
        ? {}
        : {
            packagings: {
              $elemMatch: {
                _id: packagingObjectId,
                usage: { $in: SALE_PACKAGING_USAGES },
              },
            },
          }),
    },
    {
      $set: {
        defaultSaleUnit: packagingObjectId,
        updatedAt: new Date(),
        updatedBy: new ObjectId(updatedBy),
      },
    },
  );

  if (result.matchedCount === 0) {
    const product = usesBaseUnit
      ? null
      : await products.findOne(
          { _id: productObjectId },
          { projection: { _id: 1 } },
        );

    return product
      ? {
          errors: {
            defaultSaleUnit: 'Ce conditionnement n’existe plus ou n’est pas activé pour la vente.',
          },
        }
      : { notFound: true };
  }

  return { defaultSaleUnit: usesBaseUnit ? null : packagingId };
};

// A stored default that no longer designates a sale packaging reads as the base unit.
const readDefaultSaleUnit = (product) => {
  const packagingId = product.defaultSaleUnit;

  return packagingId instanceof ObjectId
    && getSalePackagings(product.packagings)
      .some((packaging) => packaging._id?.equals?.(packagingId))
    ? packagingId.toString()
    : null;
};

export const updateProductSalePrice = async ({
  productId,
  price,
  updatedBy,
  packagingId,
}) => {
  if (packagingId !== undefined) {
    return updateProductPackagingSalePrice({ productId, packagingId, price, updatedBy });
  }
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

export const updateProductPackagingSalePrice = async ({ productId, packagingId, price, updatedBy }) => {
  if (
    typeof productId !== 'string' || !ObjectId.isValid(productId)
    || typeof packagingId !== 'string' || !ObjectId.isValid(packagingId)
  ) {
    return { notFound: true };
  }
  const validation = validateProductSalePrice(price);
  if (validation.errors) return validation;

  const database = await getDatabase();
  const changedAt = new Date();
  const changedBy = new ObjectId(updatedBy);
  const historyId = new ObjectId();
  const packagingObjectId = new ObjectId(packagingId);
  const { amountInCentimes } = validation.data;
  const result = await database.collection('products').updateOne(
    { _id: new ObjectId(productId), packagings: { $elemMatch: {
      _id: packagingObjectId, usage: { $in: SALE_PACKAGING_USAGES },
    } } },
    [{
      $set: {
        packagings: {
          $map: {
            input: '$packagings',
            as: 'packaging',
            in: {
              $cond: [
                { $eq: ['$$packaging._id', packagingObjectId] },
                {
                  $mergeObjects: ['$$packaging', {
                    salePrice: { amountInCentimes, currency: 'DZD', taxIncluded: true, updatedAt: changedAt, updatedBy: changedBy, versionId: historyId },
                    salePriceHistory: {
                      $concatArrays: [
                        { $cond: [{ $isArray: '$$packaging.salePriceHistory' }, '$$packaging.salePriceHistory', []] },
                        [{
                          _id: historyId,
                          oldAmountInCentimes: { $ifNull: ['$$packaging.salePrice.amountInCentimes', null] },
                          newAmountInCentimes: amountInCentimes,
                          changedAt,
                          changedBy,
                        }],
                      ],
                    },
                  }],
                },
                '$$packaging',
              ],
            },
          },
        },
      },
    }],
  );
  if (result.matchedCount === 0) {
    const existingPackaging = await database.collection('products').findOne(
      { _id: new ObjectId(productId), 'packagings._id': packagingObjectId },
      { projection: { _id: 1 } },
    );
    return existingPackaging
      ? { errors: { price: 'Ce conditionnement n’est pas activé pour la vente. Aucun prix de vente ne peut lui être attribué.' } }
      : { notFound: true };
  }
  return { salePrice: { amountInCentimes, currency: 'DZD', taxIncluded: true } };
};

export const listProducts = async ({
  includePackagings = false,
  includePricing = false,
  includeDisplayUnit = false,
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
    ...(includePackagings || includeDisplayUnit ? { defaultSaleUnit: 1, packagings: 1 } : {}),
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
    const packagings = Array.isArray(product.packagings)
      ? product.packagings.map((packaging) => ({
          id: packaging._id.toString(),
          label: packaging.label,
          quantity: packaging.quantity,
          usage: packaging.usage ?? null,
          salePrice: packaging.salePrice,
        }))
      : [];
    const defaultSaleUnit = readDefaultSaleUnit(product);
    const displayUnit = includeDisplayUnit
      ? getProductDisplayUnit({ defaultSaleUnit, packagings }) : null;
    const salePriceCentimes = includeDisplayUnit
      ? getDisplayUnitSalePrice({ displayUnit, packagings, salePrice: product.salePrice })
      : Number.isSafeInteger(product.salePrice?.amountInCentimes)
        ? product.salePrice.amountInCentimes : null;
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
            packagings: packagings.map(({ salePrice, ...packaging }) => packaging),
            defaultSaleUnit,
          }
        : {}),
      ...(includeDisplayUnit ? { displayUnit } : {}),
      ...(includePricing ? { salePriceCentimes } : {}),
    };
  });
};

const readProductById = async (
  id,
  {
    includePricing = false,
    includePackagings = true,
    includeStockMovements = false,
    includeTourSources = false,
    includeReceptionSources = false,
    includeValuation = false,
    database,
    session,
  } = {},
) => {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) {
    return null;
  }

  const product = await database.collection('products').findOne(
    { _id: new ObjectId(id) },
    {
      projection: {
        baseUnit: 1,
        code: 1,
        createdAt: 1,
        createdBy: 1,
        designation: 1,
        ...(includePackagings ? { defaultSaleUnit: 1, packagings: 1 } : {}),
        ...(includePricing ? { salePrice: 1, salePriceHistory: 1 } : {}),
        updatedAt: 1,
        updatedBy: 1,
      },
      session,
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
    ...(includePricing && includePackagings
      ? (product.packagings ?? []).flatMap((packaging) => [
          packaging.salePrice?.updatedBy,
          ...(packaging.salePriceHistory ?? []).map((entry) => entry.changedBy),
        ])
      : []),
  ].filter(Boolean);
  const reads = [
    () => userIds.length > 0
      ? database.collection('users').find(
          { _id: { $in: userIds } },
          { projection: { username: 1 }, session },
        ).toArray()
      : [],
    () => getProductStockSummaries([product._id], { database, session }),
    () => includeStockMovements
      ? listProductStockMovements(product._id, {
          database,
          session,
          includeTourSources,
          includeReceptionSources,
        })
      : [],
  ];
  // A transaction must execute reads sequentially; ordinary readers can parallelize.
  const results = [];
  if (session) {
    for (const read of reads) results.push(await read());
  } else {
    results.push(...await Promise.all(reads.map((read) => read())));
  }
  const [users, stockSummaries, stockMovements] = results;
  const costs = includeValuation ? await readProductStockValuation({
    database, session, productId: product._id, baseUnit: product.baseUnit,
  }) : null;
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
    defaultSaleUnit: readDefaultSaleUnit(product),
    designation: product.designation,
    packagings: Array.isArray(product.packagings)
      ? product.packagings.map((packaging) => ({
          id: packaging._id.toString(),
          label: packaging.label,
          quantity: packaging.quantity,
          usage: packaging.usage ?? null,
          ...(includePricing ? {
            salePrice: Number.isSafeInteger(packaging.salePrice?.amountInCentimes)
              ? {
                  amountInCentimes: packaging.salePrice.amountInCentimes,
                  currency: packaging.salePrice.currency,
                  taxIncluded: packaging.salePrice.taxIncluded,
                  updatedAt: packaging.salePrice.updatedAt?.toISOString?.() ?? null,
                  updatedBy: usernames.get(packaging.salePrice.updatedBy?.toString()) ?? null,
                }
              : null,
            salePriceHistory: (Array.isArray(packaging.salePriceHistory) ? packaging.salePriceHistory : [])
              .map((entry) => ({
                id: entry._id.toString(),
                oldAmountInCentimes: entry.oldAmountInCentimes ?? null,
                newAmountInCentimes: entry.newAmountInCentimes,
                changedAt: entry.changedAt?.toISOString?.() ?? null,
                changedBy: usernames.get(entry.changedBy?.toString()) ?? null,
              })).reverse(),
          } : {}),
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
      ...(costs ? { valuation: costs.valuation } : {}),
      ...(includeStockMovements ? { movements: stockMovements.map((movement) => ({
        ...movement,
        ...(costs ? { valueDeltaInCentimes: costs.movementValues.get(movement.id) ?? null } : {}),
      })) } : {}),
    },
    updatedAt: product.updatedAt?.toISOString?.() ?? null,
    updatedBy: usernames.get(product.updatedBy?.toString()) ?? null,
  };
};

export const getProductById = async (id, options = {}) => {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) return null;
  if (!options.includeValuation) {
    return readProductById(id, { ...options, database: await getDatabase() });
  }
  const client = await getMongoClient();
  const database = client.db();
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      await requireUserPermission(options.userId, 'products.read', { database, session });
      const includeValuation = await userHasPermission(options.userId, 'stock.valuation.read', { database, session });
      return readProductById(id, { ...options, database, session, includeValuation });
    }, { readConcern: { level: 'snapshot' } });
  } finally {
    await session.endSession();
  }
};
