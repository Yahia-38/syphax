import { ObjectId } from 'mongodb';

import { getDatabase } from './mongodb.js';

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

export const validateProductSalePrice = (price) => {
  const normalizedPrice = typeof price === 'string' ? price.trim() : '';
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/u.exec(normalizedPrice);

  if (!match) {
    return {
      errors: {
        price: 'Saisissez un prix positif avec deux décimales maximum.',
      },
    };
  }

  const amountInCentimes = Number(match[1]) * 100
    + Number((match[2] ?? '').padEnd(2, '0'));

  if (!Number.isSafeInteger(amountInCentimes) || amountInCentimes < 1) {
    return {
      errors: {
        price: 'Saisissez un prix positif avec deux décimales maximum.',
      },
    };
  }

  return { data: { amountInCentimes } };
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
  const result = await database.collection('products').deleteOne({
    _id: new ObjectId(id),
  });

  return result.deletedCount === 1
    ? { deleted: true }
    : { notFound: true };
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

export const listProducts = async ({ query = '' } = {}) => {
  const normalizedQuery = typeof query === 'string'
    ? query.trim().slice(0, 100)
    : '';
  const database = await getDatabase();
  const products = database.collection('products');
  const filter = normalizedQuery
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
    : {};
  const documents = await products
    .find(filter, {
      projection: { baseUnit: 1, code: 1, designation: 1 },
    })
    .sort({ code: 1, _id: 1 })
    .toArray();

  return documents.map((product) => ({
    id: product._id.toString(),
    baseUnit: product.baseUnit,
    code: product.code,
    designation: product.designation,
  }));
};

export const getProductById = async (id) => {
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
        packagings: 1,
        salePrice: 1,
        salePriceHistory: 1,
        updatedAt: 1,
        updatedBy: 1,
      },
    },
  );

  if (!product) {
    return null;
  }

  const salePriceHistory = Array.isArray(product.salePriceHistory)
    ? product.salePriceHistory
    : [];
  const userIds = [
    product.createdBy,
    product.updatedBy,
    product.salePrice?.updatedBy,
    ...salePriceHistory.map((entry) => entry.changedBy),
  ].filter(Boolean);
  const users = userIds.length > 0
    ? await database.collection('users').find(
        { _id: { $in: userIds } },
        { projection: { username: 1 } },
      ).toArray()
    : [];
  const usernames = new Map(
    users.map((user) => [user._id.toString(), user.username]),
  );

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
    updatedAt: product.updatedAt?.toISOString?.() ?? null,
    updatedBy: usernames.get(product.updatedBy?.toString()) ?? null,
  };
};
