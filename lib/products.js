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

export const createProduct = async ({ code, designation, baseUnit, createdBy }) => {
  const validation = validateProduct({ code, designation, baseUnit });

  if (validation.errors) {
    return validation;
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

export const updateProduct = async ({
  id,
  code,
  designation,
  baseUnit,
  updatedBy,
}) => {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) {
    return { notFound: true };
  }

  const validation = validateProduct({ code, designation, baseUnit });

  if (validation.errors) {
    return validation;
  }

  const database = await getDatabase();
  const products = database.collection('products');

  try {
    const result = await products.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          ...validation.data,
          updatedAt: new Date(),
          updatedBy: new ObjectId(updatedBy),
        },
      },
    );

    if (result.matchedCount === 0) {
      return { notFound: true };
    }

    return {
      product: {
        id,
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
        updatedAt: 1,
        updatedBy: 1,
      },
    },
  );

  if (!product) {
    return null;
  }

  const userIds = [product.createdBy, product.updatedBy].filter(Boolean);
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
    updatedAt: product.updatedAt?.toISOString?.() ?? null,
    updatedBy: usernames.get(product.updatedBy?.toString()) ?? null,
  };
};
